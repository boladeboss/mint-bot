/**
 * Notification service — pushes real-time alerts to Telegram.
 * Subscribes to the event bus and sends formatted messages.
 */

import type { Telegraf, Context } from 'telegraf';
import { createLogger } from '../core/logger.js';
import { mintAlertKeyboard } from './menus/mint-menu.js';
import {
  formatMintAlert,
  formatMintSuccess,
  formatMintFailure,
  escapeMarkdownV2,
} from './formatters.js';
import { CHAIN_NAMES, CHAIN_EMOJI } from '../core/constants.js';
import { WEI_PER_ETH, LAMPORTS_PER_SOL } from '../core/constants.js';
import type { EventBus } from '../core/event-bus.js';
import type { MintOpportunity, MintResult, MintFailure, WalletBalance } from '../types/events.js';
import type { ChainId } from '../types/chains.js';
import type { AppConfig } from '../types/config.js';

const log = createLogger('notifications');

export class NotificationService {
  private bot: Telegraf<Context>;
  private chatId: number;
  private eventBus: EventBus;
  private config: AppConfig;
  private handlers: { event: string; handler: (...args: unknown[]) => void }[] = [];
  private digestInterval?: ReturnType<typeof setInterval>;
  private mintCountSinceLastDigest = 0;
  private gasSpentSinceLastDigest = 0n;

  constructor(bot: Telegraf<Context>, chatId: number, eventBus: EventBus, config: AppConfig) {
    this.bot = bot;
    this.chatId = chatId;
    this.eventBus = eventBus;
    this.config = config;
  }

  /** Start listening for events and sending notifications */
  start(): void {
    // Mint detected → send alert with action buttons
    const onMintDetected = (payload: MintOpportunity) => {
      this.sendMintAlert(payload).catch((err) => {
        log.error({ err }, 'Failed to send mint alert');
      });
    };
    this.eventBus.on('mint:detected', onMintDetected);
    this.handlers.push({ event: 'mint:detected', handler: onMintDetected as (...args: unknown[]) => void });

    // Mint confirmed → send success message
    const onMintConfirmed = (payload: MintResult) => {
      this.sendMessage(formatMintSuccess(payload)).catch((err) => {
        log.error({ err }, 'Failed to send mint success');
      });
      this.mintCountSinceLastDigest++;
      this.gasSpentSinceLastDigest += payload.gasCost;
    };
    this.eventBus.on('mint:confirmed', onMintConfirmed);
    this.handlers.push({ event: 'mint:confirmed', handler: onMintConfirmed as (...args: unknown[]) => void });

    // Tracker activity detected
    const onTrackerMint = (payload: MintOpportunity) => {
      const chainName = escapeMarkdownV2(CHAIN_NAMES[payload.chain] ?? payload.chain);
      const emoji = CHAIN_EMOJI[payload.chain] ?? '🔹';
      const contract = escapeMarkdownV2(payload.contractAddress);
      const msg = `🎯 *Tracker Alert*\n\n${emoji} *${chainName}*\nContract: \`${contract}\`\n\n_Mint activity detected!_`;
      this.sendMessage(msg).catch((err) => {
        log.error({ err }, 'Failed to send tracker alert');
      });
    };
    this.eventBus.on('tracker:mint:detected', onTrackerMint);
    this.handlers.push({ event: 'tracker:mint:detected', handler: onTrackerMint as (...args: unknown[]) => void });

    // Mint failed → send failure message
    const onMintFailed = (payload: MintFailure) => {
      this.sendMessage(formatMintFailure(payload)).catch((err) => {
        log.error({ err }, 'Failed to send mint failure');
      });
    };
    this.eventBus.on('mint:failed', onMintFailed);
    this.handlers.push({ event: 'mint:failed', handler: onMintFailed as (...args: unknown[]) => void });

    // Chain disconnected → send warning
    const onChainDisconnected = (payload: { chain: ChainId; reason: string }) => {
      const emoji = CHAIN_EMOJI[payload.chain];
      const name = CHAIN_NAMES[payload.chain];
      this.sendMessage(
        `⚠️ *Chain Disconnected*\n\n${emoji} ${escapeMarkdownV2(name)}\n❗ ${escapeMarkdownV2(payload.reason)}`
      ).catch((err) => {
        log.error({ err }, 'Failed to send disconnect warning');
      });
    };
    this.eventBus.on('chain:disconnected', onChainDisconnected);
    this.handlers.push({ event: 'chain:disconnected', handler: onChainDisconnected as (...args: unknown[]) => void });

    // Low balance warning
    const onBalanceUpdated = (payload: WalletBalance) => {
      this.checkLowBalance(payload);
    };
    this.eventBus.on('wallet:balance-updated', onBalanceUpdated);
    this.handlers.push({ event: 'wallet:balance-updated', handler: onBalanceUpdated as (...args: unknown[]) => void });

    // Hourly digest
    if (this.config.notifications.hourlyDigest) {
      this.digestInterval = setInterval(() => {
        this.sendHourlyDigest().catch((err) => {
          log.error({ err }, 'Failed to send hourly digest');
        });
      }, 3_600_000);
    }

    log.info({ chatId: this.chatId }, 'Notification service started');
  }

  /** Stop all event subscriptions */
  stop(): void {
    for (const { event, handler } of this.handlers) {
      this.eventBus.off(event as any, handler as any);
    }
    this.handlers = [];

    if (this.digestInterval) {
      clearInterval(this.digestInterval);
    }

    log.info('Notification service stopped');
  }

  /** Send a mint alert with action buttons */
  private async sendMintAlert(opp: MintOpportunity): Promise<void> {
    const message = formatMintAlert(opp);
    await this.bot.telegram.sendMessage(this.chatId, message, {
      parse_mode: 'MarkdownV2',
      ...mintAlertKeyboard(opp.chain, opp.contractAddress),
    });
  }

  /** Send a plain MarkdownV2 message */
  private async sendMessage(text: string): Promise<void> {
    await this.bot.telegram.sendMessage(this.chatId, text, {
      parse_mode: 'MarkdownV2',
    });
  }

  /** Check if a wallet balance is below the configured threshold */
  private checkLowBalance(payload: WalletBalance): void {
    const isEvm = true;
    const threshold = BigInt(Math.floor(this.config.notifications.lowBalanceThresholdEth * 1e18));

    if (payload.balance < threshold) {
      const emoji = CHAIN_EMOJI[payload.chain];
      const name = CHAIN_NAMES[payload.chain];
      this.sendMessage(
        `💰 *Low Balance Warning*\n\n${emoji} ${escapeMarkdownV2(name)}\n👛 \`${escapeMarkdownV2(payload.address)}\`\n⚠️ ${escapeMarkdownV2('Balance below threshold!')}`
      ).catch((err) => {
        log.error({ err }, 'Failed to send low balance warning');
      });
    }
  }

  /** Send an hourly activity summary */
  private async sendHourlyDigest(): Promise<void> {
    if (this.mintCountSinceLastDigest === 0) return; // Don't send empty digests

    const msg = [
      `📊 *Hourly Digest*`,
      ``,
      `🎯 Mints: ${escapeMarkdownV2(this.mintCountSinceLastDigest.toString())}`,
      `⛽ Gas spent: ${escapeMarkdownV2(this.gasSpentSinceLastDigest.toString())} wei`,
    ].join('\n');

    await this.sendMessage(msg);

    // Reset counters
    this.mintCountSinceLastDigest = 0;
    this.gasSpentSinceLastDigest = 0n;
  }
}
