/**
 * Strategy and filter type definitions.
 */

import type { ChainId, RouteConfig } from './chains.js';

/** Bot operating mode */
export type StrategyMode = 'snipe' | 'watchlist' | 'manual';

/** Strategy engine configuration */
export interface StrategyConfig {
  mode: StrategyMode;
  maxMintPriceEth: number;
  maxGasEth: number;
  maxMintsPerHour: number;
  cooldownSeconds: number;
  autoMint: boolean;
  copyMintEnabled: boolean;
  defaultRoute: RouteConfig;
}

/** Tracked alpha wallet for copy-minting */
export interface AlphaWallet {
  address: string;
  name: string;
  enabled: boolean;
  addedAt: number;
}

/** Result of a safety filter check */
export interface FilterResult {
  pass: boolean;
  reason?: string;
}

/** A watched NFT contract */
export interface WatchlistEntry {
  chain: ChainId;
  contractAddress: string;
  name: string;
  addedAt: number;
}
