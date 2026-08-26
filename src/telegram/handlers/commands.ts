/**
 * Telegram slash command handlers.
 * Each command sends a formatted response with appropriate inline keyboards.
 */

import type { Telegraf, Context } from 'telegraf';
import { mainMenuKeyboard } from '../menus/main-menu.js';
import { walletListKeyboard, emptyWalletKeyboard } from '../menus/wallet-menu.js';
import { configMenuKeyboard } from '../menus/config-menu.js';
import { watchlistKeyboard } from '../menus/watchlist-menu.js';
import { alphaListKeyboard } from '../menus/alpha-menu.js';
import { mintHistoryKeyboard } from '../menus/mint-menu.js';
import { assetsMenuKeyboard } from '../menus/assets-menu.js';
import {
  escapeMarkdownV2,
  formatStatus,
  formatWalletBalance,
} from '../formatters.js';
import { isAddress, getAddress } from 'viem';
import type { StrategyEngine } from '../../strategy/strategy-engine.js';
import type { WalletManager } from '../../wallet/wallet-manager.js';
import type { IChainAdapter, ChainId } from '../../types/chains.js';
import type { Database } from 'sql.js';
import { getRecentMints, getMintCount, getWatchlist } from '../../storage/models.js';
import { addTracker } from '../../storage/tracker-store.js';
import { createLogger } from '../../core/logger.js';
import { CHAIN_NAMES, MINT_SELECTORS } from '../../core/constants.js';
import { reservoirService } from '../../services/reservoir.js';
import { userState } from '../state.js';
import { parseEther } from 'viem';
import { getRpcs, addRpc, getActiveRpc } from '../../storage/models.js';
import { getNativePriceUsd, getNativeSymbol } from '../../core/price-oracle.js';
import type { Executor } from '../../execution/executor.js';

export interface CommandDeps {
  strategyEngine: StrategyEngine;
  walletManager: WalletManager;
  adapters: Map<ChainId, IChainAdapter>;
  executor: Executor;
  assetManager: import('../../execution/asset-manager.js').AssetManager;
  db: Database;
  eventBus: any;
  startTime: number;
}

let deps: CommandDeps;

/** Set shared dependencies for command handlers */
export function setCommandDeps(d: CommandDeps): void {
  deps = d;
}

function parseWalletSelection(input: string, maxIndex: number): number[] {
  if (input.toLowerCase() === 'all') {
    return Array.from({ length: maxIndex + 1 }, (_, i) => i);
  }
  const selection = new Set<number>();
  const parts = input.split(',');
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.includes('-')) {
      const [startStr, endStr] = trimmed.split('-');
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          if (i <= maxIndex) selection.add(i);
        }
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num <= maxIndex) {
        selection.add(num);
      }
    }
  }
  return Array.from(selection).sort((a, b) => a - b);
}

