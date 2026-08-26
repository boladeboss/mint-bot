/**
 * Connection test script — verifies RPC endpoints are reachable.
 * Run with: npm run test:connection
 */

import 'dotenv/config';
import { loadConfig } from '../src/types/config.js';
import { EthereumAdapter } from '../src/adapters/ethereum-adapter.js';
import { SolanaAdapter } from '../src/adapters/solana-adapter.js';
import { BaseL2Adapter } from '../src/adapters/base-chain-adapter.js';
import { EventBus } from '../src/core/event-bus.js';

async function main(): Promise<void> {
  console.log('');
  console.log('🔌 NFT Mint Bot — Connection Test');
  console.log('===================================');
  console.log('');

  const config = loadConfig();
  const eventBus = new EventBus();
  let allPassed = true;

  // Test Ethereum
  if (config.chains.ethereum.enabled) {
    process.stdout.write('⟠  Ethereum... ');
    try {
      const adapter = new EthereumAdapter(config.chains.ethereum, eventBus);
      await adapter.connect();
      const balance = await adapter.getBalance('0x0000000000000000000000000000000000000000');
      console.log(`✅ Connected (zero addr balance: ${balance})`);
      await adapter.disconnect();
    } catch (err) {
      console.log(`❌ Failed: ${err instanceof Error ? err.message : err}`);
      allPassed = false;
    }
  } else {
    console.log('⟠  Ethereum: ⏭️  Disabled');
  }

  // Test Solana
  if (config.chains.solana.enabled) {
    process.stdout.write('◎  Solana...   ');
    try {
      const adapter = new SolanaAdapter(config.chains.solana, eventBus);
      await adapter.connect();
      const balance = await adapter.getBalance('11111111111111111111111111111111');
      console.log(`✅ Connected (system program balance: ${balance})`);
      await adapter.disconnect();
    } catch (err) {
      console.log(`❌ Failed: ${err instanceof Error ? err.message : err}`);
      allPassed = false;
    }
  } else {
    console.log('◎  Solana: ⏭️  Disabled');
  }

  // Test Base
  if (config.chains.base.enabled) {
    process.stdout.write('🔵 Base...     ');
    try {
      const adapter = new BaseL2Adapter(config.chains.base, eventBus);
      await adapter.connect();
      const balance = await adapter.getBalance('0x0000000000000000000000000000000000000000');
      console.log(`✅ Connected (zero addr balance: ${balance})`);
      await adapter.disconnect();
    } catch (err) {
      console.log(`❌ Failed: ${err instanceof Error ? err.message : err}`);
      allPassed = false;
    }
  } else {
    console.log('🔵 Base: ⏭️  Disabled');
  }

  console.log('');
  if (allPassed) {
    console.log('✅ All connection tests passed!');
    process.exit(0);
  } else {
    console.log('❌ Some connections failed. Check your RPC endpoints in config/default.yaml');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
