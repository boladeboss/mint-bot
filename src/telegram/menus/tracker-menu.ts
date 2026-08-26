import { Markup } from 'telegraf';

/** Tracker main menu */
export function trackerKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('➕ Add Contract', 'tracker:add'),
      Markup.button.callback('📋 View Monitored', 'tracker:list')
    ],
    [Markup.button.callback('◀️ Back to Main Menu', 'menu:main')]
  ]);
}
