import { Markup } from 'telegraf';
import { CHAIN_NAMES, CHAIN_EMOJI } from '../../core/constants.js';
import type { ChainId } from '../../types/chains.js';

/** Menu for toggling chains on and off */
export function chainToggleKeyboard(enabledChains: ChainId[]) {
  const chains = Object.keys(CHAIN_NAMES) as ChainId[];
  const buttons = chains.map(chain => {
    const isEnabled = enabledChains.includes(chain);
    const emoji = CHAIN_EMOJI[chain] ?? '🔹';
    const name = CHAIN_NAMES[chain] ?? chain;
    
    return [
      Markup.button.callback(
        `${emoji} ${name}: ${isEnabled ? '✅ ON' : '❌ OFF'}`,
        `chain:toggle:${chain}`
      )
    ];
  });

  buttons.push([Markup.button.callback('◀️ Back to Main Menu', 'menu:main')]);
  return Markup.inlineKeyboard(buttons);
}

/** Menu for selecting a chain for an asset action */
export function chainSelectionKeyboard(enabledChains: ChainId[], action: string) {
  const buttons = enabledChains.map(chain => {
    const emoji = CHAIN_EMOJI[chain] ?? '🔹';
    const name = CHAIN_NAMES[chain] ?? chain;
    
    return [
      Markup.button.callback(
        `${emoji} ${name}`,
        `assets:chain:${action}:${chain}`
      )
    ];
  });

  buttons.push([Markup.button.callback('◀️ Cancel', 'menu:main')]);
  return Markup.inlineKeyboard(buttons);
}

/** Menu for selecting a chain for a portfolio action */
export function portfolioChainSelectionKeyboard(enabledChains: ChainId[], action: string, walletIndex: number) {
  const buttons = enabledChains.map(chain => {
    const emoji = CHAIN_EMOJI[chain] ?? '🔹';
    const name = CHAIN_NAMES[chain] ?? chain;
    
    return [
      Markup.button.callback(
        `${emoji} ${name}`,
        `portfolio:chain:${action}:${walletIndex}:${chain}`
      )
    ];
  });

  buttons.push([Markup.button.callback('◀️ Cancel', 'menu:main')]);
  return Markup.inlineKeyboard(buttons);
}
