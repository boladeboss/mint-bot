/**
 * Telegram bot initialization and middleware setup.
 * Creates the Telegraf bot with auth guard, error handling, and command registration.
 */

import { Telegraf } from 'telegraf';
import { createLogger } from '../core/logger.js';
import { registerCommands, setCommandDeps, type CommandDeps } from './handlers/commands.js';
import { registerCallbacks, setCallbackDeps, type CallbackDeps } from './handlers/callbacks.js';
import type { AppConfig } from '../types/config.js';

const log = createLogger('telegram');

/**
 * Create and configure the Telegram bot.
 */
export function createBot(config: AppConfig): Telegraf {
  const token = process.env['TELEGRAM_BOT_TOKEN'];
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
  }

  const authorizedUserId = parseInt(process.env['TELEGRAM_USER_ID'] ?? '0', 10);
  if (!authorizedUserId) {
    log.warn('TELEGRAM_USER_ID not set — bot will respond to ALL users (insecure!)');
  }

  const bot = new Telegraf(token);

  // ─── Auth Middleware ─────────────────────────────────
  // Only respond to the authorized user
  if (authorizedUserId) {
    bot.use(async (ctx, next) => {
      if (ctx.from?.id !== authorizedUserId) {
        log.warn({ userId: ctx.from?.id }, 'Unauthorized access attempt');
        if (ctx.message) {
          await ctx.reply('⛔ Unauthorized. This bot is private.');
        }
        return;
      }
      await next();
    });
  }

  // ─── Error Handling Middleware ────────────────────────
  bot.catch((err, ctx) => {
    log.error({ err, updateType: ctx.updateType }, 'Telegram bot error');
    ctx.reply('⚠️ Something went wrong. Check the logs.').catch(() => {
      // Ignore reply errors in error handler
    });
  });

  // ─── Register Handlers ──────────────────────────────
  registerCommands(bot);
  registerCallbacks(bot);

  log.info('Telegram bot configured');
  return bot;
}

/**
 * Initialize bot dependencies (must be called before launching).
 */
export function initBotDeps(
  commandDeps: CommandDeps,
  callbackDeps: CallbackDeps
): void {
  setCommandDeps(commandDeps);
  setCallbackDeps(callbackDeps);
}
