/**
 * Wallet type definitions for HD wallet management and encrypted storage.
 */

import type { ChainId } from './chains.js';

/** Wallet selection strategy */
export type WalletSelection = 'round-robin' | 'lowest-nonce' | 'highest-balance';

/** Information about a derived wallet */
export interface WalletInfo {
  index: number;
  address: string;

  chains: ChainId[];
  label?: string;
}

/** Encrypted private key storage format */
export interface EncryptedKeystore {
  iv: string;
  salt: string;
  authTag: string;
  encryptedData: string;
  createdAt: number;
}

/** Full wallet keystore file shape */
export interface KeystoreFile {
  version: number;
  mnemonic?: EncryptedKeystore;
  wallets: {
    index: number;
    address: string;
    label?: string;
    encryptedKey: EncryptedKeystore;
  }[];
}

export interface WalletState {
  info: WalletInfo;
  balances: Map<ChainId, bigint>;
  tokenBalances: Map<ChainId, bigint>;
  lastUsedAt: number;
}
