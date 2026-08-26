import 'dotenv/config';
import { WalletManager } from '../src/wallet/wallet-manager.js';

async function main() {
  const password = process.env['KEYSTORE_PASSWORD'] || 'default-dev-password';
  const walletManager = new WalletManager(password);
  
  try {
    const wallets = walletManager.loadWallets();
    console.log('📋 Existing Wallets & Private Keys:');
    for (const w of wallets) {
      const privateKey = walletManager.getPrivateKey(w.info.index);
      console.log(`   #${w.info.index}: ${w.info.address}`);
      console.log(`      Key: ${privateKey}`);
    }
  } catch (err) {
    console.error('Error loading wallets:', err);
  }
}

main();
