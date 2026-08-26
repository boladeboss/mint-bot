/**
 * Abstract base class for all chain adapters.
 * Provides WebSocket lifecycle management with auto-reconnect.
 */

import { createLogger } from '../core/logger.js';
import { MAX_RECONNECT_ATTEMPTS, BASE_RECONNECT_DELAY_MS, MAX_RECONNECT_DELAY_MS } from '../core/constants.js';
import type { EventBus } from '../core/event-bus.js';
import type { ChainId, IChainAdapter, MintTransaction, ArmedTransaction } from '../types/chains.js';
import type { MintOpportunity, MintResult } from '../types/events.js';
import type pino from 'pino';

export abstract class BaseChainAdapter implements IChainAdapter {
  abstract readonly chain: ChainId;
  abstract getGasPrice(): Promise<bigint>;
  abstract getContractInfo(address: string): Promise<import('../types/chains.js').ContractInfo | null>;
  abstract getPublicClient(): import('viem').PublicClient;
  abstract getTokenBalance(address: string, tokenAddress: string): Promise<bigint>;

  protected connected = false;
  protected reconnectAttempts = 0;
  protected reconnectTimer?: ReturnType<typeof setTimeout>;
  protected eventBus: EventBus;
  protected log: pino.Logger;

  constructor(eventBus: EventBus, componentName: string) {
    this.eventBus = eventBus;
    this.log = createLogger(componentName);
  }

  /** Check connection status */
  isConnected(): boolean {
    return this.connected;
  }

  /** Connect with error handling and logging */
  async connect(): Promise<void> {
    try {
      this.log.info('Connecting...');
      await this.doConnect();
      this.connected = true;
      this.reconnectAttempts = 0;
      this.eventBus.emit('chain:connected', { chain: this.chain });
      this.log.info('Connected successfully');
    } catch (err) {
      this.log.error({ err }, 'Connection failed');
      this.handleDisconnect('Connection failed');
    }
  }

  /** Disconnect with cleanup */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    try {
      await this.doDisconnect();
    } catch (err) {
      this.log.error({ err }, 'Error during disconnect');
    }
    this.connected = false;
    this.log.info('Disconnected');
  }

  /**
   * Handle an unexpected disconnection — emits event and schedules reconnect.
   */
  protected handleDisconnect(reason: string): void {
    const wasConnected = this.connected;
    this.connected = false;
    
    if (wasConnected) {
      this.eventBus.emit('chain:disconnected', { chain: this.chain, reason });
    }

    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
        MAX_RECONNECT_DELAY_MS
      );
      this.reconnectAttempts++;
      this.log.warn(
        { attempt: this.reconnectAttempts, delayMs: delay },
        'Scheduling reconnect'
      );
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch((err) => {
          this.log.error({ err }, 'Reconnect attempt failed');
        });
      }, delay);
    } else {
      this.log.error('Max reconnect attempts reached — giving up');
    }
  }

  // ─── Abstract methods for subclasses ───────────────────

  protected abstract doConnect(): Promise<void>;
  protected abstract doDisconnect(): Promise<void>;

  abstract onNewContract(cb: (event: MintOpportunity) => void): void;
  abstract watchContract(address: string, cb: (event: MintOpportunity) => void): void;
  abstract estimateGas(tx: MintTransaction): Promise<bigint>;
  abstract armTransaction(tx: MintTransaction, privateKey: `0x${string}`): Promise<ArmedTransaction>;
  abstract sendRawTransaction(armedTx: ArmedTransaction): Promise<MintResult>;
  abstract sendMint(tx: MintTransaction, privateKey: `0x${string}`): Promise<MintResult>;
  abstract getBalance(address: string): Promise<bigint>;
  abstract reconnect(newRpcWs: string): Promise<void>;
  abstract sendGenericTransaction(tx: { to: string; value: bigint; data: string; customGas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } }, privateKey: `0x${string}`): Promise<string>;
  abstract signEIP712Message(data: any, privateKey: `0x${string}`): Promise<string>;
}
