/**
 * Inline keyboard callback handlers.
 * Routes button presses to the appropriate action based on callback_data patterns.
 */

import { Markup, Context, Telegraf } from 'telegraf';
import { mainMenuKeyboard } from '../menus/main-menu.js';
import { chainToggleKeyboard, chainSelectionKeyboard } from '../menus/chain-menu.js';
import { portfolioWalletSelectKeyboard, portfolioDetailKeyboard } from '../menus/portfolio-menu.js';
import { trackerKeyboard } from '../menus/tracker-menu.js';
import { walletListKeyboard, walletDetailKeyboard } from '../menus/wallet-menu.js';
import { configMenuKeyboard, modeSelectKeyboard, aggressionSelectKeyboard } from '../menus/config-menu.js';
import { watchlistKeyboard, chainSelectKeyboard } from '../menus/watchlist-menu.js';
import { alphaListKeyboard, alphaDetailKeyboard } from '../menus/alpha-menu.js';
import { mintHistoryKeyboard } from '../menus/mint-menu.js';
import { armedMintKeyboard } from '../menus/mint-menu.js';
import { assetsMenuKeyboard, assetWalletSelectKeyboard, assetDestinationKeyboard } from '../menus/assets-menu.js';
import {
  escapeMarkdownV2,
  formatWalletBalance,
  formatStatus,
} from '../formatters.js';
import { createLogger } from '../../core/logger.js';
import { getRecentMints, getMintCount } from '../../storage/models.js';
import { CHAIN_NAMES, GWEI } from '../../core/constants.js';
import type { GasAggression } from '../../types/chains.js';
import { reservoirService } from '../../services/reservoir.js';
import { userState } from '../state.js';
import { getRpcs, setActiveRpc } from '../../storage/models.js';
import { getTrackers, removeTracker } from '../../storage/tracker-store.js';
import { getNativePriceUsd, getNativeSymbol } from '../../core/price-oracle.js';
import type { StrategyEngine } from '../../strategy/strategy-engine.js';
import type { WalletManager } from '../../wallet/wallet-manager.js';
import type { Executor } from '../../execution/executor.js';
import type { IChainAdapter, ChainId, RouteType, ArmedTransaction } from '../../types/chains.js';
import type { StrategyMode } from '../../types/strategy.js';
import type { Database } from 'sql.js';

const log = createLogger('telegram:callbacks');

export interface CallbackDeps {
  appConfig: import('../../types/config.js').AppConfig;
  strategyEngine: StrategyEngine;
  walletManager: WalletManager;
  executor: Executor;
  assetManager: import('../../execution/asset-manager.js').AssetManager;
  adapters: Map<ChainId, IChainAdapter>;
  db: Database;
  startTime: number;
  pendingInputs: Map<number, { field: string; callback: (value: string) => void }>;
  armedTxs: Map<string, ArmedTransaction>;
}

let deps: CallbackDeps;

export function setCallbackDeps(d: CallbackDeps): void {
  deps = d;
}

export function registerCallbacks(bot: Telegraf<Context>): void {
  bot.on('callback_query', async (ctx) => {
    const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data) {
      await ctx.answerCbQuery();
      return;
    }

    const parts = data.split(':');
    const category = parts[0];

    try {
      switch (category) {
        case 'menu':
          await handleMenu(ctx, parts[1]!);
          break;
        case 'chain': {
          if (parts[1] === 'toggle') {
            const chain = parts[2] as ChainId;
            const config = deps.appConfig;
            if (config.chains[chain]) {
              config.chains[chain]!.enabled = !config.chains[chain]!.enabled;
              
              const adapter = deps.adapters.get(chain);
              if (adapter) {
                if (config.chains[chain]!.enabled) {
                  adapter.connect().catch(() => {});
                } else {
                  adapter.disconnect().catch(() => {});
                }
              }
              
              const enabledChains = Object.entries(config.chains)
                .filter(([_, c]) => c?.enabled)
                .map(([c]) => c as ChainId);

              await ctx.editMessageText('🔌 *Chain Management*\n\nEnable or disable chains:', {
                parse_mode: 'MarkdownV2',
                ...chainToggleKeyboard(enabledChains)
              });
            }
          }
          break;
        }
        case 'wallet':
          await handleWallet(ctx, parts.slice(1));
          break;
        case 'portfolio':
          await handlePortfolio(ctx, parts.slice(1));
          break;
        case 'tracker':
          await handleTracker(ctx, parts.slice(1));
          break;
        case 'config':
          await handleConfig(ctx, parts.slice(1));
          break;
        case 'watchlist':
          await handleWatchlist(ctx, parts.slice(1));
          break;
        case 'alpha':
          await handleAlpha(ctx, parts.slice(1));
          break;
        case 'mint':
          await handleMint(ctx, parts.slice(1));
          break;
        case 'assets':
          await handleAssets(ctx, parts.slice(1));
          break;
        case 'page':
          await handlePagination(ctx, parts.slice(1));
          break;
        case 'delete_message':
          await handleDeleteMessage(ctx);
          break;
        case 'ca':
          await handleCa(ctx, parts);
          break;
        case 'gas':
          await handleGasConfig(ctx, parts);
          break;
        case 'chains': {
          const config = deps.appConfig;
          const enabledChains = Object.entries(config.chains)
            .filter(([_, c]) => c?.enabled)
            .map(([c]) => c as ChainId);
          await ctx.editMessageText('🔌 *Chain Management*\n\nEnable or disable chains:', {
            parse_mode: 'MarkdownV2',
            ...chainToggleKeyboard(enabledChains)
          });
          break;
        }
        case 'portfolio':
        await ctx.editMessageText('🖼️ *NFT Portfolio*\n\nSelect a wallet to view its NFTs:', {
          parse_mode: 'MarkdownV2',
          ...portfolioWalletSelectKeyboard(deps.walletManager.getAllWallets())
        });
        break;
      case 'tracker':
        await ctx.editMessageText('📡 *Smart Contract Tracker*\n\nManage monitored contracts and alerts:', {
          parse_mode: 'MarkdownV2',
          ...trackerKeyboard()
        });
        break;
        case 'rpc':
          await handleRpc(ctx, parts);
          break;
        case 'noop':
          break;
        default:
          log.warn({ data }, 'Unknown callback data');
      }
    } catch (err) {
      log.error({ err, data }, 'Callback handler error');
      await ctx.answerCbQuery('Something went wrong').catch(() => {});
    }

    await ctx.answerCbQuery().catch(() => {});
  });

  // Handle text input for config edits
  bot.on('text', async (ctx, next) => {
    const userId = ctx.from.id;
    const pending = deps.pendingInputs.get(userId);

    if (pending) {
      pending.callback(ctx.message.text);
      deps.pendingInputs.delete(userId);
      return;
    }

    await next();
  });
}

// ─── Menu Navigation ─────────────────────────────────────

