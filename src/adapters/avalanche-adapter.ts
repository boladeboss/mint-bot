/**
 * Avalanche C-Chain adapter — thin wrapper over EvmAdapterBase.
 */

import { avalanche } from 'viem/chains';
import { EvmAdapterBase } from './evm-adapter.js';
import type { ChainId, EvmChainConfig } from '../types/chains.js';
import type { EventBus } from '../core/event-bus.js';

export class AvalancheAdapter extends EvmAdapterBase {
  readonly chain: ChainId = 'avalanche';
  protected viemChain = avalanche;

  constructor(config: EvmChainConfig, eventBus: EventBus) {
    super(config, eventBus, 'adapter:avalanche');
  }
}
