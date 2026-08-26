import { Markup } from 'telegraf';
import type { WalletState } from '../../types/wallet.js';

/** Menu for selecting a wallet for the portfolio */
export function portfolioWalletSelectKeyboard(wallets: WalletState[]) {
  const buttons = wallets.map(w => {
    const label = w.info.label ?? `Wallet ${w.info.index + 1}`;
    return [Markup.button.callback(`🖼️ ${label}`, `portfolio:wallet:${w.info.index}`)];
  });

  buttons.push([Markup.button.callback('◀️ Back to Main Menu', 'menu:main')]);
  return Markup.inlineKeyboard(buttons);
}

/** Menu for a specific wallet's portfolio */
export function portfolioDetailKeyboard(index: number) {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🔄 Refresh NFTs', `portfolio:refresh:${index}`)],
    [Markup.button.callback('◀️ Back to Portfolio', 'menu:portfolio')]
  ]);
}
