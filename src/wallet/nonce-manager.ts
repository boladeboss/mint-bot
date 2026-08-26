/**
 * Per-chain nonce tracking to prevent nonce collisions during rapid mints.
 */

import type { ChainId } from '../types/chains.js';

export class NonceManager {
  private nonces = new Map<string, number>();

  private key(chain: ChainId, address: string): string {
    return `${chain}:${address.toLowerCase()}`;
  }

  /** Get the current nonce for a wallet on a chain */
  getNonce(chain: ChainId, address: string): number | undefined {
    return this.nonces.get(this.key(chain, address));
  }

  /** Set the nonce for a wallet on a chain */
  setNonce(chain: ChainId, address: string, nonce: number): void {
    this.nonces.set(this.key(chain, address), nonce);
  }

  /** Increment the nonce and return the new value */
  incrementNonce(chain: ChainId, address: string): number {
    const k = this.key(chain, address);
    const current = this.nonces.get(k) ?? 0;
    const next = current + 1;
    this.nonces.set(k, next);
    return next;
  }

  /** Reset the nonce for a wallet (e.g. after re-syncing from chain) */
  resetNonce(chain: ChainId, address: string): void {
    this.nonces.delete(this.key(chain, address));
  }

  /** Clear all tracked nonces */
  clear(): void {
    this.nonces.clear();
  }
}

/** Global singleton nonce manager */
export const nonceManager = new NonceManager();
