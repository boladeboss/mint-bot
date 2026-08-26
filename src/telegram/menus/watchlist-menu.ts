/**
 * Watchlist management inline keyboards.
 */

import { Markup } from 'telegraf';
import { CHAIN_EMOJI } from '../../core/constants.js';
import type { WatchlistEntry } from '../../types/strategy.js';

/** Watchlist display with remove buttons */
export function watchlistKeyboard(entries: WatchlistEntry[]) {
  const buttons = entries.map((e, i) => {
    const emoji = CHAIN_EMOJI[e.chain];
    const short = `${e.contractAddress.slice(0, 8)}...`;
    return [
      Markup.button.callback(
        `${emoji} ${e.name} (${short})`,
        `watchlist:info:${i}`
      ),
      Markup.button.callback('❌', `watchlist:remove:${i}`),
    ];
  });

  if (entries.length === 0) {
    buttons.push([Markup.button.callback('📭 Watchlist is empty', 'noop')]);
  }

  buttons.push([Markup.button.callback('➕ Add Contract', 'watchlist:add')]);
  buttons.push([Markup.button.callback('◀️ Back', 'menu:main')]);

  return Markup.inlineKeyboard(buttons);
}

/** Chain selection for adding to watchlist */
export function chainSelectKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⟠ Ethereum', 'watchlist:chain:ethereum'),
      Markup.button.callback('◎ Solana', 'watchlist:chain:solana'),
      Markup.button.callback('🔵 Base', 'watchlist:chain:base'),
    ],
    [Markup.button.callback('◀️ Cancel', 'menu:watchlist')],
  ]);
}
