/**
 * Type-safe event bus built on Node.js EventEmitter.
 * Ensures emit() and on() calls use matching event types and payloads.
 */

import { EventEmitter } from 'node:events';
import type { BotEventType, EventPayload } from '../types/events.js';

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    // Allow many listeners for high-throughput event routing
    this.emitter.setMaxListeners(50);
  }

  /** Emit a typed event */
  emit<T extends BotEventType>(type: T, payload: EventPayload<T>): void {
    this.emitter.emit(type, payload);
  }

  /** Subscribe to a typed event */
  on<T extends BotEventType>(type: T, handler: (payload: EventPayload<T>) => void): void {
    this.emitter.on(type, handler as (...args: unknown[]) => void);
  }

  /** Subscribe to a typed event (fires once) */
  once<T extends BotEventType>(type: T, handler: (payload: EventPayload<T>) => void): void {
    this.emitter.once(type, handler as (...args: unknown[]) => void);
  }

  /** Unsubscribe from a typed event */
  off<T extends BotEventType>(type: T, handler: (payload: EventPayload<T>) => void): void {
    this.emitter.off(type, handler as (...args: unknown[]) => void);
  }

  /** Remove all listeners for a specific event type */
  removeAllListeners(type?: BotEventType): void {
    if (type) {
      this.emitter.removeAllListeners(type);
    } else {
      this.emitter.removeAllListeners();
    }
  }
}

/** Global singleton event bus */
export const eventBus = new EventBus();
