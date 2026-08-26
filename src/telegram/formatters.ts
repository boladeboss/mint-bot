/**
 * Telegram MarkdownV2 formatting helpers.
 * All functions return properly escaped strings safe for Telegram's MarkdownV2 parse mode.
 */

import { CHAIN_EMOJI, CHAIN_NAMES, EXPLORER_TX_PATH, ETH_DECIMALS, SOL_DECIMALS } from '../core/constants.js';
import type { ChainId } from '../types/chains.js';
import type { MintOpportunity, MintResult, MintFailure } from '../types/events.js';
import type { WalletState } from '../types/wallet.js';
import { priceOracle, type TokenId } from '../services/price-oracle.js';

function getPricingToken(chain: ChainId): TokenId {
  switch (chain) {
    case 'polygon': return 'matic-network';
    case 'avalanche': return 'avalanche-2';
    case 'bsc': return 'binancecoin';
    default: return 'ethereum';
  }
}

/** Characters that must be escaped in Telegram MarkdownV2 */
const SPECIAL_CHARS = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

/** Escape special characters for MarkdownV2 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(SPECIAL_CHARS, '\\$&');
}

/** Format a blockchain address (truncated, monospace) */
export function formatAddress(address: string): string {
  if (address.length <= 10) return `\`${escapeMarkdownV2(address)}\``;
  const start = address.slice(0, 6);
  const end = address.slice(-4);
  return `\`${escapeMarkdownV2(start)}\\.\\.\\.\\ ${escapeMarkdownV2(end)}\``;
}

/** Format a full address (monospace, not truncated) */
export function formatFullAddress(address: string): string {
  return `\`${escapeMarkdownV2(address)}\``;
}

/** Format a bigint balance to human-readable with symbol */
export function formatBalance(amount: bigint, decimals: number, symbol: string): string {
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const fractional = amount % divisor;
  const fracStr = fractional.toString().padStart(decimals, '0').slice(0, 4);
  return escapeMarkdownV2(`${whole}.${fracStr} ${symbol}`);
}

/** Format wei to ETH string */
export function formatEth(wei: bigint): string {
  return formatBalance(wei, ETH_DECIMALS, 'ETH');
}

/** Format lamports to SOL string */
export function formatSol(lamports: bigint): string {
  return formatBalance(lamports, SOL_DECIMALS, 'SOL');
}

/** Format gas in gwei */
export function formatGasGwei(gwei: bigint): string {
  return escapeMarkdownV2(`⛽ ${gwei.toString()} gwei`);
}

/** Create a clickable link to a block explorer transaction */
export function formatTxLink(txHash: string, chain: ChainId): string {
  const explorers: Record<ChainId, string> = {
    ethereum: 'https://etherscan.io',
    base: 'https://basescan.org',
    polygon: 'https://polygonscan.com',
    arbitrum: 'https://arbiscan.io',
    optimism: 'https://optimistic.etherscan.io',
    avalanche: 'https://snowtrace.io',
    bsc: 'https://bscscan.com',
    
    robinhood: 'https://explorer.robinhood.com',
  };
  const base = explorers[chain];
  const path = EXPLORER_TX_PATH[chain];
  const url = `${base}${path}${txHash}`;
  const displayHash = `${txHash.slice(0, 8)}...${txHash.slice(-6)}`;
  return `[${escapeMarkdownV2(displayHash)}](${url})`;
}

/** Format a relative timestamp */
export function formatTimestamp(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return escapeMarkdownV2(`${seconds}s ago`);
  if (seconds < 3600) return escapeMarkdownV2(`${Math.floor(seconds / 60)}m ago`);
  if (seconds < 86400) return escapeMarkdownV2(`${Math.floor(seconds / 3600)}h ago`);
  return escapeMarkdownV2(`${Math.floor(seconds / 86400)}d ago`);
}

/** Format uptime from milliseconds */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return escapeMarkdownV2(`${hours}h ${minutes}m`);
}

