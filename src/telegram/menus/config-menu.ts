/**
 * Strategy configuration inline keyboards.
 */

import { Markup } from 'telegraf';
import type { StrategyConfig } from '../../types/strategy.js';

/** Config overview with edit buttons */
export function configMenuKeyboard(config: StrategyConfig) {
  return Markup.inlineKeyboard([
    [Markup.button.callback(`🎯 Mode: [${config.mode}]`, 'config:edit:mode')],
    [Markup.button.callback(`💰 Max Price: [${config.maxMintPriceEth} ETH]`, 'config:edit:maxMintPriceEth')],
    [Markup.button.callback(`⛽ Max Gas: [${config.maxGasEth} ETH]`, 'config:edit:maxGasEth')],
    [Markup.button.callback(`⏱ Cooldown: [${config.cooldownSeconds}s]`, 'config:edit:cooldownSeconds')],
    [Markup.button.callback(`📊 Max/Hour: [${config.maxMintsPerHour}]`, 'config:edit:maxMintsPerHour')],
    [Markup.button.callback(`🤖 Auto Mint: [${config.autoMint ? 'ON' : 'OFF'}]`, 'config:toggle:autoMint')],
    [Markup.button.callback(`🎭 Copy-Mint: [${config.copyMintEnabled ? 'ON' : 'OFF'}]`, 'config:toggle:copyMint')],
    [Markup.button.callback(`🛣 Route: [${config.defaultRoute?.type ?? 'public'}]`, 'config:edit:route')],
    [Markup.button.callback('◀️ Back', 'menu:main')],
  ]);
}

/** Mode selection keyboard */
export function modeSelectKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🎯 Snipe', 'config:set:mode:snipe'),
      Markup.button.callback('📋 Watchlist', 'config:set:mode:watchlist'),
      Markup.button.callback('🖐 Manual', 'config:set:mode:manual'),
    ],
    [Markup.button.callback('◀️ Back', 'menu:config')],
  ]);
}

/** Gas aggression level selection */
export function aggressionSelectKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🐢 Conservative', 'config:set:aggression:conservative'),
      Markup.button.callback('⚖️ Normal', 'config:set:aggression:normal'),
    ],
    [
      Markup.button.callback('🔥 Aggressive', 'config:set:aggression:aggressive'),
      Markup.button.callback('🚀 Max', 'config:set:aggression:max'),
    ],
    [Markup.button.callback('◀️ Back', 'menu:config')],
  ]);
}

/** Route selection keyboard */
export function routeSelectKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🌐 Public RPC', 'config:set:route:public'),
      Markup.button.callback('⚡ Flashbots', 'config:set:route:flashbots'),
    ],
    [
      Markup.button.callback('🌪 RPC Fan-out', 'config:set:route:fanout'),
    ],
    [Markup.button.callback('◀️ Back', 'menu:config')],
  ]);
}
