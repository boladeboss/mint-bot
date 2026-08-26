/**
 * BNB Smart Chain adapter — thin wrapper over EvmAdapterBase.
 */

import { bsc } from 'viem/chains';
import { EvmAdapterBase } from './evm-adapter.js';
import type { ChainId, EvmChainConfig } from '../types/chains.js';
import type { EventBus } from '../core/event-bus.js';

export class BscAdapter extends EvmAdapterBase {
  readonly chain: ChainId = 'bsc';
  protected viemChain = bsc;

  constructor(config: EvmChainConfig, eventBus: EventBus) {
    super(config, eventBus, 'adapter:bsc');
  }
}
