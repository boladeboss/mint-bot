/**
 * Arbitrum One mainnet adapter — thin wrapper over EvmAdapterBase.
 */

import { arbitrum } from 'viem/chains';
import { EvmAdapterBase } from './evm-adapter.js';
import type { ChainId, EvmChainConfig } from '../types/chains.js';
import type { EventBus } from '../core/event-bus.js';

export class ArbitrumAdapter extends EvmAdapterBase {
  readonly chain: ChainId = 'arbitrum';
  protected viemChain = arbitrum;

  constructor(config: EvmChainConfig, eventBus: EventBus) {
    super(config, eventBus, 'adapter:arbitrum');
  }
}
