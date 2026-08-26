/**
 * HD wallet management — generation, import, encryption, selection.
 * Derives wallets from BIP-39 mnemonic using BIP-32/BIP-44 paths.
 */

import fs from 'node:fs';
import path from 'node:path';
import { HDKey } from '@scure/bip32';
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { privateKeyToAccount } from 'viem/accounts';
import { createLogger } from '../core/logger.js';
import { eventBus } from '../core/event-bus.js';
import { DERIVATION_PATHS } from '../core/constants.js';
import { encrypt, decrypt } from './keystore.js';
import type { ChainId } from '../types/chains.js';
import type { WalletState, WalletSelection, KeystoreFile, EncryptedKeystore } from '../types/wallet.js';

const log = createLogger('wallet-manager');
const DATA_DIR = path.resolve(process.cwd(), 'data');
const KEYSTORE_PATH = path.join(DATA_DIR, 'keystore.json');

export class WalletManager {
  private password: string;
  private wallets: WalletState[] = [];
  private roundRobinIndex = 0;
  private mnemonic?: string;

  constructor(password: string) {
    this.password = password;
    // Ensure data directory exists
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  /**
   * Generate new HD wallets from a fresh or provided mnemonic.
   */
  generateWallets(mnemonicPhrase?: string, count = 3): WalletState[] {
    const mnemonic = mnemonicPhrase ?? generateMnemonic(wordlist, 128);

    if (!validateMnemonic(mnemonic, wordlist)) {
      throw new Error('Invalid mnemonic phrase');
    }

    this.mnemonic = mnemonic;
    const seed = mnemonicToSeedSync(mnemonic);
    const masterKey = HDKey.fromMasterSeed(seed);
    const keystoreFile: KeystoreFile = {
      version: 1,
      mnemonic: encrypt(Buffer.from(mnemonic, 'utf-8'), this.password),
      wallets: [],
    };

    this.wallets = [];

    for (let i = 0; i < count; i++) {
      const derivationPath = `${DERIVATION_PATHS.ethereum}/${i}`;
      const child = masterKey.derive(derivationPath);

      if (!child.privateKey) {
        throw new Error(`Failed to derive private key at index ${i}`);
      }

      const privateKeyHex = `0x${Buffer.from(child.privateKey).toString('hex')}` as `0x${string}`;
      const account = privateKeyToAccount(privateKeyHex);

      const encryptedKey = encrypt(Buffer.from(child.privateKey), this.password);

      keystoreFile.wallets.push({
        index: i,
        address: account.address,
        encryptedKey,
      });

      const state: WalletState = {
        info: {
          index: i,
          address: account.address,
          chains: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', ],
        },
        balances: new Map(),
        tokenBalances: new Map(),
        lastUsedAt: 0,
      };

      this.wallets.push(state);
      log.info({ address: account.address, index: i }, 'Derived wallet');
    }

    // Persist encrypted keystore
    fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystoreFile, null, 2));
    log.info({ count, path: KEYSTORE_PATH }, 'Keystore saved');

