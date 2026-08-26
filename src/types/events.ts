/**
 * Event type definitions for the typed event bus.
 * Uses discriminated unions so TypeScript narrows payload types automatically.
 */

import type { ChainId } from './chains.js';

/** A detected mint opportunity */
export interface MintOpportunity {
  chain: ChainId;
  contractAddress: string;
  mintFunction: string;
  price: bigint;
  estimatedGas: bigint;
  detectedAt: number;
  metadata?: {
    name?: string;
    symbol?: string;
    totalSupply?: number;
    source?: string;
  };
}

/** A mint transaction in progress */
export interface MintExecution {
  chain: ChainId;
  contractAddress: string;
  walletAddress: string;
  txHash: string;
  sentAt: number;
}

/** A successfully confirmed mint */
export interface MintResult {
  chain: ChainId;
  txHash: string;
  contractAddress: string;
  tokenId?: string;
  gasCost: bigint;
  walletAddress: string;
  confirmedAt: number;
}

/** A failed mint attempt */
export interface MintFailure {
  chain: ChainId;
  contractAddress: string;
  walletAddress: string;
  reason: string;
  gasCost: bigint;
  failedAt: number;
}

/** Wallet balance update */
export interface WalletBalance {
  chain: ChainId;
  address: string;
  balance: bigint;
}

/** Discriminated union of all bot events */
export type BotEvent =
  | { type: 'mint:detected'; payload: MintOpportunity }
  | { type: 'mint:executing'; payload: MintExecution }
  | { type: 'mint:confirmed'; payload: MintResult }
  | { type: 'mint:failed'; payload: MintFailure }
  | { type: 'chain:connected'; payload: { chain: ChainId } }
  | { type: 'chain:disconnected'; payload: { chain: ChainId; reason: string } }
  | { type: 'wallet:balance-updated'; payload: WalletBalance }
  | { type: 'alpha:tx:detected'; payload: { chain: ChainId; tx: any } };

/** All valid event type strings */
export type BotEventType = BotEvent['type'];

/** Extract the payload type for a given event type */
export type EventPayload<T extends BotEventType> = Extract<BotEvent, { type: T }>['payload'];
