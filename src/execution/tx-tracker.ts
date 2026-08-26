/**
 * Transaction tracker — monitors pending transactions for confirmations, timeouts, and retries.
 */

import { createLogger } from '../core/logger.js';
import { updateMintStatus } from '../storage/models.js';
import type { Database } from 'sql.js';
import type { EventBus } from '../core/event-bus.js';
import type { ChainId } from '../types/chains.js';
import type { MintResult, MintFailure } from '../types/events.js';

const log = createLogger('tx-tracker');

/** A pending transaction being tracked */
export interface PendingTransaction {
  id: number;
  chain: ChainId;
  txHash: string;
  contractAddress: string;
  walletAddress: string;
  sentAt: number;
  retryCount: number;
}

export class TxTracker {
  private pending = new Map<string, PendingTransaction>();
  private eventBus: EventBus;
  private db: Database;
  private timeoutCheckInterval?: ReturnType<typeof setInterval>;

  constructor(eventBus: EventBus, db: Database) {
    this.eventBus = eventBus;
    this.db = db;
  }

  /** Add a transaction to the tracking queue */
  track(tx: PendingTransaction): void {
    this.pending.set(tx.txHash, tx);
    log.info({ txHash: tx.txHash, chain: tx.chain }, 'Tracking transaction');
  }

  /** Mark a transaction as confirmed */
  resolve(txHash: string, result: MintResult): void {
    const tx = this.pending.get(txHash);
    if (tx) {
      this.pending.delete(txHash);
      updateMintStatus(
        this.db,
        tx.id,
        'confirmed',
        result.txHash,
        result.gasCost.toString(),
        result.tokenId
      );
      this.eventBus.emit('mint:confirmed', result);
      log.info({ txHash, chain: result.chain }, 'Transaction confirmed');
    }
  }

  /** Mark a transaction as failed */
  reject(txHash: string, failure: MintFailure): void {
    const tx = this.pending.get(txHash);
    if (tx) {
      this.pending.delete(txHash);
      updateMintStatus(this.db, tx.id, 'failed');
      this.eventBus.emit('mint:failed', failure);
      log.warn({ txHash, reason: failure.reason }, 'Transaction failed');
    }
  }

  /** Get all pending transactions */
  getPending(): PendingTransaction[] {
    return Array.from(this.pending.values());
  }

  /** Find transactions that have been pending longer than the timeout */
  checkTimeouts(timeoutMs: number): PendingTransaction[] {
    const now = Date.now();
    return Array.from(this.pending.values()).filter(
      (tx) => now - tx.sentAt > timeoutMs
    );
  }

  /** Start periodic timeout checking */
  startTimeoutChecker(intervalMs = 30_000, timeoutMs = 120_000): void {
    this.timeoutCheckInterval = setInterval(() => {
      const timedOut = this.checkTimeouts(timeoutMs);
      for (const tx of timedOut) {
        log.warn({ txHash: tx.txHash, chain: tx.chain }, 'Transaction timed out');
        this.reject(tx.txHash, {
          chain: tx.chain,
          contractAddress: tx.contractAddress,
          walletAddress: tx.walletAddress,
          reason: 'Transaction timed out',
          gasCost: 0n,
          failedAt: Date.now(),
        });
      }
    }, intervalMs);
  }

  /** Stop the timeout checker */
  stop(): void {
    if (this.timeoutCheckInterval) {
      clearInterval(this.timeoutCheckInterval);
    }
  }
}