async function handleMenu(ctx: Context, action: string): Promise<void> {
  switch (action) {
    case 'main': {
      await ctx.editMessageText('🤖 *NFT Mint Bot*\n\nChoose an option:', {
        parse_mode: 'MarkdownV2',
        ...mainMenuKeyboard(),
      });
      break;
    }
    case 'status': {
      const chains = (['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', ] as ChainId[]).map((chain) => ({
        chain,
        connected: deps.adapters.get(chain)?.isConnected() ?? false,
      }));
      const uptime = Date.now() - deps.startTime;
      const mode = deps.strategyEngine.getConfig().mode;
      const msg = formatStatus(chains, uptime, deps.walletManager.count, mode);
      await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...mainMenuKeyboard() });
      break;
    }
    case 'wallets': {
      const wallets = deps.walletManager.getAllWallets();
      const lines = wallets.map(formatWalletBalance);
      const msg = wallets.length > 0
        ? `💰 *Wallets*\n\n${lines.join('\n\n')}`
        : `💰 *Wallets*\n\n${escapeMarkdownV2('No wallets configured.')}`;
      await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...walletListKeyboard(wallets) });
      break;
    }
    case 'assets':
      await handleAssets(ctx, ['menu']);
      break;
    case 'portfolio':
      await handlePortfolio(ctx, ['menu']);
      break;
    case 'tracker':
      await handleTracker(ctx, ['list']);
      break;
    case 'chains':
      // The chains menu is handled in the top-level 'chain' category but let's delegate it if needed, or implement it here
      await ctx.editMessageText('🔌 *Chain Management*\n\nEnable or disable chains:', {
        parse_mode: 'MarkdownV2',
        ...chainToggleKeyboard(Array.from(deps.adapters.keys()))
      });
      break;
    case 'rpc':
      await handleRpc(ctx, ['menu']);
      break;
    case 'config':
      await handleConfig(ctx, ['menu']);
      break;
    case 'help':
      await ctx.editMessageText('❓ *Help & Commands*\n\n' +
        `/start \\- Show main menu\n` +
        `/status \\- View bot status\n` +
        `/gas \\- Multi\\-chain gas tracker\n` +
        `/wallets \\- Manage wallets\n` +
        `/portfolio \\- View NFTs\n` +
        `/watchlist \\- Tracked contracts\n` +
        `/config \\- Bot settings\n` +
        `/history \\- Recent mints`, 
        { parse_mode: 'MarkdownV2', reply_markup: { inline_keyboard: [[{ text: '◀️ Back', callback_data: 'menu:main' }]] } }
      );
      break;
    case 'gas': {
      await ctx.editMessageText(
        `⛽ *Gas Tracker*\n\n${escapeMarkdownV2('Fetching live prices & gas rates...')}`,
        { parse_mode: 'MarkdownV2' }
      );
      
      const lines = [];

      for (const [chainId, adapter] of deps.adapters.entries()) {
        if (adapter.isConnected() && adapter.getFeeData) {
          try {
            const feeData = await adapter.getFeeData();
            if (feeData.baseFeePerGas) {
              const baseGwei = Number(feeData.baseFeePerGas) / 1e9;
              const usdPrice = await getNativePriceUsd(chainId);
              const symbol = escapeMarkdownV2(getNativeSymbol(chainId));
              const chainStr = escapeMarkdownV2(CHAIN_NAMES[chainId] ?? chainId);
              
              // Helper to calculate total Gwei based on priority multiplier
              const calcTier = (multiplier: number, basePrio: number) => {
                const prio = basePrio * multiplier;
                const total = baseGwei + prio;
                const cost = (total * 1e9 * 21000 * usdPrice) / 1e18;
                return { total: total.toFixed(3), prio: prio.toFixed(3), cost: cost.toFixed(4) };
              };

              // Base priority fee (assuming 0.05 gwei for chains like Arbitrum/Polygon/Base, 1 gwei for ETH)
              let basePrio = 0.05;
              if (chainId === 'ethereum') basePrio = 1.0;
              if (feeData.maxPriorityFeePerGas) {
                 basePrio = Number(feeData.maxPriorityFeePerGas) / 1e9;
              }

              const std = calcTier(1, basePrio);
              const fast = calcTier(1.5, basePrio);
              const agg = calcTier(3, basePrio);

              const blockStr = `*${chainStr}* \\| $${escapeMarkdownV2(usdPrice.toFixed(2))} ${symbol}\n` +
                `🔹 *Standard:* ${escapeMarkdownV2(std.total)} gwei \\(~ $${escapeMarkdownV2(std.cost)}\\)\n` +
                `⚡ *Fast:* ${escapeMarkdownV2(fast.total)} gwei \\(~ $${escapeMarkdownV2(fast.cost)}\\)\n` +
                `🚀 *Rapid:* ${escapeMarkdownV2(agg.total)} gwei \\(~ $${escapeMarkdownV2(agg.cost)}\\)\n`;

              lines.push(blockStr);
            }
          } catch (err) {
            // Silently skip chain on error
          }
        }
      }

      const msg = lines.length > 0 
        ? `⛽ *Multi\\-Chain Gas Tracker* \\(21k transfer\\)\n\n${lines.join('\n')}`
        : `⛽ *Multi\\-Chain Gas Tracker*\n\n${escapeMarkdownV2('No connected chains found.')}`;

      await ctx.editMessageText(msg, {
        parse_mode: 'MarkdownV2',
        reply_markup: {
          inline_keyboard: [
            [{ text: '⚙️ Configure Gas', callback_data: 'gas:config_menu' }],
            [{ text: '◀️ Back', callback_data: 'menu:main' }]
          ]
        }
      });
      break;
    }
    case 'watchlist': {
      const entries = deps.strategyEngine.getWatchlist();
      const msg = `🎯 *Watchlist* \\(${escapeMarkdownV2(entries.length.toString())}\\)`;
      await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...watchlistKeyboard(entries) });
      break;
    }
    case 'alphas': {
      const alphas = deps.strategyEngine.getAlphaWallets();
      const msg = `🎭 *Alpha Wallets* \\(${escapeMarkdownV2(alphas.length.toString())}\\)\n\n${escapeMarkdownV2('Manage wallets to auto-copy mints from:')}`;
      await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...alphaListKeyboard(alphas) });
      break;
    }
    case 'history': {
      const mints = getRecentMints(deps.db, 10, 0);
      const totalPages = Math.max(1, Math.ceil(getMintCount(deps.db) / 10));

      if (mints.length === 0) {
        await ctx.editMessageText(
          `📜 *History*\n\n${escapeMarkdownV2('No mints recorded yet.')}`,
          { parse_mode: 'MarkdownV2', ...mintHistoryKeyboard(0, 1) }
        );
      } else {
        const lines = mints.map((m) => {
          const status = m.status === 'confirmed' ? '✅' : m.status === 'failed' ? '❌' : '⏳';
          const chain = escapeMarkdownV2(CHAIN_NAMES[m.chain as ChainId] ?? m.chain);
          const addr = escapeMarkdownV2(`${m.contract_address.slice(0, 8)}...`);
          return `${status} ${chain} \\| ${addr}`;
        });
        await ctx.editMessageText(
          `📜 *History*\n\n${lines.join('\n')}`,
          { parse_mode: 'MarkdownV2', ...mintHistoryKeyboard(0, totalPages) }
        );
      }
      break;
    }
    case 'config': {
      const config = deps.strategyEngine.getConfig();
      await ctx.editMessageText(
        `⚙️ *Configuration*\n\n${escapeMarkdownV2('Tap a setting to edit:')}`,
        { parse_mode: 'MarkdownV2', ...configMenuKeyboard(config) }
      );
      break;
    }
    case 'assets': {
      const { assetsMenuKeyboard } = await import('../menus/assets-menu.js');
      await ctx.editMessageText('💸 *Asset Management*\n\nSelect an action:', {
        parse_mode: 'MarkdownV2',
        ...assetsMenuKeyboard()
      });
      break;
    }
    case 'rpc': {
      const keyboardRows = [];
      const chains = Object.keys(CHAIN_NAMES) as ChainId[];
      for (let i = 0; i < chains.length; i += 2) {
        const row = [];
        row.push({ text: CHAIN_NAMES[chains[i]!]!, callback_data: `rpc:list:${chains[i]}` });
        if (i + 1 < chains.length) {
          row.push({ text: CHAIN_NAMES[chains[i + 1]!]!, callback_data: `rpc:list:${chains[i + 1]}` });
        }
        keyboardRows.push(row);
      }
      keyboardRows.push([{ text: '◀️ Back', callback_data: 'menu:main' }]);
      await ctx.editMessageText('🌐 *RPC Management*\n\nSelect a chain to view and configure its RPC endpoints:', {
        parse_mode: 'MarkdownV2',
        reply_markup: { inline_keyboard: keyboardRows }
      });
      break;
    }
    case 'pause': {
      deps.strategyEngine.pause();
      await ctx.editMessageText(
        `⏸️ *Bot Paused*\n${escapeMarkdownV2('Monitoring continues but no auto-mints.')}`,
        { parse_mode: 'MarkdownV2', ...mainMenuKeyboard() }
      );
      break;
    }
    case 'resume': {
      deps.strategyEngine.resume();
      await ctx.editMessageText(
        `▶️ *Bot Resumed*\n${escapeMarkdownV2('Auto-minting is active.')}`,
        { parse_mode: 'MarkdownV2', ...mainMenuKeyboard() }
      );
      break;
    }
    case 'help': {
      const help = [
        `❓ *Commands*`,
        ``,
        `/status \\- Bot health`,
        `/wallets \\- Balances`,
        `/gas \\- Gas prices`,
        `/mints \\- History`,
        `/watchlist \\- Tracked contracts`,
        `/alphas \\- Tracked Alpha wallets`,
        `/config \\- Settings`,
        `/pause \\| /resume \\- Control`,
      ].join('\n');
      await ctx.editMessageText(help, { parse_mode: 'MarkdownV2', ...mainMenuKeyboard() });
      break;
    }
    case 'dismiss': {
      try {
        await ctx.deleteMessage();
      } catch (err) {
        // Ignore if already deleted
      }
      break;
    }
  }
}

// ─── Wallet Actions ──────────────────────────────────────

