/**
 * Wallet management inline keyboards.
 */

import { Markup } from 'telegraf';
import type { WalletState } from '../../types/wallet.js';

/** Wallet list with selection buttons */
export function walletListKeyboard(wallets: WalletState[]) {
  const buttons = wallets.map((w) => {
    const addr = w.info.address;
    const label = w.info.label ?? `Wallet #${w.info.index}`;
    const short = `${addr.slice(0, 6)}...${addr.slice(-4)}`;
    return [Markup.button.callback(`👛 ${label} (${short})`, `wallet:detail:${w.info.index}`)];
  });

  buttons.push([
    Markup.button.callback('➕ Generate Wallet', 'wallet:add:1'),
    Markup.button.callback('➕ Generate Batch', 'wallet:batch')
  ]);
  buttons.push([Markup.button.callback('📥 Import Wallet', 'wallet:import')]);
  buttons.push([Markup.button.callback('◀️ Back', 'menu:main')]);

  return Markup.inlineKeyboard(buttons);
}

/** Keyboard when no wallets exist */
export function emptyWalletKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Generate Wallet', 'wallet:add:1'),
      Markup.button.callback('➕ Generate Batch', 'wallet:batch')
    ],
    [Markup.button.callback('📥 Import Wallet', 'wallet:import')],
    [Markup.button.callback('◀️ Back', 'menu:main')]
  ]);
}

/** Wallet detail view with actions */
export function walletDetailKeyboard(index: number, label: string) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('📥 Import a wallet', 'wallet:import'),
      Markup.button.callback('💼 Preferred Wallet', `wallet:preferred:${index}`),
    ],
    [
      Markup.button.callback('🔑 Export private key', `wallet:secrets:${index}`),
      Markup.button.callback('🗑️ Delete wallet', `wallet:delete:${index}`),
    ],
    [
      Markup.button.callback('💰 Transfer Currency', `wallet:transfer_eth:${index}`),
      Markup.button.callback('🪙 Transfer Token', `wallet:transfer_nft:${index}`),
    ],
    [
      Markup.button.callback('🔄 Swap Currency', `wallet:swap:${index}`),
      Markup.button.callback('🔀 Split / Consolidate', `wallet:split:${index}`),
    ],
    [
      Markup.button.callback('🏷 Label', `wallet:rename:${index}`),
    ],
    [
      Markup.button.callback(`${label} ✅`, `wallet:copy:${index}`),
    ],
    [
      Markup.button.callback('➕ New Wallet', 'wallet:add:1'),
      Markup.button.callback('🔀 Reorder', 'wallet:reorder'),
    ],
    [
      Markup.button.callback('🏷 Wallet bar labels: ON', 'wallet:toggle_labels'),
      Markup.button.callback('👥 Wallet groups: OFF', 'wallet:toggle_groups'),
    ],
    [
      Markup.button.callback('⬅️', 'menu:wallets'),
      Markup.button.callback('🔄 Refresh', `wallet:refresh:${index}`),
    ],
  ]);
}
