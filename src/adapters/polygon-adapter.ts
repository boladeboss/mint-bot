/**
 * Polygon mainnet adapter — thin wrapper over EvmAdapterBase.
 */

import { polygon } from 'viem/chains';
import { EvmAdapterBase } from './evm-adapter.js';
import type { ChainId, EvmChainConfig } from '../types/chains.js';
import type { EventBus } from '../core/event-bus.js';

export class PolygonAdapter extends EvmAdapterBase {
  readonly chain: ChainId = 'polygon';
  protected viemChain = polygon;

  constructor(config: EvmChainConfig, eventBus: EventBus) {
    super(config, eventBus, 'adapter:polygon');
  }
}
