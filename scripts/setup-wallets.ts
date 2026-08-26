/**
 * Interactive wallet setup script.
 * Run with: npm run setup
 */

import 'dotenv/config';
import readline from 'node:readline';
import { WalletManager } from '../src/wallet/wallet-manager.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function main(): Promise<void> {
  console.log('');
  console.log('🔐 NFT Mint Bot — Wallet Setup');
  console.log('================================');
  console.log('');

  // Get keystore password
  const password = process.env['KEYSTORE_PASSWORD'] ?? await ask('Enter a keystore password: ');
  if (!password) {
    console.error('❌ Password is required.');
    process.exit(1);
  }

  const walletManager = new WalletManager(password);

  // Check for existing wallets
  try {
    const existing = walletManager.loadWallets();
    if (existing.length > 0) {
      console.log(`\n📋 Found ${existing.length} existing wallet(s):`);
      for (const w of existing) {
        console.log(`   #${w.info.index}: ${w.info.address}`);
      }
      console.log('');
    }
  } catch {
    // No existing wallets — that's fine
  }

  const choice = await ask('Choose action:\n  1) Generate new wallets from mnemonic\n  2) Import wallet from private key\n\nYour choice (1/2): ');

  if (choice === '1') {
    // Generate new wallets
    const countStr = await ask('How many wallets to generate? (default: 3): ');
    const count = parseInt(countStr, 10) || 3;

    console.log(`\n🔄 Generating ${count} wallets...`);
    const wallets = walletManager.generateWallets(undefined, count);
    const mnemonic = walletManager.getMnemonic();

    console.log('\n✅ Wallets generated successfully!\n');

    console.log('📋 Wallet Addresses & Private Keys:');
    for (const w of wallets) {
      const privateKey = walletManager.getPrivateKey(w.info.index);
      console.log(`   #${w.info.index}: ${w.info.address}`);
      console.log(`      Key: ${privateKey}`);
    }

    console.log('\n⚠️  IMPORTANT — Save your recovery phrase:');
    console.log('━'.repeat(50));
    console.log(`\n   ${mnemonic}\n`);
    console.log('━'.repeat(50));
    console.log('⚠️  This phrase can recover ALL your wallets.');
    console.log('⚠️  Never share it. Never store it digitally.');
    console.log('⚠️  Write it down on paper and store securely.\n');

  } else if (choice === '2') {
    // Import from private key
    const privateKey = await ask('Enter private key (hex, with or without 0x prefix): ');
    let normalizedKey = privateKey;
    if (!normalizedKey.startsWith('0x')) {
      normalizedKey = '0x' + normalizedKey;
    }

    try {
      const wallet = walletManager.importWallet(normalizedKey as `0x${string}`);
      console.log(`\n✅ Wallet imported successfully!`);
      console.log(`   Address: ${wallet.info.address}`);
    } catch (err) {
      console.error(`\n❌ Failed to import wallet: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    console.log('Invalid choice.');
  }

  rl.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