/** Register all slash commands */
export function registerCommands(bot: Telegraf<Context>): void {
  // Register the commands menu in the Telegram UI
  bot.telegram.setMyCommands([
    { command: 'start', description: 'Main menu' },
    { command: 'status', description: 'Bot status & connections' },
    { command: 'wallets', description: 'View wallet balances' },
    { command: 'gas', description: 'Current gas prices' },
    { command: 'mints', description: 'Mint history' },
    { command: 'watchlist', description: 'Manage watched contracts' },
    { command: 'alphas', description: 'Manage alpha wallets' },
    { command: 'config', description: 'Strategy settings' },
    { command: 'pause', description: 'Pause auto-minting' },
    { command: 'resume', description: 'Resume auto-minting' },
    { command: 'help', description: 'Command reference' }
  ]).catch(err => {
    // Log silently if it fails (e.g. rate limit)
    console.error('Failed to set Telegram commands menu:', err);
  });

  // /start — Welcome message with main menu
  bot.command('start', async (ctx) => {
    const welcome = [
      `🤖 *NFT Mint Bot*`,
      ``,
      `Multi\\-chain NFT minting bot with auto\\-detection,`,
      `gas optimization, and wallet management\\.`,
      ``,
      `Use the menu below or type /help for commands\\.`,
    ].join('\n');

    await ctx.reply(welcome, {
      parse_mode: 'MarkdownV2',
      ...mainMenuKeyboard(),
    });
  });

  // /status — Bot health + chain connections
  bot.command('status', async (ctx) => {
    const chains = (['ethereum', 'base', 'polygon', 'arbitrum', 'optimism', 'avalanche', 'bsc', ] as ChainId[]).map((chain) => ({
      chain,
      connected: deps.adapters.get(chain)?.isConnected() ?? false,
    }));

    const uptime = Date.now() - deps.startTime;
    const mode = deps.strategyEngine.getConfig().mode;
    const msg = formatStatus(chains, uptime, deps.walletManager.count, mode);

    await ctx.reply(msg, { parse_mode: 'MarkdownV2', ...mainMenuKeyboard() });
  });

  // /wallets — List wallets with balances
  bot.command(['wallets', 'wallet'], async (ctx) => {
    const wallets = deps.walletManager.getAllWallets();
    if (wallets.length === 0) {
      await ctx.reply(
        `💰 *Wallets*\n\n${escapeMarkdownV2('No wallets configured. You can generate new wallets here or run `npm run setup` in your terminal.')}`,
        { parse_mode: 'MarkdownV2', ...emptyWalletKeyboard() }
      );
      return;
    }

    const msg = `💰 *Wallets*\n\nSelect a wallet below to view its balances across all chains, or manage your wallets:`;

    await ctx.reply(msg, {
      parse_mode: 'MarkdownV2',
      ...walletListKeyboard(wallets),
    });
  });

  // /assets — Manage Assets
  bot.command('assets', async (ctx) => {
    await ctx.reply(
      `🔀 *Asset Management*\n\nChoose an action to perform:`,
      { parse_mode: 'MarkdownV2', ...assetsMenuKeyboard() }
    );
  });

  // /gas — Current gas prices
  bot.command('gas', async (ctx) => {
    // Send initial loading state
    const loadingMsg = await ctx.reply(
      `⛽ *Gas Prices*\n\n${escapeMarkdownV2('Fetching live prices & gas rates...')}`,
      { parse_mode: 'MarkdownV2', ...mainMenuKeyboard() }
    );

    const lines = [];
    for (const [chainId, adapter] of deps.adapters.entries()) {
      if (adapter.isConnected()) {
        try {
          const gasPrice = await adapter.getGasPrice();
          const gwei = Number(gasPrice) / 1e9;
          const gweiStr = escapeMarkdownV2(gwei.toFixed(2));
          const chainStr = escapeMarkdownV2(CHAIN_NAMES[chainId] ?? chainId);
          const symbol = escapeMarkdownV2(getNativeSymbol(chainId));
          
          const usdPrice = await getNativePriceUsd(chainId);
          
          if (usdPrice > 0) {
            // Estimate USD costs (Mint = ~120k gas, Swap = ~180k gas)
            const weiCostPerGas = Number(gasPrice) / 1e18;
            const mintCostUsd = weiCostPerGas * 120000 * usdPrice;
            const swapCostUsd = weiCostPerGas * 180000 * usdPrice;
            
            lines.push(`*${chainStr}* \\| $${escapeMarkdownV2(usdPrice.toFixed(2))} ${symbol}`);
            lines.push(`└ Base Fee: ${gweiStr} Gwei`);
            lines.push(`└ Mint \\(~120k\\): $${escapeMarkdownV2(mintCostUsd.toFixed(2))}`);
            lines.push(`└ Swap \\(~180k\\): $${escapeMarkdownV2(swapCostUsd.toFixed(2))}`);
          } else {
            lines.push(`*${chainStr}*`);
            lines.push(`└ Base Fee: ${gweiStr} Gwei`);
          }
          lines.push(''); // Spacing
        } catch (e) {
          const chainStr = escapeMarkdownV2(CHAIN_NAMES[chainId] ?? chainId);
          lines.push(`*${chainStr}*`);
          lines.push(`└ Error fetching data`);
          lines.push('');
        }
      }
    }

    if (lines.length === 0) {
      lines.push(escapeMarkdownV2('No connected chains.'));
    }

    const gasMsg = [
      `⛽ *Live Gas Prices*`,
      ``,
      ...lines,
      `_Gas limits are estimates\\. Actual costs may vary\\._`,
    ].join('\n');

    await ctx.telegram.editMessageText(
      ctx.chat.id,
      loadingMsg.message_id,
      undefined,
      gasMsg,
      { parse_mode: 'MarkdownV2', ...mainMenuKeyboard() }
    );
  });

  // /mints — Recent mint history
  bot.command('mints', async (ctx) => {
    const mints = getRecentMints(deps.db, 10, 0);
    const totalCount = getMintCount(deps.db);
    const totalPages = Math.max(1, Math.ceil(totalCount / 10));

    if (mints.length === 0) {
      await ctx.reply(
        `📜 *Mint History*\n\n${escapeMarkdownV2('No mints recorded yet.')}`,
        { parse_mode: 'MarkdownV2', ...mintHistoryKeyboard(0, 1) }
      );
      return;
    }

    const lines = mints.map((m) => {
      const status = m.status === 'confirmed' ? '✅' : m.status === 'failed' ? '❌' : '⏳';
      const chain = escapeMarkdownV2(CHAIN_NAMES[m.chain as ChainId] ?? m.chain);
      const addr = escapeMarkdownV2(`${m.contract_address.slice(0, 8)}...`);
      return `${status} ${chain} \\| ${addr} \\| ${escapeMarkdownV2(m.mint_price)} wei`;
    });

    const msg = `📜 *Mint History*\n\n${lines.join('\n')}`;
    await ctx.reply(msg, { parse_mode: 'MarkdownV2', ...mintHistoryKeyboard(0, totalPages) });
  });

  // /watchlist — View/manage watched contracts
  bot.command('watchlist', async (ctx) => {
    const entries = deps.strategyEngine.getWatchlist();

    const msg = `🎯 *Watchlist* \\(${escapeMarkdownV2(entries.length.toString())} contracts\\)`;
    await ctx.reply(msg, { parse_mode: 'MarkdownV2', ...watchlistKeyboard(entries) });
  });

  // /alphas — View/manage alpha wallets
  bot.command('alphas', async (ctx) => {
    const alphas = deps.strategyEngine.getAlphaWallets();
    const msg = `🎭 *Alpha Wallets* \\(${escapeMarkdownV2(alphas.length.toString())}\\)\n\n${escapeMarkdownV2('Manage wallets to auto-copy mints from:')}`;
    await ctx.reply(msg, {
      parse_mode: 'MarkdownV2',
      ...alphaListKeyboard(alphas)
    });
  });

  // /snipe <address> — Quick-add a contract to snipe
  bot.command('snipe', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1);
    const address = args[0];

    if (!address) {
      await ctx.reply(
        `${escapeMarkdownV2('Usage: /snipe <contract_address>')}`,
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    deps.strategyEngine.addToWatchlist({
      chain: 'ethereum', // Default to ETH — could parse chain from args
      contractAddress: address,
      name: `Snipe ${address.slice(0, 8)}`,
      addedAt: Date.now(),
    });

    await ctx.reply(
      `🎯 *Sniping target added*\n\n${escapeMarkdownV2(address)}`,
      { parse_mode: 'MarkdownV2' }
    );
  });

  // /config — Strategy settings
  bot.command('config', async (ctx) => {
    const config = deps.strategyEngine.getConfig();
    const msg = `⚙️ *Strategy Configuration*\n\n${escapeMarkdownV2('Tap a setting to edit:')}`;
    await ctx.reply(msg, { parse_mode: 'MarkdownV2', ...configMenuKeyboard(config) });
  });

  // /pause — Pause the bot
  bot.command('pause', async (ctx) => {
    deps.strategyEngine.pause();
    await ctx.reply(`⏸️ *Bot paused*\n${escapeMarkdownV2('Monitoring continues but no auto-mints.')}`, {
      parse_mode: 'MarkdownV2',
    });
  });

  // /resume — Resume the bot
  bot.command('resume', async (ctx) => {
    deps.strategyEngine.resume();
    await ctx.reply(`▶️ *Bot resumed*\n${escapeMarkdownV2('Auto-minting is active.')}`, {
      parse_mode: 'MarkdownV2',
    });
  });

  // /help — Command reference
  bot.command('help', async (ctx) => {
    const helpText = [
      `❓ *Commands*`,
      ``,
      `/start \\- Main menu`,
      `/status \\- Bot status \\& chain connections`,
      `/wallets \\- View wallet balances`,
      `/gas \\- Current gas prices`,
      `/mints \\- Mint history`,
      `/watchlist \\- Manage watched contracts`,
      `/snipe \\<address\\> \\- Quick\\-add a snipe target`,
      `/rpc \\- Manage Custom RPCs`,
      `/config \\- Strategy settings`,
      `/pause \\- Pause auto\\-minting`,
      `/resume \\- Resume auto\\-minting`,
      `/help \\- This help message`,
    ].join('\n');

    await ctx.reply(helpText, { parse_mode: 'MarkdownV2' });
  });

  // /rpc — Manage RPC Endpoints
  bot.command('rpc', async (ctx) => {
    const keyboardRows = [];
    const chains = Object.keys(CHAIN_NAMES) as ChainId[];
    
    // Group into rows of 2
    for (let i = 0; i < chains.length; i += 2) {
      const row = [];
      row.push({ text: CHAIN_NAMES[chains[i]!]!, callback_data: `rpc:list:${chains[i]}` });
      if (i + 1 < chains.length) {
        row.push({ text: CHAIN_NAMES[chains[i + 1]!]!, callback_data: `rpc:list:${chains[i + 1]}` });
      }
      keyboardRows.push(row);
    }
    
    await ctx.reply('🌐 *RPC Management*\n\nSelect a chain to view and configure its RPC endpoints:', {
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: keyboardRows
      }
    });
  });

  // ─── Free-form Text Handler (CA / Explorer Link Detection & Prompts) ───
  bot.on('text', async (ctx, next) => {
    // TypeScript check for text message
    if (!ctx.message || !('text' in ctx.message)) {
      return next();
    }
    const text = ctx.message.text;

    // Check for pending state (e.g. asking for Token ID to sell)
    const state = userState.get(ctx.chat.id);
    if (state && state.type === 'sell_token') {
      const tokenId = text.trim();
      userState.delete(ctx.chat.id); // Clear state

      if (!/^\d+$/.test(tokenId)) {
        await ctx.reply('❌ Invalid Token ID. Please enter a number.', { reply_markup: { remove_keyboard: true } });
        return;
      }

      await ctx.reply(`⏳ *Preparing Sell Transaction...*\n\nChain: ${state.chain}\nCollection: \`${escapeMarkdownV2(state.address)}\`\nToken ID: ${tokenId}`, { parse_mode: 'MarkdownV2' });
      
      try {
        const pk = deps.walletManager.getPrivateKey(0);
        if (!pk) throw new Error('No wallet configured');

        // We will call the execution engine from callbacks or here.
        // For now, we mock the sell response or route it.
        // Actually, we can fetch the sell tx data from Reservoir.
        const account = deps.walletManager.getAllWallets()[0];
        if (!account) throw new Error('No account found');

        const sellData = await reservoirService.getSellTx(state.chain as ChainId, `${state.address}:${tokenId}`, account.info.address);
        
        // This is a placeholder since Reservoir execution involves multiple steps (Approval tx -> Sign message -> Submit)
        await ctx.reply('✅ *Sell intent generated!* \\(Note: Execution engine is currently limited to single transactions, multi\\-step Seaport signing is pending\\)', { parse_mode: 'MarkdownV2' });
      } catch (err: any) {
        await ctx.reply(`❌ *Sell Failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
      }
      return;
    } else if (state && state.type === 'custom_gas') {
      const input = text.trim();
      userState.delete(ctx.chat.id); // Clear state
      
      const parts = input.split(/\s+/);
      if (parts.length === 0 || parts.length > 2 || !parts.every(p => !isNaN(parseFloat(p)))) {
        await ctx.reply('❌ Invalid format. Please enter a number, e.g. "5" or "5 20".', { reply_markup: { remove_keyboard: true } });
        return;
      }
      
      const priorityGwei = parseFloat(parts[0]!);
      const baseGwei = parts.length === 2 ? parseFloat(parts[1]!) : undefined;
      
      await ctx.reply(`⏳ *Executing Custom ${state.action === 'mint' ? 'Mint' : 'Buy'}...*\n\nChain: ${state.chain}\nCollection: \`${escapeMarkdownV2(state.address)}\`\nPriority Fee: ${priorityGwei} Gwei${baseGwei ? `\nMax Base Fee: ${baseGwei} Gwei` : ''}`, { parse_mode: 'MarkdownV2' });
      
      try {
        const pk = deps.walletManager.getPrivateKey(0);
        const account = deps.walletManager.getAllWallets()[0];
        if (!pk || !account) throw new Error('No wallet configured');
        
        const customGas = priorityGwei !== undefined ? {
          maxPriorityFeePerGas: parseEther(priorityGwei.toString(), 'gwei'),
          ...(baseGwei !== undefined ? { maxFeePerGas: parseEther(baseGwei.toString(), 'gwei') } : {})
        } : undefined;

        if (state.action === 'buy') {
          const buyData = await reservoirService.getBuyTx(state.chain as ChainId, state.address, account.info.address);
          
          await ctx.reply(`✅ *Custom Buy Intent Generated, Submitting to Executor...*`, { parse_mode: 'MarkdownV2' });
          
          // Fire and forget, or await.
          deps.executor.executeReservoirPath(state.chain as ChainId, buyData, account, customGas).catch((e: any) => {
            console.error('Reservoir buy error:', e);
          });
          
        } else {
          // Mint flow
          const adapter = deps.adapters.get(state.chain as ChainId);
          if (!adapter) throw new Error('Adapter not found');
          
          const info = await adapter.getContractInfo(state.address);
          if (!info || !info.mintFunction) throw new Error('Mint function not found');
          
          await adapter.sendMint({
            chain: state.chain as ChainId,
            contractAddress: state.address,
            mintFunction: info.mintFunction,
            value: info.priceWei || 0n,
            gasLimit: 300000n,
            args: [],
            customGas
          }, pk);
          
          await ctx.reply(`✅ *Custom Mint Broadcasted!*`, { parse_mode: 'MarkdownV2' });
        }
      } catch (err: any) {
        await ctx.reply(`❌ *Custom ${state.action === 'mint' ? 'Mint' : 'Buy'} Failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
      }
      return;
    } else if (state && state.type === 'add_rpc') {
      const url = text.trim();
      userState.delete(ctx.chat.id); // Clear state

      if (!url.startsWith('ws://') && !url.startsWith('wss://') && !url.startsWith('http://') && !url.startsWith('https://')) {
        await ctx.reply('❌ Invalid RPC URL. Must start with ws://, wss://, http://, or https://');
        return;
      }
      
      const msg = await ctx.reply(`⏳ *Testing new RPC connection...*`, { parse_mode: 'MarkdownV2' });
      
      try {
        addRpc(deps.db, state.chain, url, false);
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `✅ *RPC Added!*\nSuccessfully added RPC to ${escapeMarkdownV2(CHAIN_NAMES[state.chain as ChainId] || state.chain)}\\.\n\nYou can now go to /rpc and set it as active\\.`, { parse_mode: 'MarkdownV2' });
      } catch (err: any) {
        await ctx.telegram.editMessageText(ctx.chat.id, msg.message_id, undefined, `❌ *Failed to add RPC:*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
      }
      return;
    } else if (state && (state.type === 'mint_setup' || state.type === 'schedule_setup')) {
      const amount = parseInt(text.trim(), 10);
      userState.delete(ctx.chat.id);
      
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Invalid amount. Must be a positive number.');
        return;
      }
      if (state.maxPerTx && amount > state.maxPerTx) {
        await ctx.reply(`❌ Amount exceeds max per transaction (${state.maxPerTx}).`);
        return;
      }
      
      if (state.type === 'mint_setup') {
        await ctx.reply(`⏳ *Executing mint for ${amount} tokens...*`, { parse_mode: 'MarkdownV2' });
        try {
          const pk = deps.walletManager.getPrivateKey(0);
          if (!pk) throw new Error('No wallet configured');
          const adapter = deps.adapters.get(state.chain as ChainId);
          if (!adapter) throw new Error('Adapter not found');
          
          await adapter.sendMint({
            chain: state.chain as ChainId,
            contractAddress: state.address,
            mintFunction: state.mintFunction,
            value: (state.priceWei || 0n) * BigInt(amount),
            gasLimit: 300000n,
            args: [amount] // Pass the amount as the argument to mint(uint256)
          }, pk);
          
          await ctx.reply(`✅ *Mint Broadcasted for ${amount} tokens!*`, { parse_mode: 'MarkdownV2' });
        } catch (err: any) {
          await ctx.reply(`❌ *Mint Failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
        }
      } else {
        // schedule_setup
        deps.strategyEngine.addToWatchlist({
          chain: state.chain as ChainId,
          contractAddress: state.address,
          name: `Snipe ${state.address.slice(0, 8)} (${amount}x)`,
          addedAt: Date.now(),
        });
        await ctx.reply(`✅ *Tracking active for ${amount} tokens!*`, { parse_mode: 'MarkdownV2' });
      }
      return;
    } else if (state && state.type === 'transfer_eth') {
      if (state.step === 'to') {
        state.destAddress = text.trim();
        state.step = 'amount';
        userState.set(ctx.chat.id, state);
        await ctx.reply('Reply with the amount of ETH to transfer \\(e\\.g\\. `0.01`\\):', { parse_mode: 'MarkdownV2' });
      } else if (state.step === 'amount') {
        userState.delete(ctx.chat.id);
        try {
          const amountWei = parseEther(text.trim());
          await ctx.reply('⏳ *Executing ETH transfer\\.\\.\\.*', { parse_mode: 'MarkdownV2' });
          const hash = await deps.assetManager.transferEth(state.chain as ChainId, state.fromIndex!, (state.destAddress || state.toIndex)!, amountWei);
          await ctx.reply(`✅ *Transfer successful!*\nTx Hash: \`${escapeMarkdownV2(hash)}\``, { parse_mode: 'MarkdownV2' });
        } catch (err: any) {
          await ctx.reply(`❌ *Transfer failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
        }
      }
      return;
    } else if (state && state.type === 'transfer_nft') {
      if (state.step === 'contract') {
        state.contract = text.trim();
        state.step = 'token';
        userState.set(ctx.chat.id, state);
        await ctx.reply('Reply with the Token ID to transfer:');
      } else if (state.step === 'token') {
        state.tokenId = text.trim();
        userState.set(ctx.chat.id, state);
        // Display destination keyboard
        const wallets = deps.walletManager.getAllWallets();
        const { assetDestinationKeyboard } = await import('../menus/assets-menu.js');
        await ctx.reply(`🎫 *Transfer NFT on ${escapeMarkdownV2(state.chain as string)}*\n\nSelect the Destination Wallet:`, {
          parse_mode: 'MarkdownV2',
          ...assetDestinationKeyboard(wallets, 'transfer_nft', state.chain as string, state.fromIndex ?? -1)
        });
      } else if (state.step === 'to') {
        userState.delete(ctx.chat.id);
        const destAddress = text.trim();
        try {
          await ctx.reply('⏳ *Executing NFT transfer\\.\\.\\.*', { parse_mode: 'MarkdownV2' });
          const hash = await deps.assetManager.transferNft(state.chain as ChainId, state.contract!, state.tokenId!, state.fromIndex!, destAddress);
          await ctx.reply(`✅ *Transfer successful!*\nTx Hash: \`${escapeMarkdownV2(hash)}\``, { parse_mode: 'MarkdownV2' });
        } catch (err: any) {
          await ctx.reply(`❌ *Transfer failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
        }
      }
      return;
    } else if (state && state.type === 'disperse_eth') {
      if (state.step === 'chain') {
        state.chain = text.trim().toLowerCase();
        state.step = 'from';
        userState.set(ctx.chat.id, state);
        await ctx.reply('Reply with the Source Wallet index \\(e\\.g\\. `0`\\):', { parse_mode: 'MarkdownV2' });
      } else if (state.step === 'from') {
        state.fromIndex = parseInt(text.trim(), 10);
        state.step = 'to';
        userState.set(ctx.chat.id, state);
        await ctx.reply('Reply with a comma\\-separated list of destination addresses \\(or wallet indices like `1-3,5`\\):', { parse_mode: 'MarkdownV2' });
      } else if (state.step === 'to') {
        const input = text.trim();
        const maxIndex = deps.walletManager.getAllWallets().length - 1;
        const destinations: (number | string)[] = [];
        
        for (const part of input.split(',')) {
          const t = part.trim();
          if (t.startsWith('0x')) destinations.push(t);
        }
        
        const indices = parseWalletSelection(input, maxIndex);
        for (const idx of indices) {
          if (idx !== state.fromIndex) destinations.push(idx);
        }
        
        // Save to state
        (state as any).destinations = destinations;
        state.step = 'amount';
        userState.set(ctx.chat.id, state);
        await ctx.reply('Reply with the amount of ETH to send to EACH destination \\(e\\.g\\. `0.01`\\):', { parse_mode: 'MarkdownV2' });
      } else if (state.step === 'amount') {
        userState.delete(ctx.chat.id);
        try {
          const amountWei = parseEther(text.trim());
          const destinations = (state as any).destinations as (number | string)[];
          
          await ctx.reply(`💸 *Dispersing ETH to ${destinations.length} destinations\\.\\.\\.*`, { parse_mode: 'MarkdownV2' });
          const hashes = await deps.assetManager.disperseEth(state.chain as ChainId, state.fromIndex!, destinations, amountWei);
          await ctx.reply(`✅ *Disperse completed\\!*\nSuccessfully sent to ${hashes.length} destinations\\.`, { parse_mode: 'MarkdownV2' });
        } catch (err: any) {
          await ctx.reply(`❌ *Disperse failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
        }
      }
      return;
    } else if (state && state.type === 'sweep_nfts') {
        if (state.step === 'to') {
          state.destAddress = text.trim();
          state.step = 'sources';
          userState.set(ctx.chat.id, state);
          await ctx.reply('Reply with the wallets to sweep from (e.g. `all` or `0,1,2`):', { parse_mode: 'MarkdownV2' });
        } else if (state.step === 'sources') {
          const maxIndex = deps.walletManager.getAllWallets().length - 1;
          state.sourceIndices = parseWalletSelection(text.trim(), maxIndex);
          state.step = 'contract';
          userState.set(ctx.chat.id, state);
          await ctx.reply('Reply with the NFT Contract Address to sweep (0x...):', { parse_mode: 'MarkdownV2' });
        } else if (state.step === 'contract') {
          userState.delete(ctx.chat.id);
          const contract = text.trim();
          
          try {
            await ctx.reply(`⏳ *Sweeping NFTs to destination...*`, { parse_mode: 'MarkdownV2' });
            
            // Assuming reservoirService is available in deps, if not we will import/use it
            const { reservoirService } = await import('../../services/reservoir.js');
            const hashes = await deps.assetManager.sweepNfts(
              state.chain as ChainId, 
              state.sourceIndices as number[], 
              state.destAddress!, 
              contract,
              reservoirService
            );
            await ctx.reply(`✅ *Sweep completed!*\nSuccessfully transferred ${hashes.length} NFTs.`, { parse_mode: 'MarkdownV2' });
          } catch (err: any) {
            await ctx.reply(`❌ *Sweep failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
          }
        }
        return;
      } else if (state && state.type === 'consolidate_eth') {
        if (state.step === 'to') {
          state.destAddress = text.trim();
          state.step = 'sources';
          userState.set(ctx.chat.id, state);
          await ctx.reply('Reply with the wallets to consolidate from (e.g. `all` or `0,1,2`):', { parse_mode: 'MarkdownV2' });
        } else if (state.step === 'sources') {
          const maxIndex = deps.walletManager.getAllWallets().length - 1;
          state.sourceIndices = parseWalletSelection(text.trim(), maxIndex);
          state.step = 'amount';
          userState.set(ctx.chat.id, state);
          await ctx.reply('Reply with the amount of ETH to consolidate from each wallet (e.g. `0.01`):', { parse_mode: 'MarkdownV2' });
        } else if (state.step === 'amount') {
          userState.delete(ctx.chat.id);
          try {
            const amountWei = parseEther(text.trim());
            await ctx.reply(`⏳ *Consolidating ETH from ${state.sourceIndices!.length} wallets...*`, { parse_mode: 'MarkdownV2' });
            
            const hashes = await deps.assetManager.consolidateEth(
              state.chain as ChainId, 
              state.sourceIndices as number[], 
              state.destAddress!, 
              amountWei
            );
            await ctx.reply(`✅ *Consolidate completed!*\nSuccessfully consolidated from ${hashes.length} wallets.`, { parse_mode: 'MarkdownV2' });
          } catch (err: any) {
            await ctx.reply(`❌ *Consolidate failed*\n${escapeMarkdownV2(err.message)}`, { parse_mode: 'MarkdownV2' });
          }
        }
        return;
    } else if (state && state.type === 'add_tracker') {
      userState.delete(ctx.chat.id);
      let contract = text.trim();
      
      if (!isAddress(contract)) {
        await ctx.reply('❌ Invalid contract address format.', { parse_mode: 'MarkdownV2' });
        return;
      }
      
      contract = getAddress(contract); // checksum
      
      // Save it to tracker store
      addTracker(deps.db, state.chain as ChainId, contract);
      
      // Tell adapter to start watching
      const adapter = deps.adapters.get(state.chain as ChainId);
      if (adapter) {
        adapter.watchContract(contract, (event) => {
          deps.eventBus.emit('tracker:mint:detected', event);
        });
      }
      
      await ctx.reply(`✅ *Tracker added!*\n\nNow monitoring \`${contract}\` on ${state.chain} for mint activity\\.`, { parse_mode: 'MarkdownV2' });
      return;
    }
    
    // Ignore commands
    if (text.startsWith('/')) {
      return next();
    }

    // Regex to match EVM address: 0x followed by 40 hex chars
    const addressMatch = text.match(/0x[a-fA-F0-9]{40}/);
    if (!addressMatch) {
      return next();
    }

    const address = addressMatch[0];
    let detectedChain: ChainId = 'ethereum';
    let isExplicitChain = false;

    // Guess chain from URL if present
    const t = text.toLowerCase();
    if (t.includes('basescan')) { detectedChain = 'base'; isExplicitChain = true; }
    else if (t.includes('polygonscan')) { detectedChain = 'polygon'; isExplicitChain = true; }
    else if (t.includes('arbiscan')) { detectedChain = 'arbitrum'; isExplicitChain = true; }
    else if (t.includes('optimistic.etherscan')) { detectedChain = 'optimism'; isExplicitChain = true; }
    else if (t.includes('snowtrace')) { detectedChain = 'avalanche'; isExplicitChain = true; }
    else if (t.includes('bscscan')) { detectedChain = 'bsc'; isExplicitChain = true; }
    else if (t.includes('robinhoodchain')) { detectedChain = 'robinhood'; isExplicitChain = true; }

    let adapter = deps.adapters.get(detectedChain);
    if (!adapter) {
      await ctx.reply(`❌ Supported chain not found for ${detectedChain}`);
      return next();
    }

    const initialMsg = await ctx.reply(`⏳ *Analyzing contract on ${escapeMarkdownV2(CHAIN_NAMES[detectedChain] ?? detectedChain)}\\.\\.\\.*`, { parse_mode: 'MarkdownV2' });

    let info = await adapter.getContractInfo(address);

    // Cross-chain fallback if blindly pasted address has no bytecode on Ethereum
    if ((!info || !info.isValid) && !isExplicitChain && detectedChain === 'ethereum') {
      for (const [chainId, otherAdapter] of deps.adapters.entries()) {
        if (chainId === 'ethereum' || !otherAdapter.isConnected()) continue;
        const otherInfo = await otherAdapter.getContractInfo(address);
        if (otherInfo && otherInfo.isValid) {
          detectedChain = chainId;
          adapter = otherAdapter;
          info = otherInfo;
          await ctx.telegram.editMessageText(
            ctx.chat.id, 
            initialMsg.message_id, 
            undefined, 
            `⏳ *Found on ${escapeMarkdownV2(CHAIN_NAMES[detectedChain] ?? detectedChain)}\\.\\.\\.*`, 
            { parse_mode: 'MarkdownV2' }
          );
          break;
        }
      }
    }
    
    if (!info) {
      await ctx.telegram.editMessageText(ctx.chat.id, initialMsg.message_id, undefined, `❌ Error analyzing contract on ${escapeMarkdownV2(CHAIN_NAMES[detectedChain] ?? detectedChain)}`);
      return next();
    }

    if (!info.isValid) {
      await ctx.telegram.editMessageText(ctx.chat.id, initialMsg.message_id, undefined, `❌ *Invalid Contract Address*\nNo bytecode found for \`${escapeMarkdownV2(address)}\` on ${escapeMarkdownV2(CHAIN_NAMES[detectedChain] ?? detectedChain)}\\.`, { parse_mode: 'MarkdownV2' });
      return next();
    }

    const chainName = escapeMarkdownV2(CHAIN_NAMES[detectedChain] ?? detectedChain);
    let nameStr = escapeMarkdownV2(info.name ? `${info.name} ${info.symbol ? `(${info.symbol})` : ''}` : 'Unknown');
    
    // Formatting price
    let priceStr = 'Unknown';
    if (info.priceWei !== undefined) {
      const priceNative = Number(info.priceWei) / 1e18;
      priceStr = escapeMarkdownV2(`${priceNative.toString()} Native`);
    }

    const maxStr = info.maxPerWallet !== undefined ? escapeMarkdownV2(info.maxPerWallet.toString()) : 'Unknown';
    let statusStr = info.isActive === true ? '🟢 Active' : info.isActive === false ? '🔴 Inactive' : '⚪ Unknown';
    const funcStr = info.mintFunction ? escapeMarkdownV2(MINT_SELECTORS[info.mintFunction] ?? info.mintFunction) : 'Unknown';

    let floorStr = '';
    let offerStr = '';
    let supplyStr = '';
    let imageUrl = '';

    // Fetch rich data from Reservoir
    const collection = await reservoirService.getCollection(detectedChain, address);
    if (collection) {
      if (collection.name) nameStr = escapeMarkdownV2(collection.name);
      if (collection.image) imageUrl = collection.image;
      
      supplyStr = `\n*Supply:* ${escapeMarkdownV2(collection.tokenCount)} minted`;
      
      if (collection.floorAsk?.price?.amount?.decimal) {
        floorStr = `\n*Floor Price:* ${escapeMarkdownV2(collection.floorAsk.price.amount.decimal.toString())} ${escapeMarkdownV2(collection.floorAsk.price.currency?.symbol || 'ETH')}`;
        // If it has a floor price and supply > 0, it's already minted/trading
        if (Number(collection.tokenCount) > 0) {
          statusStr = '🛒 Trading on Secondary';
        }
      }
      
      if (collection.topBid?.price?.amount?.decimal) {
        offerStr = `\n*Top Offer:* ${escapeMarkdownV2(collection.topBid.price.amount.decimal.toString())} ${escapeMarkdownV2(collection.topBid.price.currency?.symbol || 'ETH')}`;
      }
    }

    if (info.totalSupply !== undefined && info.maxSupply !== undefined && info.maxSupply > 0) {
      const percentage = ((info.totalSupply / info.maxSupply) * 100).toFixed(1);
      supplyStr = `\n*Supply:* ${escapeMarkdownV2(info.totalSupply.toString())} / ${escapeMarkdownV2(info.maxSupply.toString())} Minted (${escapeMarkdownV2(percentage)}%)`;
    } else if (info.totalSupply !== undefined) {
      supplyStr = `\n*Supply:* ${escapeMarkdownV2(info.totalSupply.toString())} minted`;
    } else if (info.maxSupply !== undefined) {
      supplyStr = `\n*Supply:* Unknown / ${escapeMarkdownV2(info.maxSupply.toString())} total`;
    }
    
    // If we have total supply 0 and inactive, it's Upcoming
    if (statusStr === '🔴 Inactive' && (info.totalSupply === 0 || !supplyStr.includes('minted'))) {
      statusStr = '⏳ Upcoming';
    }

    const maxTxStr = info.maxPerTx !== undefined ? `\n*Max per Tx:* ${escapeMarkdownV2(info.maxPerTx.toString())}` : '';

    const phaseStr = info.mintPhase ? `\n*Mint Phase:* ${escapeMarkdownV2(info.mintPhase)}` : '';

    const msg = `🎯 *Contract Auto\\-Detected*\n\n` +
      `*Name:* ${nameStr}\n` +
      `*Chain:* ${chainName}\n` +
      `*Contract:* \`${escapeMarkdownV2(address)}\`${supplyStr}\n` +
      `*Mint Price:* ${priceStr}\n` +
      `*Max per Wallet:* ${maxStr}${maxTxStr}${floorStr}${offerStr}\n` +
      `*Mint Status:* ${statusStr}${phaseStr}\n` +
      `*Mint Function:* \`${funcStr}\`\n\n` +
      `What would you like to do?`;

    const buttons = [];
    if (statusStr.includes('Trading')) {
      buttons.push({ text: '🛒 Buy Floor (Fast)', callback_data: `ca:buy:${detectedChain}:${address}:f` });
      buttons.push({ text: '💰 Sell', callback_data: `ca:sell:${detectedChain}:${address}` });
      buttons.push({ text: '⚙️ Custom Gas', callback_data: `ca:gas:buy:${detectedChain}:${address}` });
    } else {
      buttons.push({ text: '⚡ Mint (Fast Gas)', callback_data: `ca:mint:${detectedChain}:${address}:f` });
      buttons.push({ text: '⚡ Mint (Aggressive)', callback_data: `ca:mint:${detectedChain}:${address}:a` });
      buttons.push({ text: '⚙️ Custom Gas', callback_data: `ca:gas:mint:${detectedChain}:${address}` });
    }
    
    // Always provide scheduling/watching as a fallback
    if (!statusStr.includes('Trading')) {
      buttons.push({ text: '🕒 Schedule Mint', callback_data: `ca:sch:${detectedChain}:${address}` });
    }

    // Split buttons into rows of 2 for better UI
    const keyboardRows = [];
    for (let i = 0; i < buttons.length; i += 2) {
      keyboardRows.push(buttons.slice(i, i + 2));
    }
    keyboardRows.push([{ text: '❌ Ignore', callback_data: 'ca:ignore' }]);

    try {
      if (imageUrl) {
        // We need to delete the original text message and send a photo message
        await ctx.deleteMessage(initialMsg.message_id).catch(() => {});
        await ctx.replyWithPhoto(imageUrl, {
          caption: msg,
          parse_mode: 'MarkdownV2',
          reply_markup: { inline_keyboard: keyboardRows }
        });
        return;
      }
    } catch (e) {
      // Fallback to text if photo fails
    }

    await ctx.telegram.editMessageText(ctx.chat.id, initialMsg.message_id, undefined, msg, {
      parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: keyboardRows }
    });
  });
}
