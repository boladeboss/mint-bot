import 'dotenv/config';
import { WalletManager } from '../src/wallet/wallet-manager.js';

async function main() {
  const password = process.env['KEYSTORE_PASSWORD'] || 'mint-bot-dev-2026';
  const manager = new WalletManager(password);
  
  console.log("Generating 3 wallets...");
  const wallets = manager.generateWallets(undefined, 3);
  const mnemonic = manager.getMnemonic();
  
  console.log("\n✅ Wallets generated successfully!");
  console.log("📋 Wallet Addresses:");
  for (const w of wallets) {
    console.log(`   #${w.info.index}: ${w.info.address}`);
  }
  
  console.log("\n⚠️ IMPORTANT — Save your recovery phrase:");
  console.log(mnemonic);
}

main().catch(console.error);
