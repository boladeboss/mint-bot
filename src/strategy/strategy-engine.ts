/**
 * Strategy engine — evaluates mint opportunities against user-configured rules.
 * Decides whether to auto-mint, add to watchlist, or skip.
 */

import { createLogger } from '../core/logger.js';
import { runAllFilters } from './filters.js';
import type { EventBus } from '../core/event-bus.js';
import type { AppConfig } from '../types/config.js';
import type { WalletManager } from '../wallet/wallet-manager.js';
import type { MintOpportunity } from '../types/events.js';
import type { WalletState } from '../types/wallet.js';
import type { ChainId } from '../types/chains.js';
import type { StrategyConfig, WatchlistEntry, AlphaWallet } from '../types/strategy.js';

const log = createLogger('strategy');

export class StrategyEngine {
  private config: StrategyConfig;
  private walletManager: WalletManager;
  private eventBus: EventBus;
  private watchlist: WatchlistEntry[] = [];
  private mintsThisHour = 0;
  private lastMintTime = 0;
  private hourlyResetInterval?: ReturnType<typeof setInterval>;
  private paused = false;
  private mintDetectedHandler?: (payload: MintOpportunity) => void;
  private alphaTxHandler?: (payload: { chain: ChainId; tx: any }) => void;
  private recentOpportunities: Map<string, MintOpportunity> = new Map();
  private alphaWallets: AlphaWallet[] = [];
  private copyMintsCache: Set<string> = new Set(); // To prevent duplicate copy-mints

  constructor(appConfig: AppConfig, walletManager: WalletManager, eventBus: EventBus) {
    this.config = {
      ...appConfig.strategy,
      defaultRoute: { type: 'public' },
    } as any; // suppress TS error for now since AppConfig's type might not have defaultRoute yet
    this.walletManager = walletManager;
    this.eventBus = eventBus;
  }

  /** Start listening for mint opportunities */
  start(): void {
    // Reset hourly counter every hour
    this.hourlyResetInterval = setInterval(() => {
      this.mintsThisHour = 0;
    }, 3_600_000);

    // Subscribe to mint detected events
    this.mintDetectedHandler = (opportunity: MintOpportunity) => {
      this.handleMintDetected(opportunity).catch((err) => {
        log.error({ err, contract: opportunity.contractAddress }, 'Error handling mint opportunity');
      });
    };

    this.eventBus.on('mint:detected', this.mintDetectedHandler);

    this.alphaTxHandler = (payload: { chain: ChainId; tx: any }) => {
      this.handleAlphaTx(payload).catch((err) => {
        log.error({ err, txHash: payload.tx.hash }, 'Error handling alpha tx');
      });
    };
    this.eventBus.on('alpha:tx:detected', this.alphaTxHandler);
    log.info({ mode: this.config.mode }, 'Strategy engine started');
  }

  /** Stop the strategy engine */
  stop(): void {
    if (this.hourlyResetInterval) {
      clearInterval(this.hourlyResetInterval);
    }
    if (this.mintDetectedHandler) {
      this.eventBus.off('mint:detected', this.mintDetectedHandler);
    }
    if (this.alphaTxHandler) {
      this.eventBus.off('alpha:tx:detected', this.alphaTxHandler);
    }
    log.info('Strategy engine stopped');
  }

  /** Pause bot (stops auto-minting but keeps monitoring) */
  pause(): void {
    this.paused = true;
    log.info('Strategy engine paused');
  }

