/**
 * Robinhood network adapter — custom chain wrapper over EvmAdapterBase.
 */

import { defineChain } from 'viem';
import { EvmAdapterBase } from './evm-adapter.js';
import type { ChainId, EvmChainConfig } from '../types/chains.js';
import type { EventBus } from '../core/event-bus.js';

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  network: 'robinhood',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.mainnet.chain.robinhood.com'],
    },
    public: {
      http: ['https://rpc.mainnet.chain.robinhood.com'],
    },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
});

export class RobinhoodAdapter extends EvmAdapterBase {
  readonly chain: ChainId = 'robinhood';
  protected viemChain = robinhoodChain;

  constructor(config: EvmChainConfig, eventBus: EventBus) {
    super(config, eventBus, 'adapter:robinhood');
  }
}