async function handleWallet(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'menu': {
      const allWallets = deps.walletManager.getAllWallets();
      const lines = allWallets.map(formatWalletBalance);
      const msg = allWallets.length > 0
        ? `💰 *Wallets*\n\n${lines.join('\n\n')}`
        : `💰 *Wallets*\n\n${escapeMarkdownV2('No wallets configured.')}`;
      await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...walletListKeyboard(allWallets) });
      break;
    }
    case 'detail': {
      const index = parseInt(parts[1] ?? '0', 10);
      const wallet = deps.walletManager.getWallet(index);
      if (wallet) {
        await ctx.answerCbQuery('Fetching balances...');
        // Fetch balances for this wallet across all connected chains concurrently
        const fetchTasks = Array.from(deps.adapters.entries()).map(async ([chain, adapter]) => {
          if (!adapter.isConnected()) return;
          try {
            const bal = await adapter.getBalance(wallet.info.address);
            deps.walletManager.updateBalance(wallet.info.address, chain, bal);

            if (adapter.config?.usdcAddress) {
              const tokenBal = await adapter.getTokenBalance(wallet.info.address, adapter.config.usdcAddress);
              deps.walletManager.updateTokenBalance(wallet.info.address, chain, tokenBal);
            }
          } catch (e) {
            // ignore
          }
        });
        await Promise.all(fetchTasks);
        const updatedWallet = deps.walletManager.getWallet(index)!;
        const msg = formatWalletBalance(updatedWallet);
        try {
          const label = updatedWallet.info.label ?? `W${index + 1}`;
          await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            ...walletDetailKeyboard(index, label),
          });
        } catch (e: any) {
          if (e.description?.includes('message is not modified')) {
             // ignore
          } else {
             throw e;
          }
        }
      }
      break;
    }
    case 'copy': {
      const index = parseInt(parts[1] ?? '0', 10);
      const wallet = deps.walletManager.getWallet(index);
      if (wallet) {
        await ctx.reply(`\`${wallet.info.address}\``, { parse_mode: 'MarkdownV2' });
      }
      break;
    }
    case 'refresh': {
      const index = parseInt(parts[1] ?? '-1', 10);
      if (index === -1) {
        await ctx.answerCbQuery();
        break;
      }
      const wallet = deps.walletManager.getWallet(index);
      if (wallet) {
        await ctx.answerCbQuery('Refreshing balances...');
        const refreshTasks = Array.from(deps.adapters.entries()).map(async ([chain, adapter]) => {
          if (!adapter.isConnected()) return;
          try {
            const bal = await adapter.getBalance(wallet.info.address);
            deps.walletManager.updateBalance(wallet.info.address, chain, bal);

            if (adapter.config?.usdcAddress) {
              const tokenBal = await adapter.getTokenBalance(wallet.info.address, adapter.config.usdcAddress);
              deps.walletManager.updateTokenBalance(wallet.info.address, chain, tokenBal);
            }
          } catch (e) {
            // ignore
          }
        });
        await Promise.all(refreshTasks);
        const updatedWallet = deps.walletManager.getWallet(index)!;
        const msg = formatWalletBalance(updatedWallet);
        try {
          const label = updatedWallet.info.label ?? `W${index + 1}`;
          await ctx.editMessageText(msg, {
            parse_mode: 'MarkdownV2',
            ...walletDetailKeyboard(index, label),
          });
        } catch (e: any) {
          if (!e.description?.includes('message is not modified')) {
             throw e;
          }
        }
      } else {
        await ctx.answerCbQuery('Wallet not found.');
      }
      break;
    }
    case 'secrets': {
      const index = parseInt(parts[1] ?? '0', 10);
      let evmPk = '';
      let solPk = '';
      try {
        evmPk = deps.walletManager.getPrivateKey(index);
      } catch (err) {
        log.error({ err, index }, 'Failed to get private key');
      }
      
      const mnemonic = deps.walletManager.getMnemonic() ?? 'Not available (imported wallet)';
      
      const msg = [
        `🗝️ *Wallet Secrets* \\(Index ${index}\\)`,
        ``,
        `*Seed Phrase:*`,
        `\`${escapeMarkdownV2(mnemonic)}\``,
        ``,
        `*EVM Private Key:*`,
        `\`${escapeMarkdownV2(evmPk)}\``,
      ].filter(Boolean).join('\n');
      
      await ctx.reply(msg, {
        parse_mode: 'MarkdownV2',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('🗑️ Dismiss', 'menu:dismiss')]
        ]).reply_markup
      });
      await ctx.answerCbQuery('Sent secrets securely');
      break;
    }
    case 'delete': {
      const index = parseInt(parts[1] ?? '0', 10);
      const success = deps.walletManager.deleteWallet(index);
      
      if (success) {
        await ctx.answerCbQuery('Wallet deleted!');
      } else {
        await ctx.answerCbQuery('Wallet not found or already deleted');
      }
      
      const allWallets = deps.walletManager.getAllWallets();
      const lines = allWallets.map(formatWalletBalance);
      const msg = allWallets.length > 0
        ? `💰 *Wallets*\n\n${lines.join('\n\n')}`
        : `💰 *Wallets*\n\n${escapeMarkdownV2('No wallets configured.')}`;
      await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...walletListKeyboard(allWallets) });
      break;
    }
    case 'add': {
      const count = parseInt(parts[1] ?? '1', 10);
      await ctx.answerCbQuery(`Adding ${count} wallet(s)...`);
      
      deps.walletManager.addWallets(count);
      const mnemonic = deps.walletManager.getMnemonic();
      
      const allWallets = deps.walletManager.getAllWallets();
      const lines = allWallets.map(formatWalletBalance);
      
      await ctx.reply(
        `✅ *Added ${count} Wallet\\(s\\)*\n\n` +
        `⚠️ *Save your recovery phrase:*\n` +
        `\`${escapeMarkdownV2(mnemonic || '')}\``,
        {
          parse_mode: 'MarkdownV2',
          reply_markup: {
            inline_keyboard: [[{ text: '🗑️ Delete Phrase', callback_data: 'delete_message' }]]
          }
        }
      );
      
      const msg = `💰 *Wallets*\n\n${lines.join('\n\n')}`;
      await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...walletListKeyboard(allWallets) });
      break;
    }
    case 'batch': {
      const userId = ctx.from?.id;
      if (userId) {
        await ctx.reply(escapeMarkdownV2('How many wallets do you want to generate? (e.g., 5)'), { parse_mode: 'MarkdownV2' });
        deps.pendingInputs.set(userId, {
          field: 'wallet:batch',
          callback: async (value: string) => {
            const count = parseInt(value, 10);
            if (isNaN(count) || count <= 0 || count > 50) {
              await ctx.reply(escapeMarkdownV2('Please enter a valid number between 1 and 50.'));
              return;
            }
            
            deps.walletManager.addWallets(count);
            const mnemonic = deps.walletManager.getMnemonic();
            
            const allWallets = deps.walletManager.getAllWallets();
            const lines = allWallets.map(formatWalletBalance);
            
            await ctx.reply(
              `✅ *Added ${count} Wallet\\(s\\)*\n\n` +
              `⚠️ *Save your recovery phrase:*\n` +
              `\`${escapeMarkdownV2(mnemonic || '')}\``,
              {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                  inline_keyboard: [[{ text: '🗑️ Delete Phrase', callback_data: 'delete_message' }]]
                }
              }
            );
            
            const msg = `💰 *Wallets*\n\n${lines.join('\n\n')}`;
            await ctx.reply(msg, { parse_mode: 'MarkdownV2', ...walletListKeyboard(allWallets) });
          }
        });
      }
      break;
    }
    case 'import': {
      const userId = ctx.from?.id;
      if (userId) {
        await ctx.reply(escapeMarkdownV2('Send the private key (starting with 0x) of the wallet to import:'), { parse_mode: 'MarkdownV2' });
        deps.pendingInputs.set(userId, {
          field: 'wallet:import',
          callback: async (value: string) => {
            const pk = value.trim();
            if (!pk.startsWith('0x') || pk.length !== 66) {
              await ctx.reply(escapeMarkdownV2('Invalid private key format. Must be 66 characters starting with 0x.'));
              return;
            }
            try {
              deps.walletManager.importWallet(pk as `0x${string}`);
              const allWallets = deps.walletManager.getAllWallets();
              const lines = allWallets.map(formatWalletBalance);
              await ctx.reply('✅ *Wallet imported successfully!*', { parse_mode: 'MarkdownV2' });
              
              const msg = `💰 *Wallets*\n\n${lines.join('\n\n')}`;
              await ctx.reply(msg, { parse_mode: 'MarkdownV2', ...walletListKeyboard(allWallets) });
            } catch (err: any) {
              await ctx.reply(`❌ *Import Failed*\n\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
            }
          }
        });
      }
      break;
    }
    case 'rename': {
      const index = parseInt(parts[1] ?? '0', 10);
      const userId = ctx.from?.id;
      const wallet = deps.walletManager.getWallet(index);
      if (userId && wallet) {
        await ctx.reply(escapeMarkdownV2(`Send a new name for wallet ${wallet.info.address.slice(0, 6)}:`), { parse_mode: 'MarkdownV2' });
        deps.pendingInputs.set(userId, {
          field: `wallet:rename:${index}`,
          callback: async (value: string) => {
            deps.walletManager.setWalletLabel(index, value.trim());
            const wallet = deps.walletManager.getWallet(index);
            if (wallet) {
              await ctx.reply(`✅ *Wallet renamed to:* ${escapeMarkdownV2(value.trim())}`, { parse_mode: 'MarkdownV2' });
              const msg = formatWalletBalance(wallet);
              const label = wallet.info.label ?? `W${index + 1}`;
              await ctx.reply(msg, { parse_mode: 'MarkdownV2', ...walletDetailKeyboard(index, label) });
            }
          }
        });
      }
      break;
    }
    case 'preferred':
    case 'swap':
    case 'split':
    case 'reorder':
    case 'toggle_labels':
    case 'toggle_groups': {
      await ctx.answerCbQuery('Feature coming soon in a future update!', { show_alert: true });
      break;
    }
    case 'transfer_eth': {
      const index = parseInt(parts[1] ?? '0', 10);
      const { portfolioChainSelectionKeyboard } = await import('../menus/chain-menu.js');
      const { CHAIN_NAMES } = await import('../../core/constants.js');
      const enabledChains = Object.keys(CHAIN_NAMES) as ChainId[];
      await ctx.editMessageText('💸 *Transfer ETH*\n\nSelect the chain:', { 
        parse_mode: 'MarkdownV2',
        ...portfolioChainSelectionKeyboard(enabledChains, 'transfer_eth', index)
      });
      break;
    }
    case 'transfer_nft': {
      const index = parseInt(parts[1] ?? '0', 10);
      const { portfolioChainSelectionKeyboard } = await import('../menus/chain-menu.js');
      const { CHAIN_NAMES } = await import('../../core/constants.js');
      const enabledChains = Object.keys(CHAIN_NAMES) as ChainId[];
      await ctx.editMessageText('🎫 *Transfer NFT*\n\nSelect the chain:', { 
        parse_mode: 'MarkdownV2',
        ...portfolioChainSelectionKeyboard(enabledChains, 'transfer_nft', index)
      });
      break;
    }
    case 'chain': {
      // portfolio:chain:<action>:<walletIndex>:<chainName>
      const assetAction = parts[1];
      const index = parseInt(parts[2] ?? '0', 10);
      const chain = parts[3];
      const chatId = ctx.chat?.id ?? ctx.from?.id;
      if (!chatId || !assetAction || !chain) return;

      if (assetAction === 'transfer_eth') {
        const wallets = deps.walletManager.getAllWallets();
        const { assetDestinationKeyboard } = await import('../menus/assets-menu.js');
        userState.set(chatId, { type: 'transfer_eth', step: 'chain', fromIndex: index, chain }); // We record the chain for destination step
        await ctx.editMessageText(`💸 *Transfer ETH on ${chain}*\n\nSelect the Destination Wallet:`, {
          parse_mode: 'MarkdownV2',
          ...assetDestinationKeyboard(wallets, 'transfer_eth', chain, index)
        });
      } else if (assetAction === 'transfer_nft') {
        const wallets = deps.walletManager.getAllWallets();
        const { assetDestinationKeyboard } = await import('../menus/assets-menu.js');
        userState.set(chatId, { type: 'transfer_nft', step: 'chain', fromIndex: index, chain });
        await ctx.editMessageText(`🎫 *Transfer NFT on ${chain}*\n\nSelect the Destination Wallet:`, {
          parse_mode: 'MarkdownV2',
          ...assetDestinationKeyboard(wallets, 'transfer_nft', chain, index)
        });
      }
      break;
    }
  }
}

// ─── Config Actions ──────────────────────────────────────

async function handleConfig(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'menu':
    case 'list': {
      const config = deps.strategyEngine.getConfig();
      await ctx.editMessageText(
        `⚙️ *Configuration*\n\n${escapeMarkdownV2('Tap a setting to edit:')}`,
        { parse_mode: 'MarkdownV2', ...configMenuKeyboard(config) }
      );
      break;
    }
    case 'edit': {
      const field = parts[1];
      if (field === 'mode') {
        await ctx.editMessageText(
          `🎯 *Select Strategy Mode*`,
          { parse_mode: 'MarkdownV2', ...modeSelectKeyboard() }
        );
      } else if (field) {
        // Prompt for text input
        const userId = ctx.from?.id;
        if (userId) {
          await ctx.reply(
            `${escapeMarkdownV2(`Enter new value for ${field}:`)}`,
            { parse_mode: 'MarkdownV2' }
          );
          deps.pendingInputs.set(userId, {
            field,
            callback: async (value: string) => {
              const numValue = parseFloat(value);
              if (isNaN(numValue)) {
                await ctx.reply(escapeMarkdownV2('Invalid number. Try again.'), {
                  parse_mode: 'MarkdownV2',
                });
                return;
              }
              deps.strategyEngine.updateConfig({ [field]: numValue });
              const config = deps.strategyEngine.getConfig();
              await ctx.reply(
                `✅ *Updated* ${escapeMarkdownV2(field)} to ${escapeMarkdownV2(value)}`,
                { parse_mode: 'MarkdownV2', ...configMenuKeyboard(config) }
              );
            },
          });
        }
      }
      break;
    }
    case 'toggle': {
      const field = parts[1];
      if (field === 'autoMint') {
        const current = deps.strategyEngine.getConfig().autoMint;
        deps.strategyEngine.updateConfig({ autoMint: !current });
        const config = deps.strategyEngine.getConfig();
        await ctx.editMessageText(
          `⚙️ *Configuration*\n\n${escapeMarkdownV2(`Auto Mint: ${config.autoMint ? 'ON' : 'OFF'}`)}`,
          { parse_mode: 'MarkdownV2', ...configMenuKeyboard(config) }
        );
      } else if (field === 'copyMint') {
        const current = deps.strategyEngine.getConfig().copyMintEnabled;
        deps.strategyEngine.updateConfig({ copyMintEnabled: !current });
        const config = deps.strategyEngine.getConfig();
        await ctx.editMessageText(
          `⚙️ *Configuration*\n\n${escapeMarkdownV2(`Copy-Mint: ${config.copyMintEnabled ? 'ON' : 'OFF'}`)}`,
          { parse_mode: 'MarkdownV2', ...configMenuKeyboard(config) }
        );
      }
      break;
    }
    case 'set': {
      const field = parts[1];
      const value = parts[2];

      if (field === 'mode' && value) {
        deps.strategyEngine.updateConfig({ mode: value as StrategyMode });
        const config = deps.strategyEngine.getConfig();
        await ctx.editMessageText(
          `⚙️ *Configuration*\n\n${escapeMarkdownV2(`Mode set to: ${value}`)}`,
          { parse_mode: 'MarkdownV2', ...configMenuKeyboard(config) }
        );
      } else if (field === 'route' && value) {
        deps.strategyEngine.updateConfig({ defaultRoute: { type: value as RouteType } });
        const config = deps.strategyEngine.getConfig();
        await ctx.editMessageText(
          `⚙️ *Configuration*\n\n${escapeMarkdownV2(`Route set to: ${value}`)}`,
          { parse_mode: 'MarkdownV2', ...configMenuKeyboard(config) }
        );
      }
      break;
    }
  }
}

// ─── Watchlist Actions ───────────────────────────────────

async function handleWatchlist(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'add': {
      await ctx.editMessageText(
        `➕ *Add to Watchlist*\n\n${escapeMarkdownV2('Select the chain:')}`,
        { parse_mode: 'MarkdownV2', ...chainSelectKeyboard() }
      );
      break;
    }
    case 'chain': {
      const chain = parts[1] as ChainId;
      const userId = ctx.from?.id;
      if (userId && chain) {
        await ctx.reply(
          escapeMarkdownV2(`Send the contract address for ${CHAIN_NAMES[chain]}:`),
          { parse_mode: 'MarkdownV2' }
        );
        deps.pendingInputs.set(userId, {
          field: `watchlist:${chain}`,
          callback: async (address: string) => {
            deps.strategyEngine.addToWatchlist({
              chain,
              contractAddress: address.trim(),
              name: `${address.slice(0, 8)}...`,
              addedAt: Date.now(),
            });
            const entries = deps.strategyEngine.getWatchlist();
            await ctx.reply(
              `✅ *Added to watchlist*`,
              { parse_mode: 'MarkdownV2', ...watchlistKeyboard(entries) }
            );
          },
        });
      }
      break;
    }
    case 'remove': {
      const index = parseInt(parts[1] ?? '0', 10);
      const watchlist = deps.strategyEngine.getWatchlist();
      const entry = watchlist[index];
      if (entry) {
        deps.strategyEngine.removeFromWatchlist(entry.chain, entry.contractAddress);
        const updated = deps.strategyEngine.getWatchlist();
        await ctx.editMessageText(
          `🎯 *Watchlist* \\(${escapeMarkdownV2(updated.length.toString())}\\)`,
          { parse_mode: 'MarkdownV2', ...watchlistKeyboard(updated) }
        );
      }
      break;
    }
  }
}

// ─── Alpha Wallet Actions ────────────────────────────────

async function handleAlpha(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'add': {
      const userId = ctx.from?.id;
      if (userId) {
        await ctx.reply(escapeMarkdownV2('Send the address for the Alpha Wallet (e.g. 0x...):'), { parse_mode: 'MarkdownV2' });
        deps.pendingInputs.set(userId, {
          field: `alpha:add:address`,
          callback: async (address: string) => {
            deps.strategyEngine.addAlphaWallet({
              address: address.trim(),
              name: `Alpha ${address.slice(0, 6)}`,
              enabled: true,
              addedAt: Date.now(),
            });
            const alphas = deps.strategyEngine.getAlphaWallets();
            await ctx.reply(`✅ *Added Alpha Wallet*`, { parse_mode: 'MarkdownV2', ...alphaListKeyboard(alphas) });
          }
        });
      }
      break;
    }
    case 'detail': {
      const index = parseInt(parts[1] ?? '0', 10);
      const alphas = deps.strategyEngine.getAlphaWallets();
      const alpha = alphas[index];
      if (alpha) {
        const msg = `🎭 *Alpha Wallet Detail*\n\n` +
          `*Name:* ${escapeMarkdownV2(alpha.name)}\n` +
          `*Address:* \`${escapeMarkdownV2(alpha.address)}\`\n` +
          `*Status:* ${alpha.enabled ? '🟢 Active' : '🔴 Paused'}`;
        await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...alphaDetailKeyboard(index, alpha.enabled) });
      }
      break;
    }
    case 'toggle': {
      const index = parseInt(parts[1] ?? '0', 10);
      const alphas = deps.strategyEngine.getAlphaWallets();
      const alpha = alphas[index];
      if (alpha) {
        deps.strategyEngine.toggleAlphaWallet(alpha.address);
        const updated = deps.strategyEngine.getAlphaWallets()[index]!;
        const msg = `🎭 *Alpha Wallet Detail*\n\n` +
          `*Name:* ${escapeMarkdownV2(updated.name)}\n` +
          `*Address:* \`${escapeMarkdownV2(updated.address)}\`\n` +
          `*Status:* ${updated.enabled ? '🟢 Active' : '🔴 Paused'}`;
        await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...alphaDetailKeyboard(index, updated.enabled) });
      }
      break;
    }
    case 'delete': {
      const index = parseInt(parts[1] ?? '0', 10);
      const alphas = deps.strategyEngine.getAlphaWallets();
      const alpha = alphas[index];
      if (alpha) {
        deps.strategyEngine.removeAlphaWallet(alpha.address);
        const updatedAlphas = deps.strategyEngine.getAlphaWallets();
        const msg = `🎭 *Alpha Wallets* \\(${escapeMarkdownV2(updatedAlphas.length.toString())}\\)\n\n${escapeMarkdownV2('Manage wallets to auto-copy mints from:')}`;
        await ctx.editMessageText(msg, { parse_mode: 'MarkdownV2', ...alphaListKeyboard(updatedAlphas) });
      }
      break;
    }
  }
}

