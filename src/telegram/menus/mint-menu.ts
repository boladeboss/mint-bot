/**
 * Mint history and mint alert inline keyboards.
 */

import { Markup } from 'telegraf';
import type { ChainId } from '../../types/chains.js';

/** Mint history pagination */
export function mintHistoryKeyboard(page: number, totalPages: number) {
  const navButtons = [];

  if (page > 0) {
    navButtons.push(Markup.button.callback('◀️ Prev', `page:mints:${page - 1}`));
  }

  navButtons.push(Markup.button.callback(`${page + 1}/${totalPages}`, 'noop'));

  if (page < totalPages - 1) {
    navButtons.push(Markup.button.callback('Next ▶️', `page:mints:${page + 1}`));
  }

  return Markup.inlineKeyboard([
    navButtons,
    [Markup.button.callback('🎯 Manual Mint', 'mint:manual')],
    [Markup.button.callback('◀️ Back', 'menu:main')],
  ]);
}

/** Mint alert action buttons (shown when a new mint is detected) */
export function mintAlertKeyboard(chain: ChainId, contractAddress: string) {
  const encodedAddr = contractAddress.slice(0, 20); // Truncate for callback data limit (64 bytes)
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('⚡ ARM', `mint:arm:${chain}:${encodedAddr}`),
      Markup.button.callback('✅ MINT NOW', `mint:now:${chain}:${encodedAddr}`),
    ],
    [
      Markup.button.callback('👀 Watch', `mint:watch:${chain}:${encodedAddr}`),
      Markup.button.callback('❌ Skip', `mint:skip:${chain}:${encodedAddr}`),
    ],
  ]);
}

/** Armed mint keyboard (shown after a mint is armed) */
export function armedMintKeyboard(chain: ChainId, contractAddress: string) {
  const encodedAddr = contractAddress.slice(0, 20);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('🔥 FIRE', `mint:fire:${chain}:${encodedAddr}`),
      Markup.button.callback('❌ Cancel', `mint:cancel`),
    ],
  ]);
}

/** Mint confirmation buttons */
export function mintConfirmKeyboard(chain: ChainId, contractAddress: string) {
  const encodedAddr = contractAddress.slice(0, 20);
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Confirm', `mint:confirm:${chain}:${encodedAddr}`),
      Markup.button.callback('❌ Cancel', `mint:cancel`),
    ],
  ]);
}