  /** Resume bot */
  resume(): void {
    this.paused = false;
    log.info('Strategy engine resumed');
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** Handle a detected alpha wallet transaction */
  private async handleAlphaTx(payload: { chain: ChainId; tx: any }): Promise<void> {
    if (this.paused || !this.config.copyMintEnabled) return;

    const { chain, tx } = payload;
    const fromAddr = tx.from?.toLowerCase();
    const toAddr = tx.to?.toLowerCase();

    // Verify it's from an active alpha wallet
    const alpha = this.alphaWallets.find(w => w.address.toLowerCase() === fromAddr && w.enabled);
    if (!alpha || !toAddr) return;

    // Duplicate copy protection (cache key: contract + calldata)
    const cacheKey = `${chain}:${toAddr}:${tx.input}`;
    if (this.copyMintsCache.has(cacheKey)) {
      log.debug({ chain, contract: toAddr }, 'Skipping copy-mint — already copied recently');
      return;
    }

    log.info({ alpha: alpha.name, contract: toAddr, value: tx.value?.toString() }, 'Alpha wallet transaction intercepted');
    
    // Add to cache to prevent duplicates
    this.copyMintsCache.add(cacheKey);
    // Remove from cache after 24 hours
    setTimeout(() => this.copyMintsCache.delete(cacheKey), 24 * 60 * 60 * 1000);

    const opportunity: MintOpportunity = {
      chain,
      contractAddress: tx.to,
      mintFunction: tx.input,
      price: tx.value ?? 0n,
      estimatedGas: tx.gas ?? BigInt(this.config.maxGasEth * 1e18),
      detectedAt: Date.now(),
      metadata: { source: `Alpha: ${alpha.name}` }
    };

    // Treat it like a detected mint opportunity (which will arm/fire if autoMint is on)
    await this.handleMintDetected(opportunity);
  }

  /** Handle a detected mint opportunity */
  private async handleMintDetected(opportunity: MintOpportunity): Promise<void> {
    const encodedAddr = opportunity.contractAddress.slice(0, 20);
    this.recentOpportunities.set(encodedAddr, opportunity);
    // Keep map small
    if (this.recentOpportunities.size > 100) {
      const firstKey = this.recentOpportunities.keys().next().value;
      if (firstKey) this.recentOpportunities.delete(firstKey);
    }

    if (this.paused) {
      log.debug({ contract: opportunity.contractAddress }, 'Skipping — bot is paused');
      return;
    }

    const result = await this.evaluate(opportunity);

    if (result.shouldMint && result.wallet) {
      log.info(
        {
          chain: opportunity.chain,
          contract: opportunity.contractAddress,
          wallet: result.wallet.info.address,
        },
        'Auto-minting approved'
      );
      this.mintsThisHour++;
      this.lastMintTime = Date.now();
      // The executor listens for this event and handles the actual minting
      // We re-emit the opportunity so the executor knows to proceed
    } else {
      log.info(
        { contract: opportunity.contractAddress, reason: result.reason },
        'Mint opportunity skipped'
      );
    }
  }

  /**
   * Evaluate a mint opportunity against the current strategy.
   */
  async evaluate(opportunity: MintOpportunity): Promise<{
    shouldMint: boolean;
    reason?: string;
    wallet?: WalletState;
  }> {
    // Manual mode — never auto-mint
    if (this.config.mode === 'manual') {
      return { shouldMint: false, reason: 'Manual mode — use Telegram to mint' };
    }

    // Watchlist mode — only mint if contract is in watchlist
    if (this.config.mode === 'watchlist') {
      const isWatched = this.watchlist.some(
        (e) =>
          e.chain === opportunity.chain &&
          e.contractAddress.toLowerCase() === opportunity.contractAddress.toLowerCase()
      );
      if (!isWatched) {
        return { shouldMint: false, reason: 'Contract not in watchlist' };
      }
    }

    // Select wallet for the mint
    const wallet = this.walletManager.selectWallet(
      'round-robin', // Could be configurable
      opportunity.chain
    );
    if (!wallet) {
      return { shouldMint: false, reason: 'No eligible wallet available' };
    }

    // Get wallet balance on the relevant chain
    const balance = wallet.balances.get(opportunity.chain) ?? 0n;

    // Run safety filters
    const filterResult = runAllFilters({
      price: opportunity.price,
      estimatedGas: opportunity.estimatedGas,
      balance,
      lastMintTime: this.lastMintTime,
      mintsThisHour: this.mintsThisHour,
      config: this.config,
    });

    if (!filterResult.pass) {
      return { shouldMint: false, reason: filterResult.reason, wallet };
    }

    // If auto-mint is disabled, only notify (don't execute)
    if (!this.config.autoMint) {
      return { shouldMint: false, reason: 'Auto-mint disabled — awaiting manual confirmation' };
    }

    return { shouldMint: true, wallet };
  }

  // ─── Watchlist Management ──────────────────────────────

  addToWatchlist(entry: WatchlistEntry): void {
    const exists = this.watchlist.some(
      (e) =>
        e.chain === entry.chain &&
        e.contractAddress.toLowerCase() === entry.contractAddress.toLowerCase()
    );
    if (!exists) {
      this.watchlist.push(entry);
      log.info({ chain: entry.chain, contract: entry.contractAddress, name: entry.name }, 'Added to watchlist');
    }
  }

  removeFromWatchlist(chain: ChainId, address: string): void {
    this.watchlist = this.watchlist.filter(
      (e) => !(e.chain === chain && e.contractAddress.toLowerCase() === address.toLowerCase())
    );
    log.info({ chain, contract: address }, 'Removed from watchlist');
  }

  getWatchlist(): WatchlistEntry[] {
    return [...this.watchlist];
  }

  // ─── Config ────────────────────────────────────────────

  getConfig(): StrategyConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<StrategyConfig>): void {
    this.config = { ...this.config, ...updates };
    log.info({ updates }, 'Strategy config updated');
  }

  getMintsThisHour(): number {
    return this.mintsThisHour;
  }

  getRecentOpportunity(encodedAddr: string): MintOpportunity | undefined {
    return this.recentOpportunities.get(encodedAddr);
  }

  // --- Alpha Wallet Management ---

  getAlphaWallets(): AlphaWallet[] {
    return this.alphaWallets;
  }

  addAlphaWallet(wallet: AlphaWallet): void {
    if (!this.alphaWallets.find(w => w.address.toLowerCase() === wallet.address.toLowerCase())) {
      this.alphaWallets.push(wallet);
      log.info({ address: wallet.address }, 'Added alpha wallet');
    }
  }

  removeAlphaWallet(address: string): void {
    this.alphaWallets = this.alphaWallets.filter(w => w.address.toLowerCase() !== address.toLowerCase());
    log.info({ address }, 'Removed alpha wallet');
  }

  toggleAlphaWallet(address: string): void {
    const wallet = this.alphaWallets.find(w => w.address.toLowerCase() === address.toLowerCase());
    if (wallet) {
      wallet.enabled = !wallet.enabled;
      log.info({ address, enabled: wallet.enabled }, 'Toggled alpha wallet');
    }
  }
}
