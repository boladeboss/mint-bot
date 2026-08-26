/**
 * Inline keyboard menus for the main navigation.
 */

import { Markup } from 'telegraf';

/** Main menu 3×3 grid */
export function mainMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📊 Status', 'menu:status'),
      Markup.button.callback('💰 Wallets', 'menu:wallets'),
      Markup.button.callback('💸 Assets', 'menu:assets'),
    ],
    [
      Markup.button.callback('🖼️ Portfolio', 'menu:portfolio'),
      Markup.button.callback('📡 Tracker', 'menu:tracker'),
      Markup.button.callback('🔌 Chains', 'menu:chains'),
    ],
    [
      Markup.button.callback('🎯 Watchlist', 'menu:watchlist'),
      Markup.button.callback('📜 History', 'menu:history'),
      Markup.button.callback('⚙️ Config', 'menu:config'),
    ],
    [
      Markup.button.callback('🌐 RPCs', 'menu:rpc'),
      Markup.button.callback('⛽ Gas', 'menu:gas'),
      Markup.button.callback('❓ Help', 'menu:help'),
    ],
    [
      Markup.button.callback('▶️ Start', 'menu:resume'),
      Markup.button.callback('⏸️ Pause', 'menu:pause'),
    ],
  ]);
}