/** Format a full mint alert message */
export function formatMintAlert(opp: MintOpportunity): string {
  const emoji = CHAIN_EMOJI[opp.chain];
  const chainName = escapeMarkdownV2(CHAIN_NAMES[opp.chain]);
  const symbol = opp.chain === 'bsc' ? 'BNB' : (opp.chain === 'avalanche' ? 'AVAX' : 'ETH');
  const decimals = ETH_DECIMALS;

  return [
    `🚨 *NEW MINT DETECTED*`,
    ``,
    `${emoji} *Chain:* ${chainName}`,
    `📄 *Contract:* ${formatFullAddress(opp.contractAddress)}`,
    `💰 *Price:* ${formatBalance(opp.price, decimals, symbol)}`,
    `⛽ *Est\\. Gas:* ${formatBalance(opp.estimatedGas, decimals, symbol)}`,
    `🔧 *Function:* \`${escapeMarkdownV2(opp.mintFunction)}\``,
    opp.metadata?.name ? `📛 *Name:* ${escapeMarkdownV2(opp.metadata.name)}` : '',
    `⏰ *Detected:* ${formatTimestamp(opp.detectedAt)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** Format a mint success notification */
export function formatMintSuccess(result: MintResult): string {
  const emoji = CHAIN_EMOJI[result.chain];
  const chainName = escapeMarkdownV2(CHAIN_NAMES[result.chain]);
  const symbol = result.chain === 'bsc' ? 'BNB' : (result.chain === 'avalanche' ? 'AVAX' : 'ETH');
  const decimals = ETH_DECIMALS;

  return [
    `✅ *MINT SUCCESSFUL*`,
    ``,
    `${emoji} *Chain:* ${chainName}`,
    `📄 *Contract:* ${formatAddress(result.contractAddress)}`,
    `🔗 *Tx:* ${formatTxLink(result.txHash, result.chain)}`,
    `⛽ *Gas Cost:* ${formatBalance(result.gasCost, decimals, symbol)}`,
    `👛 *Wallet:* ${formatAddress(result.walletAddress)}`,
    result.tokenId ? `🎫 *Token ID:* \`${escapeMarkdownV2(result.tokenId)}\`` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** Format a mint failure notification */
export function formatMintFailure(failure: MintFailure): string {
  const emoji = CHAIN_EMOJI[failure.chain];
  const chainName = escapeMarkdownV2(CHAIN_NAMES[failure.chain]);

  return [
    `❌ *MINT FAILED*`,
    ``,
    `${emoji} *Chain:* ${chainName}`,
    `📄 *Contract:* ${formatAddress(failure.contractAddress)}`,
    `👛 *Wallet:* ${formatAddress(failure.walletAddress)}`,
    `❗ *Reason:* ${escapeMarkdownV2(failure.reason)}`,
  ].join('\n');
}

/** Format wallet balance display */
export function formatWalletBalance(state: WalletState): string {
  const label = state.info.label ?? `Wallet ${state.info.index + 1}`;
  const lines = [
    `*${escapeMarkdownV2(label)}* ⭐️`,
    ``
  ];

  let totalUsd = 0;

  for (const [chain, bal] of state.balances.entries()) {
    const emoji = CHAIN_EMOJI[chain as ChainId] ?? '🔹';
    const name = escapeMarkdownV2(CHAIN_NAMES[chain as ChainId] ?? chain);
    
    // Format Native (ETH/MATIC/etc)
    const divisor = BigInt(10 ** ETH_DECIMALS);
    const whole = bal / divisor;
    const fractional = bal % divisor;
    const fracStr = fractional.toString().padStart(ETH_DECIMALS, '0').slice(0, 4);
    const balStr = escapeMarkdownV2(`${whole}.${fracStr}`);
    const numBal = Number(whole) + Number(fractional) / 10**ETH_DECIMALS;
    
    // Fiat value
    const tokenPrice = priceOracle.getPrice(getPricingToken(chain as ChainId));
    const usdValue = numBal * tokenPrice;
    totalUsd += usdValue;
    const usdStr = escapeMarkdownV2(usdValue.toFixed(2));
    
    // USDC / Token balance (Assuming 6 decimals for USDC)
    const tokenBalRaw = state.tokenBalances.get(chain as ChainId) ?? 0n;
    let tokenStr = '';
    if (tokenBalRaw > 0n) {
      const usdcDivisor = BigInt(10 ** 6);
      const usdcWhole = tokenBalRaw / usdcDivisor;
      const usdcFrac = tokenBalRaw % usdcDivisor;
      const usdcFracStr = usdcFrac.toString().padStart(6, '0').slice(0, 2);
      tokenStr = ` \\| ${escapeMarkdownV2(`${usdcWhole}.${usdcFracStr}`)} ❖`;
      totalUsd += Number(usdcWhole) + Number(usdcFrac) / 10**6; // Add USDC roughly 1:1
    }
    
    lines.push(`${emoji} ${name}: ${balStr} ⧫${tokenStr} \\($${usdStr}\\)`);
  }

  lines.push(``);
  lines.push(`Total: $${escapeMarkdownV2(totalUsd.toFixed(2))}`);
  lines.push(``);
  lines.push(`EVM: \`${state.info.address}\``);

  return lines.join('\n');
}

/** Format bot status message */
export function formatStatus(
  chains: { chain: ChainId; connected: boolean }[],
  uptime: number,
  walletCount: number,
  mode: string
): string {
  const chainLines = chains.map((c) => {
    const emoji = c.connected ? '🟢' : '🔴';
    const name = escapeMarkdownV2(CHAIN_NAMES[c.chain]);
    return `  ${emoji} ${name}`;
  });

  return [
    `📊 *Bot Status*`,
    ``,
    `*Chains:*`,
    ...chainLines,
    ``,
    `⏱ *Uptime:* ${formatUptime(uptime)}`,
    `👛 *Wallets:* ${escapeMarkdownV2(walletCount.toString())}`,
    `🎯 *Mode:* ${escapeMarkdownV2(mode)}`,
  ].join('\n');
}
