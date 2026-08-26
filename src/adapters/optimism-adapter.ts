/**
 * Optimism mainnet adapter — thin wrapper over EvmAdapterBase.
 */

import { optimism } from 'viem/chains';
import { EvmAdapterBase } from './evm-adapter.js';
import type { ChainId, EvmChainConfig } from '../types/chains.js';
import type { EventBus } from '../core/event-bus.js';

export class OptimismAdapter extends EvmAdapterBase {
  readonly chain: ChainId = 'optimism';
  protected viemChain = optimism;

  constructor(config: EvmChainConfig, eventBus: EventBus) {
    super(config, eventBus, 'adapter:optimism');
  }
}
