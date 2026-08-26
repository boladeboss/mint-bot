/**
 * Ethereum mainnet adapter — thin wrapper over EvmAdapterBase.
 */

import { mainnet } from 'viem/chains';
import { EvmAdapterBase } from './evm-adapter.js';
import type { ChainId, EvmChainConfig } from '../types/chains.js';
import type { EventBus } from '../core/event-bus.js';

export class EthereumAdapter extends EvmAdapterBase {
  readonly chain: ChainId = 'ethereum';
  protected viemChain = mainnet;

  constructor(config: EvmChainConfig, eventBus: EventBus) {
    super(config, eventBus, 'adapter:ethereum');
  }
}