    return this.wallets;
  }

  /**
   * Derive and add additional wallets using the existing mnemonic.
   */
  addWallets(count: number): WalletState[] {
    if (!this.mnemonic) {
      return this.generateWallets(undefined, count);
    }

    let keystoreFile: KeystoreFile;
    if (fs.existsSync(KEYSTORE_PATH)) {
      keystoreFile = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf-8')) as KeystoreFile;
    } else {
      throw new Error('Keystore file missing but mnemonic is loaded');
    }

    const seed = mnemonicToSeedSync(this.mnemonic);
    const masterKey = HDKey.fromMasterSeed(seed);
    const startIndex = this.wallets.length;
    const newWallets: WalletState[] = [];

    for (let i = startIndex; i < startIndex + count; i++) {
      const derivationPath = `${DERIVATION_PATHS.ethereum}/${i}`;
      const child = masterKey.derive(derivationPath);

      if (!child.privateKey) {
        throw new Error(`Failed to derive private key at index ${i}`);
      }

      const privateKeyHex = `0x${Buffer.from(child.privateKey).toString('hex')}` as `0x${string}`;
      const account = privateKeyToAccount(privateKeyHex);

      const encryptedKey = encrypt(Buffer.from(child.privateKey), this.password);

      keystoreFile.wallets.push({
        index: i,
        address: account.address,
        encryptedKey,
      });

      const state: WalletState = {
        info: {
          index: i,
          address: account.address,
          chains: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', ],
        },
        balances: new Map(),
        tokenBalances: new Map(),
        lastUsedAt: 0,
      };

      this.wallets.push(state);
      newWallets.push(state);
      log.info({ address: account.address, index: i }, 'Derived additional wallet');
    }

    fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystoreFile, null, 2));
    log.info({ count, path: KEYSTORE_PATH }, 'Keystore updated with new wallets');

    return newWallets;
  }

  /**
   * Load wallets from encrypted keystore file.
   */
  loadWallets(): WalletState[] {
    if (!fs.existsSync(KEYSTORE_PATH)) {
      log.warn('No keystore file found. Run setup-wallets first.');
      return [];
    }

    const raw = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf-8')) as KeystoreFile;
    this.wallets = [];

    // Decrypt mnemonic if stored
    if (raw.mnemonic) {
      try {
        const mnemonicBuf = decrypt(raw.mnemonic, this.password);
        this.mnemonic = mnemonicBuf.toString('utf-8');
      } catch {
        log.error('Failed to decrypt mnemonic — wrong password?');
        throw new Error('Invalid keystore password');
      }
    }

    for (const entry of raw.wallets) {
      // Verify we can decrypt (validates password)
      try {
        decrypt(entry.encryptedKey, this.password);
      } catch {
        throw new Error(`Failed to decrypt wallet ${entry.index} — wrong password?`);
      }

      const state: WalletState = {
        info: {
          index: entry.index,
          address: entry.address,
          label: entry.label,
          chains: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', ],
        },
        balances: new Map(),
        tokenBalances: new Map(),
        lastUsedAt: 0,
      };

      this.wallets.push(state);
      log.info({ address: entry.address, index: entry.index }, 'Loaded wallet');
    }

    log.info({ count: this.wallets.length }, 'Wallets loaded from keystore');
    return this.wallets;
  }

  /**
   * Import a wallet from a raw private key.
   */
  importWallet(privateKeyHex: `0x${string}`): WalletState {
    const account = privateKeyToAccount(privateKeyHex);
    const privateKeyBuf = Buffer.from(privateKeyHex.slice(2), 'hex');
    const encryptedKey = encrypt(privateKeyBuf, this.password);

    // Load existing keystore or create new
    let keystoreFile: KeystoreFile;
    if (fs.existsSync(KEYSTORE_PATH)) {
      keystoreFile = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf-8')) as KeystoreFile;
    } else {
      keystoreFile = { version: 1, wallets: [] };
    }

    const index = keystoreFile.wallets.length;
    keystoreFile.wallets.push({
      index,
      address: account.address,
      encryptedKey,
    });

    fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystoreFile, null, 2));

    const state: WalletState = {
      info: {
        index,
        address: account.address,
        chains: ['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', ],
      },
      balances: new Map(),
      tokenBalances: new Map(),
      lastUsedAt: 0,
    };

    this.wallets.push(state);
    log.info({ address: account.address, index }, 'Imported wallet');
    return state;
  }

  /**
   * Get the decrypted private key for a wallet (for transaction signing).
   */
  getPrivateKey(index: number): `0x${string}` {
    if (!fs.existsSync(KEYSTORE_PATH)) {
      throw new Error('No keystore file found');
    }

    const raw = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf-8')) as KeystoreFile;
    const entry = raw.wallets.find((w) => w.index === index);
    if (!entry) {
      throw new Error(`Wallet ${index} not found in keystore`);
    }

    const decrypted = decrypt(entry.encryptedKey, this.password);
    return `0x${decrypted.toString('hex')}`;
  }


  /**
   * Delete a wallet from the keystore by index.
   */
  deleteWallet(index: number): boolean {
    const walletIndex = this.wallets.findIndex((w) => w.info.index === index);
    if (walletIndex === -1) return false;

    // Remove from memory
    this.wallets.splice(walletIndex, 1);

    // Remove from disk
    if (fs.existsSync(KEYSTORE_PATH)) {
      const keystoreFile = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf-8')) as KeystoreFile;
      keystoreFile.wallets = keystoreFile.wallets.filter((w) => w.index !== index);
      fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystoreFile, null, 2));
    }

    log.info({ index }, 'Deleted wallet');
    return true;
  }

  /**
   * Set a custom label for a wallet.
   */
  setWalletLabel(index: number, label: string): boolean {
    const wallet = this.wallets.find((w) => w.info.index === index);
    if (!wallet) return false;

    wallet.info.label = label;

    if (fs.existsSync(KEYSTORE_PATH)) {
      const keystoreFile = JSON.parse(fs.readFileSync(KEYSTORE_PATH, 'utf-8')) as KeystoreFile;
      const entry = keystoreFile.wallets.find((w) => w.index === index);
      if (entry) {
        entry.label = label;
        fs.writeFileSync(KEYSTORE_PATH, JSON.stringify(keystoreFile, null, 2));
      }
    }

    log.info({ index, label }, 'Updated wallet label');
    return true;
  }

  /** Get a wallet by index */
  getWallet(index: number): WalletState | undefined {
    return this.wallets.find((w) => w.info.index === index);
  }

  /** Get all wallets */
  getAllWallets(): WalletState[] {
    return [...this.wallets];
  }

  /**
   * Select a wallet based on the configured strategy.
   */
  selectWallet(strategy: WalletSelection, chain: ChainId): WalletState | undefined {
    const eligible = this.wallets.filter((w) => w.info.chains.includes(chain));
    if (eligible.length === 0) return undefined;

    switch (strategy) {
      case 'round-robin': {
        const wallet = eligible[this.roundRobinIndex % eligible.length];
        this.roundRobinIndex++;
        return wallet;
      }
      case 'highest-balance': {
        return eligible.reduce((best, w) => {
          const bestBal = best.balances.get(chain) ?? 0n;
          const wBal = w.balances.get(chain) ?? 0n;
          return wBal > bestBal ? w : best;
        });
      }
      case 'lowest-nonce': {
        // Prefer wallet used least recently
        return eligible.reduce((best, w) => {
          return w.lastUsedAt < best.lastUsedAt ? w : best;
        });
      }
      default:
        return eligible[0];
    }
  }

  /** Update a wallet's balance and emit event */
  public updateBalance(address: string, chain: ChainId, balance: bigint) {
    const wallet = this.wallets.find((w) => w.info.address.toLowerCase() === address.toLowerCase());
    if (wallet) {
      wallet.balances.set(chain, balance);
      this.emit('balanceUpdated', wallet.info.index, chain, balance);
    }
  }

  public updateTokenBalance(address: string, chain: ChainId, balance: bigint) {
    const wallet = this.wallets.find((w) => w.info.address.toLowerCase() === address.toLowerCase());
    if (wallet) {
      wallet.tokenBalances.set(chain, balance);
    }
  }

  /** Get the mnemonic (only for setup display) */
  getMnemonic(): string | undefined {
    return this.mnemonic;
  }

  /** Count of managed wallets */
  get count(): number {
    return this.wallets.length;
  }
}
