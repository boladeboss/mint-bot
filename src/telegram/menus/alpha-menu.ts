import { Markup } from 'telegraf';
import type { AlphaWallet } from '../../types/strategy.js';

/** List tracked Alpha Wallets */
export function alphaListKeyboard(wallets: AlphaWallet[]) {
  const buttons = wallets.map((w, index) => [
    Markup.button.callback(
      `${w.enabled ? '🟢' : '🔴'} ${w.name} (${w.address.slice(0, 6)}...${w.address.slice(-4)})`,
      `alpha:detail:${index}`
    )
  ]);

  return Markup.inlineKeyboard([
    ...buttons,
    [Markup.button.callback('➕ Add Alpha', 'alpha:add')],
    [Markup.button.callback('◀️ Back', 'menu:main')]
  ]);
}

/** Detail view for a specific Alpha Wallet */
export function alphaDetailKeyboard(index: number, enabled: boolean) {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback(enabled ? '🔴 Disable' : '🟢 Enable', `alpha:toggle:${index}`),
      Markup.button.callback('🗑️ Delete', `alpha:delete:${index}`)
    ],
    [Markup.button.callback('◀️ Back', 'menu:alphas')]
  ]);
}
