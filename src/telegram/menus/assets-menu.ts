import { Markup } from 'telegraf';
import type { WalletState } from '../../types/wallet.js';

export function assetsMenuKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('💸 Transfer ETH', 'assets:transfer_eth'),
      Markup.button.callback('🎫 Transfer NFT', 'assets:transfer_nft'),
    ],
    [
      Markup.button.callback('💦 Disperse ETH', 'assets:disperse_eth'),
      Markup.button.callback('📥 Consolidate ETH', 'assets:consolidate_eth'),
    ],
    [
      Markup.button.callback('🧹 Sweep NFTs', 'assets:sweep_nfts'),
    ],
    [Markup.button.callback('◀️ Back', 'menu:main')],
  ]);
}

/** Menu for selecting a wallet for asset operations */
export function assetWalletSelectKeyboard(wallets: WalletState[], action: string, chain: string) {
  const buttons = wallets.map(w => {
    const label = w.info.label ?? `Wallet ${w.info.index + 1}`;
    return [Markup.button.callback(`👛 ${label}`, `assets:select_wallet:${action}:${chain}:${w.info.index}`)];
  });

  buttons.push([Markup.button.callback('◀️ Cancel', 'menu:assets')]);
  return Markup.inlineKeyboard(buttons);
}

/** Menu for selecting a destination wallet (including external option) */
export function assetDestinationKeyboard(wallets: WalletState[], action: string, chain: string, sourceIndex: number) {
  const buttons = wallets.map(w => {
    const label = w.info.label ?? `Wallet ${w.info.index + 1}`;
    return [Markup.button.callback(`👛 ${label}`, `assets:dest_wallet:${action}:${chain}:${sourceIndex}:${w.info.index}`)];
  });

  buttons.push([Markup.button.callback('📤 External Wallet', `assets:dest_external:${action}:${chain}:${sourceIndex}`)]);
  buttons.push([Markup.button.callback('◀️ Cancel', 'menu:assets')]);
  return Markup.inlineKeyboard(buttons);
}