// ─── Mint Actions ────────────────────────────────────────

async function handleMint(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[0];

  switch (action) {
    case 'arm': {
      const chain = parts[1] as ChainId;
      const encodedAddr = parts[2];
      const opp = deps.strategyEngine.getRecentOpportunity(encodedAddr!);

      if (!opp) {
        await ctx.answerCbQuery('Mint opportunity expired or not found.');
        return;
      }

      await ctx.answerCbQuery('⚡ Arming transaction...');
      const evalResult = await deps.strategyEngine.evaluate(opp);
      if (!evalResult.wallet) {
        await ctx.editMessageText('❌ Failed: No eligible wallet found.');
        return;
      }

      try {
        const armedTx = await deps.executor.armMint(opp, evalResult.wallet);
        if (!armedTx) {
          await ctx.editMessageText('❌ Failed: Could not arm transaction.');
          return;
        }
        deps.armedTxs.set(encodedAddr!, armedTx);
        
        await ctx.editMessageText(
          `⚡ *Transaction Armed!*\n\nWallet: \`${armedTx.walletAddress}\`\nGas: ~${armedTx.estimatedGasCost} wei\nNonce: ${armedTx.nonce}\n\nReady to fire!`,
          { parse_mode: 'MarkdownV2', ...armedMintKeyboard(chain, encodedAddr!) }
        );
      } catch (err: any) {
        await ctx.editMessageText(`❌ *Arm Failed*\n\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
      }
      break;
    }
    case 'fire': {
      const chain = parts[1] as ChainId;
      const encodedAddr = parts[2];
      const armedTx = deps.armedTxs.get(encodedAddr!);

      if (!armedTx) {
        await ctx.answerCbQuery('Armed transaction not found or expired.');
        return;
      }

      await ctx.answerCbQuery('🔥 Firing!');
      const route = deps.strategyEngine.getConfig().defaultRoute ?? { type: 'public' };
      
      try {
        await ctx.editMessageText(`🔥 *Firing Mint...*\nRoute: ${route.type}`, { parse_mode: 'MarkdownV2' });
        await deps.executor.fireMint(armedTx, route);
      } catch (err: any) {
        await ctx.editMessageText(`❌ *Fire Failed*\n\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
      }
      break;
    }
    case 'now': {
      const chain = parts[1] as ChainId;
      const encodedAddr = parts[2];
      const opp = deps.strategyEngine.getRecentOpportunity(encodedAddr!);

      if (!opp) {
        await ctx.answerCbQuery('Mint opportunity expired or not found.');
        return;
      }

      await ctx.answerCbQuery('⚡ Executing mint now...');
      
      const evalResult = await deps.strategyEngine.evaluate(opp);
      if (!evalResult.wallet) {
        await ctx.editMessageText('❌ Failed: No eligible wallet found.');
        return;
      }

      try {
        await ctx.editMessageText('⚡ *Executing Mint...*', { parse_mode: 'MarkdownV2' });
        // The executor will handle emitting the appropriate events and DB insertion
        // For 'now', we skip arming and just build/sign/broadcast using sendMint
        const pk = deps.walletManager.getPrivateKey(evalResult.wallet.info.index);
        const adapter = deps.adapters.get(opp.chain);
        if (adapter) {
          await adapter.sendMint({
            chain: opp.chain,
            contractAddress: opp.contractAddress,
            mintFunction: opp.mintFunction,
            value: opp.price,
            gasLimit: opp.estimatedGas,
            args: []
          }, pk);
          await ctx.editMessageText('✅ Mint transaction broadcasted!', { parse_mode: 'MarkdownV2' });
        }
      } catch (err: any) {
        await ctx.editMessageText(`❌ *Mint Failed*\n\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
      }
      break;
    }
    case 'watch': {
      const chain = parts[1] as ChainId;
      const contractAddr = parts[2];
      if (chain && contractAddr) {
        deps.strategyEngine.addToWatchlist({
          chain,
          contractAddress: contractAddr,
          name: `${contractAddr.slice(0, 8)}...`,
          addedAt: Date.now(),
        });
        await ctx.answerCbQuery('👀 Added to watchlist');
      }
      break;
    }
    case 'skip': {
      await ctx.answerCbQuery('Skipped');
      await ctx.deleteMessage();
      break;
    }
    case 'cancel': {
      await ctx.answerCbQuery('Cancelled');
      await ctx.deleteMessage();
      break;
    }
  }
}

// ─── Delete Message ──────────────────────────────────────

async function handleDeleteMessage(ctx: Context): Promise<void> {
  try {
    await ctx.deleteMessage();
  } catch (e) {
    await ctx.answerCbQuery('Could not delete message');
  }
}

// ─── Contract Auto-Detect ────────────────────────────────

async function handleCa(ctx: Context, parts: string[]): Promise<void> {
  let action = parts[1];
  const chain = parts[2] as ChainId;
  const address = parts[3];
  
  // Map short action names back to their original names
  if (action === 'sch') action = 'schedule';
  if (action === 'gas') action = 'custom_gas';
  if (action === 'sell') action = 'sell_prompt';
  
  let gasAggression = (parts[4] || 'normal') as GasAggression;
  // Map short gas aggression names
  if (gasAggression === 'f') gasAggression = 'fast';
  if (gasAggression === 'a') gasAggression = 'aggressive';
  
  if (action === 'schedule' || action === 'watch') {
    if (!address) return;
    const currentText = ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : '';
    
    // Check if we need an amount
    const adapter = deps.adapters.get(chain);
    if (adapter) {
      const info = await adapter.getContractInfo(address);
      if (info && info.mintFunction && info.mintFunction.includes('uint256')) {
        await ctx.answerCbQuery('Prompting for mint amount...');
        userState.set(ctx.chat!.id, {
          type: 'schedule_setup',
          chain,
          address,
          mintFunction: info.mintFunction,
          priceWei: info.priceWei || 0n,
          maxPerTx: info.maxPerTx
        });
        const maxStr = info.maxPerTx ? ` (Max per tx: ${info.maxPerTx})` : '';
        await ctx.editMessageText(`${currentText}\n\n👇 *Please enter the number of tokens to mint when it goes live*${maxStr}:`, { parse_mode: 'MarkdownV2' });
        return;
      }
    }
    
    deps.strategyEngine.addToWatchlist({
      chain,
      contractAddress: address,
      name: `Snipe ${address.slice(0, 8)}`,
      addedAt: Date.now(),
    });

    await ctx.answerCbQuery('Added to Watchlist!');
    await ctx.editMessageText(`${currentText}\n\n✅ *Tracking active!*`, { parse_mode: 'MarkdownV2' });
    
  } else if (action === 'sell_prompt') {
    if (!address) return;
    await ctx.answerCbQuery('Prompting for Token ID...');
    
    // Set pending state
    userState.set(ctx.chat!.id, {
      type: 'sell_token',
      chain,
      address
    });
    
    const currentText = ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : '';
    await ctx.editMessageText(`${currentText}\n\n👇 *Please type the Token ID you want to sell:*`, { parse_mode: 'MarkdownV2' });

  } else if (action === 'custom_gas') {
    if (!address) return;
    const targetAction = parts[2] as 'mint' | 'buy';
    const targetChain = parts[3] as ChainId;
    const targetAddress = parts[4] ?? '';
    
    await ctx.answerCbQuery('Prompting for Custom Gas...');
    
    // Set pending state
    userState.set(ctx.chat!.id, {
      type: 'custom_gas',
      action: targetAction,
      chain: targetChain,
      address: targetAddress
    });
    
    const currentText = ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : '';
    const promptMsg = `👇 *Enter Custom Gas*
    
You can enter just the Priority Fee, or both Priority and Max Base Fee:
• \`5\` \\(Sets Priority Fee to 5 Gwei, auto\\-calculates Base Fee\\)
• \`5 20\` \\(Sets Priority Fee to 5 Gwei, Max Base Fee to 20 Gwei\\)

_Please type your desired gas below:_`;

    await ctx.editMessageText(`${currentText}\n\n${promptMsg}`, { parse_mode: 'MarkdownV2' });
    
  } else if (action === 'buy') {
    if (!address) return;
    await ctx.answerCbQuery(`⚡ Preparing buy with ${gasAggression} gas...`);
    
    const currentText = ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : '';
    await ctx.editMessageText(`${currentText}\n\n⏳ *Executing Buy...*`, { parse_mode: 'MarkdownV2' });
    
    try {
      const account = deps.walletManager.getAllWallets()[0];
      if (!account) throw new Error('No wallet configured');
      
      const buyData = await reservoirService.getBuyTx(chain, address, account.info.address);
      await ctx.editMessageText(`${currentText}\n\n✅ *Buy Intent Generated, Submitting to Executor...*`, { parse_mode: 'MarkdownV2' });
      
      deps.executor.executeReservoirPath(chain, buyData, account).catch((e: any) => {
        console.error('Reservoir buy error:', e);
      });
    } catch (err: any) {
      await ctx.editMessageText(`${currentText}\n\n❌ *Buy Failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
    }
    
  } else if (action === 'mint') {
    if (!address) return;
    await ctx.answerCbQuery(`⚡ Preparing instant mint with ${gasAggression} gas...`);
    const currentText = ctx.callbackQuery && 'message' in ctx.callbackQuery && ctx.callbackQuery.message && 'text' in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : '';
    await ctx.editMessageText(`${currentText}\n\n⏳ *Executing mint transaction...*`, { parse_mode: 'MarkdownV2' });
    
    // We get the info again to get the mintFunction and price
    const adapter = deps.adapters.get(chain);
    if (!adapter) {
      await ctx.editMessageText(`${currentText}\n\n❌ Adapter not found`);
      return;
    }
    
    const info = await adapter.getContractInfo(address);
    if (!info || !info.mintFunction) {
      await ctx.editMessageText(`${currentText}\n\n❌ Failed: Mint function not identified`);
      return;
    }
    
    const pk = deps.walletManager.getPrivateKey(0);
    if (!pk) {
      await ctx.editMessageText(`${currentText}\n\n❌ Failed: No wallet configured`);
      return;
    }
    
    if (info.mintFunction.includes('uint256')) {
      // Need an amount
      userState.set(ctx.chat!.id, {
        type: 'mint_setup',
        chain,
        address,
        mintFunction: info.mintFunction,
        priceWei: info.priceWei || 0n,
        maxPerTx: info.maxPerTx,
        gasAggression
      });
      const maxStr = info.maxPerTx ? ` (Max per tx: ${info.maxPerTx})` : '';
      await ctx.editMessageText(`${currentText}\n\n👇 *Please enter the number of tokens to mint*${maxStr}:`, { parse_mode: 'MarkdownV2' });
      return;
    }
    
    try {
      const gasLimit = 300000n; // Default fallback
      await adapter.sendMint({
        chain,
        contractAddress: address,
        mintFunction: info.mintFunction,
        value: info.priceWei || 0n,
        gasLimit,
        args: []
      }, pk);
      
      await ctx.editMessageText(`${currentText}\n\n✅ *Instant Mint Broadcasted!*`, { parse_mode: 'MarkdownV2' });
    } catch (err: any) {
      await ctx.editMessageText(`${currentText}\n\n❌ *Mint Failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
    }
  } else if (action === 'ignore') {
    await ctx.answerCbQuery('Ignored');
    await ctx.deleteMessage();
  }
}

async function handleRpc(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[1];
  const chain = parts[2] as ChainId;
  
  if (action === 'list') {
    const rpcs = getRpcs(deps.db, chain);
    
    let msg = `🌐 *RPCs for ${escapeMarkdownV2(CHAIN_NAMES[chain] || chain)}*\n\n`;
    const buttons = [];
    
    if (rpcs.length === 0) {
      msg += `_No custom RPCs configured\\. Using default\\._`;
    } else {
      for (const rpc of rpcs) {
        msg += `• ${rpc.is_active ? '✅ ' : ''}\`${escapeMarkdownV2(rpc.url)}\`\n`;
        if (!rpc.is_active) {
          buttons.push([{ text: `🔄 Set Active: ${rpc.url.substring(0, 30)}...`, callback_data: `rpc:set:${chain}:${rpc.id}` }]);
        }
      }
    }
    
    buttons.push([{ text: '➕ Add Private RPC', callback_data: `rpc:add:${chain}` }]);
    buttons.push([{ text: '🔙 Back to Chains', callback_data: `rpc:back` }]);
    
    await ctx.editMessageText(msg, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: buttons }
    });
  } else if (action === 'add') {
    await ctx.answerCbQuery('Prompting for RPC URL...');
    userState.set(ctx.chat!.id, { type: 'add_rpc', chain });
    await ctx.editMessageText(`👇 *Please paste your new RPC URL for ${escapeMarkdownV2(CHAIN_NAMES[chain] || chain)}:*\n\nMust start with \`ws://\`, \`wss://\`, \`http://\`, or \`https://\``, { parse_mode: 'MarkdownV2' });
  } else if (action === 'set') {
    const id = parseInt(parts[3] ?? '0', 10);
    setActiveRpc(deps.db, chain, id);
    
    // Attempt to hot-swap the RPC
    const adapter = deps.adapters.get(chain);
    const rpcs = getRpcs(deps.db, chain);
    const activeRpc = rpcs.find(r => r.id === id);
    
    if (adapter && activeRpc) {
      // Background hot swap so we don't block the UI
      adapter.reconnect(activeRpc.url).catch((e: any) => {
        console.error('Failed to reconnect adapter', e);
      });
      await ctx.answerCbQuery('✅ Active RPC Switched & Reconnecting!');
    } else {
      await ctx.answerCbQuery('✅ Active RPC Switched! (Requires Restart to take effect)');
    }
    
    // Refresh the list
    await handleRpc(ctx, ['rpc', 'list', chain]);
  } else if (action === 'back') {
    // Just trigger the /rpc command again
    const keyboardRows = [];
    const chains = Object.keys(CHAIN_NAMES) as ChainId[];
    for (let i = 0; i < chains.length; i += 2) {
      const row = [];
      row.push({ text: CHAIN_NAMES[chains[i]!]!, callback_data: `rpc:list:${chains[i]}` });
      if (i + 1 < chains.length) {
        row.push({ text: CHAIN_NAMES[chains[i + 1]!]!, callback_data: `rpc:list:${chains[i + 1]}` });
      }
      keyboardRows.push(row);
    }
    await ctx.editMessageText('🌐 *RPC Management*\n\nSelect a chain to view and configure its RPC endpoints:', {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: keyboardRows }
    });
  }
}

// ─── Main Router ──────────────────────────────────────────

async function handlePagination(ctx: Context, parts: string[]): Promise<void> {
  const view = parts[0];
  const page = parseInt(parts[1] ?? '0', 10);

  if (view === 'mints') {
    const mints = getRecentMints(deps.db, 10, page * 10);
    const totalPages = Math.max(1, Math.ceil(getMintCount(deps.db) / 10));

    const lines = mints.map((m) => {
      const status = m.status === 'confirmed' ? '✅' : m.status === 'failed' ? '❌' : '⏳';
      const chain = escapeMarkdownV2(CHAIN_NAMES[m.chain as ChainId] ?? m.chain);
      const addr = escapeMarkdownV2(`${m.contract_address.slice(0, 8)}...`);
      return `${status} ${chain} \\| ${addr}`;
    });

    await ctx.editMessageText(
      `📜 *History* \\(page ${page + 1}\\)\n\n${lines.join('\n')}`,
      { parse_mode: 'MarkdownV2', ...mintHistoryKeyboard(page, totalPages) }
    );
  }
}

async function handleAssets(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[0];
  if (!action) return;

  if (action === 'chain') {
    // assets:chain:<action>:<chain>
    const assetAction = parts[1];
    const chain = parts[2];
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (!chatId || !assetAction || !chain) return;

    if (assetAction === 'transfer_eth' || assetAction === 'transfer_nft' || assetAction === 'disperse_eth') {
      const wallets = deps.walletManager.getAllWallets();
      const { assetWalletSelectKeyboard } = await import('../menus/assets-menu.js');
      await ctx.editMessageText(`💸 *${assetAction.replace('_', ' ').toUpperCase()} on ${chain}*\n\nSelect the Source Wallet:`, {
        parse_mode: 'MarkdownV2',
        ...assetWalletSelectKeyboard(wallets, assetAction, chain)
      });
    } else if (assetAction === 'consolidate_eth' || assetAction === 'sweep_nfts') {
      // For Consolidate and Sweep, we select the Destination Wallet first (source is multiple)
      const wallets = deps.walletManager.getAllWallets();
      const { assetDestinationKeyboard } = await import('../menus/assets-menu.js');
      // Pass a dummy sourceIndex (-1) to assetDestinationKeyboard since we don't have a single source
      await ctx.editMessageText(`📥 *${assetAction.replace('_', ' ').toUpperCase()} on ${chain}*\n\nSelect the Destination Wallet:`, {
        parse_mode: 'MarkdownV2',
        ...assetDestinationKeyboard(wallets, assetAction, chain, -1)
      });
    }
    await ctx.answerCbQuery();
    return;
  }

  if (action === 'select_wallet') {
    // assets:select_wallet:<action>:<chain>:<sourceIndex>
    const assetAction = parts[1];
    const chain = parts[2];
    const sourceIndex = parseInt(parts[3] ?? '0', 10);
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (!chatId || !assetAction || !chain) return;

    if (assetAction === 'transfer_nft') {
      userState.set(chatId, { type: 'transfer_nft', step: 'contract', chain, sourceIndex });
      await ctx.editMessageText(`🎫 *Transfer NFT on ${chain}*\n\nReply with the NFT Contract Address \\(0x\\.\\.\\.\\):`, { parse_mode: 'MarkdownV2' });
    } else if (assetAction === 'transfer_eth') {
      const wallets = deps.walletManager.getAllWallets();
      await ctx.editMessageText(`💸 *Transfer ETH on ${chain}*\n\nSelect the Destination Wallet:`, {
        parse_mode: 'MarkdownV2',
        ...assetDestinationKeyboard(wallets, assetAction, chain, sourceIndex)
      });
    } else if (assetAction === 'sweep_nfts') {
      const wallets = deps.walletManager.getAllWallets();
      await ctx.editMessageText(`🧹 *Sweep NFTs on ${chain}*\n\nSelect the Destination Wallet:`, {
        parse_mode: 'MarkdownV2',
        ...assetDestinationKeyboard(wallets, assetAction, chain, sourceIndex)
      });
    } else if (assetAction === 'disperse_eth') {
      userState.set(chatId, { type: 'disperse_eth', step: 'to', chain, sourceIndex });
      await ctx.editMessageText(`💦 *Disperse ETH on ${chain}*\n\nReply with a comma\\-separated list of destination addresses:`, { parse_mode: 'MarkdownV2' });
    }
    await ctx.answerCbQuery();
    return;
  }

  if (action === 'dest_wallet') {
    // assets:dest_wallet:<action>:<chain>:<sourceIndex>:<destIndex>
    const assetAction = parts[1];
    const chain = parts[2];
    const sourceIndex = parseInt(parts[3] ?? '-1', 10);
    const destIndex = parseInt(parts[4] ?? '0', 10);
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    const destWallet = deps.walletManager.getWallet(destIndex);
    
    if (!chatId || !assetAction || !chain || !destWallet) return;

    if (assetAction === 'transfer_eth') {
      userState.set(chatId, { type: 'transfer_eth', step: 'amount', chain, fromIndex: sourceIndex, destAddress: destWallet.info.address });
      await ctx.editMessageText(`💸 *Transfer ETH on ${chain}*\n\nSending to ${destWallet.info.label ?? `Wallet ${destIndex + 1}`}\\.\nReply with the amount to send \\(e\\.g\\. \`0\\.1\`\\):`, { parse_mode: 'MarkdownV2' });
    } else if (assetAction === 'transfer_nft') {
      userState.set(chatId, { type: 'transfer_nft', step: 'contract', chain, fromIndex: sourceIndex, destAddress: destWallet.info.address });
      await ctx.editMessageText('Reply with the NFT Contract Address \\(e\\.g\\. `0x\\.\\.\\.`\\):', { parse_mode: 'MarkdownV2' });
    } else if (assetAction === 'consolidate_eth') {
      userState.set(chatId, { type: 'consolidate_eth', step: 'sources', chain, destAddress: destWallet.info.address });
      await ctx.editMessageText('Reply with the wallets to consolidate from \\(e\\.g\\. `all` or `0,1,2`\\):', { parse_mode: 'MarkdownV2' });
    } else if (assetAction === 'sweep_nfts') {
      userState.set(chatId, { type: 'sweep_nfts', step: 'contract', chain, fromIndex: sourceIndex, destAddress: destWallet.info.address });
      await ctx.editMessageText(`🧹 *Sweep NFTs on ${chain}*\n\nSweeping to ${destWallet.info.label ?? `Wallet ${destIndex + 1}`}\\.\nReply with the NFT Contract Address to sweep \\(0x\\.\\.\\.\\):`, { parse_mode: 'MarkdownV2' });
    }
    
    await ctx.answerCbQuery();
    return;
  }

  if (action === 'dest_external') {
    // assets:dest_external:<action>:<chain>:<sourceIndex>
    const assetAction = parts[1];
    const chain = parts[2];
    const sourceIndex = parseInt(parts[3] ?? '-1', 10);
    const chatId = ctx.chat?.id ?? ctx.from?.id;

    if (!chatId || !assetAction || !chain) return;

    if (assetAction === 'transfer_eth') {
      userState.set(chatId, { type: 'transfer_eth', step: 'to', chain, fromIndex: sourceIndex });
      await ctx.editMessageText(`💸 *Transfer ETH on ${chain}*\n\nReply with the external destination address \\(0x\\.\\.\\.\\):`, { parse_mode: 'MarkdownV2' });
    } else if (assetAction === 'transfer_nft') {
      userState.set(chatId, { type: 'transfer_nft', step: 'to', chain, fromIndex: sourceIndex });
      await ctx.editMessageText('Reply with the external destination address \\(e\\.g\\. `0x\\.\\.\\.`\\):', { parse_mode: 'MarkdownV2' });
    } else if (assetAction === 'consolidate_eth') {
      userState.set(chatId, { type: 'consolidate_eth', step: 'to', chain });
      await ctx.editMessageText('Reply with the external destination address \\(e\\.g\\. `0x\\.\\.\\.`\\):', { parse_mode: 'MarkdownV2' });
    } else if (assetAction === 'sweep_nfts') {
      userState.set(chatId, { type: 'sweep_nfts', step: 'to', chain });
      await ctx.editMessageText('Reply with the external destination address \\(e\\.g\\. `0x\\.\\.\\.`\\):', { parse_mode: 'MarkdownV2' });
    }
    
    await ctx.answerCbQuery();
    return;
  }

  if (action === 'menu') {
    await ctx.editMessageText('💸 *Asset Management*\n\nSelect an action:', {
      parse_mode: 'MarkdownV2',
      ...assetsMenuKeyboard()
    });
    return;
  }

  const config = deps.appConfig;
  const enabledChains = Object.entries(config.chains)
    .filter(([_, c]) => c?.enabled)
    .map(([c]) => c as ChainId);

  if (action === 'transfer_eth') {
    await ctx.editMessageText('💸 *Transfer ETH*\n\nSelect the chain:', {
      parse_mode: 'MarkdownV2',
      ...chainSelectionKeyboard(enabledChains, 'transfer_eth'),
    });
  } else if (action === 'transfer_nft') {
    await ctx.editMessageText('🎫 *Transfer NFT*\n\nSelect the chain:', {
      parse_mode: 'MarkdownV2',
      ...chainSelectionKeyboard(enabledChains, 'transfer_nft'),
    });
  } else if (action === 'disperse_eth') {
    await ctx.editMessageText('💦 *Disperse ETH*\n\nSelect the chain:', {
      parse_mode: 'MarkdownV2',
      ...chainSelectionKeyboard(enabledChains, 'disperse_eth'),
    });
  } else if (action === 'sweep_nfts') {
    await ctx.editMessageText('🧹 *Sweep NFTs*\n\nSelect the chain:', {
      parse_mode: 'MarkdownV2',
      ...chainSelectionKeyboard(enabledChains, 'sweep_nfts'),
    });
  } else if (action === 'consolidate_eth') {
    await ctx.editMessageText('📥 *Consolidate ETH*\n\nSelect the chain:', {
      parse_mode: 'MarkdownV2',
      ...chainSelectionKeyboard(enabledChains, 'consolidate_eth'),
    });
  }
  await ctx.answerCbQuery();
}

async function handleGasConfig(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[1];
  
  if (action === 'config_menu') {
    const keyboardRows = [];
    const chains = Object.keys(CHAIN_NAMES) as ChainId[];
    for (let i = 0; i < chains.length; i += 2) {
      const row = [];
      row.push({ text: CHAIN_NAMES[chains[i]!]!, callback_data: `gas:chain:${chains[i]}` });
      if (i + 1 < chains.length) {
        row.push({ text: CHAIN_NAMES[chains[i + 1]!]!, callback_data: `gas:chain:${chains[i + 1]}` });
      }
      keyboardRows.push(row);
    }
    keyboardRows.push([{ text: '◀️ Back', callback_data: 'menu:gas' }]);
    
    await ctx.editMessageText('⚙️ *Gas Configuration*\n\nSelect a chain to configure its gas settings:', {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: keyboardRows }
    });
    return;
  }
  
  if (action === 'chain') {
    const chainId = parts[2] as ChainId;
    const adapter = deps.adapters.get(chainId) as any;
    if (!adapter) return;
    
    const config = adapter.config;
    if (!config) return;
    
    const gas = config.gas;
    const isCustom = gas.mode === 'custom';
    const modeStr = isCustom ? 'Custom' : 'Auto';
    
    const msg = `⚙️ *Gas Config: ${escapeMarkdownV2(CHAIN_NAMES[chainId]!)}*\n\n` +
      `Mode: *${modeStr}*\n` +
      (isCustom ? 
        `Base Fee: ${escapeMarkdownV2(String(gas.customBaseFeeGwei ?? 0))} gwei\n` +
        `Max Prio: ${escapeMarkdownV2(String(gas.customPriorityFeeGwei ?? 0))} gwei\n` 
      : 
        `Aggression: ${escapeMarkdownV2(gas.aggression.toUpperCase())}\n` +
        `Max Prio Baseline: ${escapeMarkdownV2(String(gas.maxPriorityFeeGwei))} gwei\n`
      );
      
    await ctx.editMessageText(msg, {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [
            { text: isCustom ? '🟢 Custom' : '⚪ Custom', callback_data: `gas:setmode:${chainId}:custom` },
            { text: !isCustom ? '🟢 Auto' : '⚪ Auto', callback_data: `gas:setmode:${chainId}:auto` }
          ],
          [
            { text: '✏️ Edit Custom Fees', callback_data: `gas:edit:${chainId}` }
          ],
          [{ text: '◀️ Back', callback_data: 'gas:config_menu' }]
        ]
      }
    });
    return;
  }
  
  if (action === 'setmode') {
    const chainId = parts[2] as ChainId;
    const mode = parts[3] as 'auto' | 'custom';
    
    const adapter = deps.adapters.get(chainId) as any;
    if (adapter && adapter.config) {
      adapter.config.gas.mode = mode;
    }
    
    // Refresh
    await handleGasConfig(ctx, ['gas', 'chain', chainId]);
    return;
  }
  
  if (action === 'edit') {
    const chainId = parts[2] as ChainId;
    deps.pendingInputs.set(ctx.from!.id, {
      field: `gas_custom_base:${chainId}`,
      callback: async (text: string) => {
        const parts = text.trim().split(/\s+/);
        if (parts.length >= 2) {
          const base = parseFloat(parts[0]!);
          const prio = parseFloat(parts[1]!);
          if (!isNaN(base) && !isNaN(prio)) {
            const adapter = deps.adapters.get(chainId) as any;
            if (adapter && adapter.config) {
              adapter.config.gas.mode = 'custom';
              adapter.config.gas.customBaseFeeGwei = base;
              adapter.config.gas.customPriorityFeeGwei = prio;
              await ctx.reply(`✅ Updated ${chainId} custom gas: Base=${base} gwei, Prio=${prio} gwei.`);
              return;
            }
          }
        }
        await ctx.reply(`❌ Invalid format. Please provide two numbers (e.g., 0.05 1.5).`);
      }
    });
    
    await ctx.reply(`Please reply with your custom Base Fee and Max Priority Fee in gwei, separated by a space.\n\nExample: \`0.05 1.5\` (Base: 0.05, Prio: 1.5)`, {
      parse_mode: 'MarkdownV2'
    });
    await ctx.answerCbQuery();
    return;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Portfolio Actions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handlePortfolio(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[0];
  if (!action) return;

  switch (action) {
    case 'menu': {
      const wallets = deps.walletManager.getAllWallets();
      await ctx.editMessageText('🖼️ *Portfolio*\n\nSelect a wallet to view its NFTs:', {
        parse_mode: 'MarkdownV2',
        ...portfolioWalletSelectKeyboard(wallets)
      });
      break;
    }
    case 'wallet':
    case 'refresh': {
      const index = parseInt(parts[1] ?? '0', 10);
      const wallet = deps.walletManager.getWallet(index);
      if (wallet) {
        const label = wallet.info.label ?? `Wallet ${index + 1}`;
        
        // Show loading state first
        if (action === 'refresh') {
          await ctx.answerCbQuery('Refreshing NFTs...');
        } else {
          await ctx.editMessageText(`🖼️ *Portfolio: ${escapeMarkdownV2(label)}*\n\n_Loading NFTs across all chains\\.\\.\\._`, {
            parse_mode: 'MarkdownV2',
            ...portfolioDetailKeyboard(index)
          }).catch(() => {});
        }

        // Fetch NFTs concurrently across all enabled chains
        const config = deps.appConfig;
        const activeChains = Object.entries(config.chains)
          .filter(([_, c]) => c?.enabled)
          .map(([c]) => c as ChainId);
        const results = await Promise.allSettled(
          activeChains.map(async (chain) => {
            const tokens = await reservoirService.getUserTokens(chain, wallet.address);
            return { chain, tokens };
          })
        );

        let output = `🖼️ *Portfolio: ${escapeMarkdownV2(label)}*\n\n`;
        let totalNfts = 0;

        for (const res of results) {
          if (res.status === 'fulfilled' && res.value.tokens.length > 0) {
            const { chain, tokens } = res.value;
            const emoji = CHAIN_EMOJI[chain] ?? '🔹';
            const chainName = escapeMarkdownV2(CHAIN_NAMES[chain] ?? chain);
            output += `${emoji} *${chainName}*\n`;
            
            for (const item of tokens) {
              totalNfts++;
              const name = escapeMarkdownV2(item.token.name || item.token.collection?.name || 'Unknown Token');
              const count = parseInt(item.ownership.tokenCount || '1', 10);
              output += `• ${count > 1 ? `${count}x ` : ''}${name}\n`;
            }
            output += '\n';
          }
        }

        if (totalNfts === 0) {
          output += '_No NFTs found on supported chains\\._';
        }

        // Keep it within Telegram message length limits
        if (output.length > 4000) {
          output = output.slice(0, 4000) + '\\.\\.\\.\n_Output truncated\\._';
        }

        await ctx.editMessageText(output, {
          parse_mode: 'MarkdownV2',
          ...portfolioDetailKeyboard(index)
        }).catch(() => {});
      }
      break;
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tracker Actions
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function handleTracker(ctx: Context, parts: string[]): Promise<void> {
  const action = parts[0];
  if (!action) return;

  if (action === 'chain') {
    // tracker:chain:<chain>
    const chain = parts[1];
    const chatId = ctx.chat?.id ?? ctx.from?.id;
    if (!chatId || !chain) return;

    userState.set(chatId, { type: 'add_tracker', chain });
    await ctx.editMessageText(`🎯 *Add Tracker on ${chain}*\n\nReply with the contract address to monitor:`, { parse_mode: 'MarkdownV2' });
    await ctx.answerCbQuery();
    return;
  }

  if (action === 'remove') {
    const index = parseInt(parts[1] ?? '0', 10);
    const trackers = getTrackers(deps.db);
    const tracker = trackers[index];
    if (tracker) {
      removeTracker(deps.db, tracker.chain, tracker.contractAddress);
      await ctx.answerCbQuery('🗑️ Tracker removed');
      // refresh list
      await handleTracker(ctx, ['list']);
    }
    return;
  }

  switch (action) {
    case 'add':
      const config = deps.appConfig;
      const enabledChains = Object.entries(config.chains)
        .filter(([_, c]) => c?.enabled)
        .map(([c]) => c as ChainId);
      await ctx.editMessageText('🎯 *Add Tracker*\n\nSelect the chain:', {
        parse_mode: 'MarkdownV2',
        ...chainSelectionKeyboard(enabledChains, 'add_tracker'),
      });
      break;
    case 'list': {
      const trackers = getTrackers(deps.db);
      if (trackers.length === 0) {
        await ctx.editMessageText('📋 *Monitored Contracts*\n\n_No contracts currently monitored\\._', {
          parse_mode: 'MarkdownV2',
          ...trackerKeyboard()
        });
      } else {
        const lines = trackers.map((t, i) => {
          const emoji = CHAIN_EMOJI[t.chain] ?? '🔹';
          const addr = escapeMarkdownV2(t.contractAddress);
          return `\`${i}\` \\| ${emoji} \`${addr}\``;
        });

        // Add a small remove button keyboard underneath
        const buttons = [];
        for (let i = 0; i < trackers.length; i += 3) {
          const row = [];
          for (let j = 0; j < 3 && i + j < trackers.length; j++) {
            row.push(Markup.button.callback(`❌ Remove ${i + j}`, `tracker:remove:${i + j}`));
          }
          buttons.push(row);
        }
        buttons.push([Markup.button.callback('◀️ Back', 'menu:main')]);

        await ctx.editMessageText(`📋 *Monitored Contracts*\n\n${lines.join('\n')}`, {
          parse_mode: 'MarkdownV2',
          reply_markup: { inline_keyboard: buttons }
        });
      }
      break;
    }
  }
}
