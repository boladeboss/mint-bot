/**
 * Base L2 adapter — thin wrapper over EvmAdapterBase for Base chain.
 */

import { base } from 'viem/chains';
import { EvmAdapterBase } from './evm-adapter.js';
import type { ChainId, EvmChainConfig } from '../types/chains.js';
import type { EventBus } from '../core/event-bus.js';

export class BaseL2Adapter extends EvmAdapterBase {
  readonly chain: ChainId = 'base';
  protected viemChain = base;

  constructor(config: EvmChainConfig, eventBus: EventBus) {
    super(config, eventBus, 'adapter:base');
  }
}
