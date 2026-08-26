import 'dotenv/config';
import { loadConfig } from '../src/types/config.js';
const config = loadConfig();
console.log(config.chains.ethereum.rpcWs);
console.log(config.chains.base.rpcWs);
console.log(process.env.ALCHEMY_API_KEY);
