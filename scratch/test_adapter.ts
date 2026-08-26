import 'dotenv/config';
import { loadConfig } from '../src/types/config.js';
import { AvalancheAdapter } from '../src/adapters/avalanche-adapter.js';
import { BscAdapter } from '../src/adapters/bsc-adapter.js';
import { eventBus } from '../src/core/event-bus.js';

async function run() {
  const config = loadConfig();
  
  config.chains.avalanche.rpcWs = "wss://avalanche-c-chain-rpc.publicnode.com";
  config.chains.bsc.rpcWs = "wss://bsc-rpc.publicnode.com";
  
  const avaAdapter = new AvalancheAdapter(config.chains.avalanche, eventBus);
  const bscAdapter = new BscAdapter(config.chains.bsc, eventBus);
  
  try {
    await avaAdapter.connect();
    console.log("Avalanche connected!");
  } catch(e) { console.error("Ava fail", e); }
  
  try {
    await bscAdapter.connect();
    console.log("BSC connected!");
  } catch(e) { console.error("BSC fail", e); }
  
  console.log("Waiting 10 seconds...");
  await new Promise(r => setTimeout(r, 10000));
  console.log("Done");
  process.exit(0);
}

run();
