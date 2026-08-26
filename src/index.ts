/**
 * NFT Mint Bot — Entry Point
 * Initializes all services and connects them together.
 */

import 'dotenv/config';
import { loadConfig } from './types/config.js';
import { eventBus } from './core/event-bus.js';
import { createLogger } from './core/logger.js';
import { initDatabase, closeDatabase } from './storage/db.js';
import { WalletManager } from './wallet/wallet-manager.js';
import { StrategyEngine } from './strategy/strategy-engine.js';
import { AssetManager } from './execution/asset-manager.js';
import { EthereumAdapter } from './adapters/ethereum-adapter.js';
import { BaseL2Adapter } from './adapters/base-chain-adapter.js';
import { PolygonAdapter } from './adapters/polygon-adapter.js';
import { ArbitrumAdapter } from './adapters/arbitrum-adapter.js';
import { OptimismAdapter } from './adapters/optimism-adapter.js';
import { AvalancheAdapter } from './adapters/avalanche-adapter.js';
import { BscAdapter } from './adapters/bsc-adapter.js';

import { RobinhoodAdapter } from './adapters/robinhood-adapter.js';
import { Executor } from './execution/executor.js';
import { TxTracker } from './execution/tx-tracker.js';
import { initTrackerStore, getTrackers } from './storage/tracker-store.js';
import { createBot, initBotDeps } from './telegram/bot.js';
import { NotificationService } from './telegram/notifications.js';
import { createApiServer } from './api/server.js';
import type { ChainId, IChainAdapter } from './types/chains.js';

const log = createLogger('main');
const startTime = Date.now();

async function main(): Promise<void> {
  log.info('🚀 Starting NFT Mint Bot...');

  // ─── Load Configuration ──────────────────────────────
  const config = loadConfig();
  log.info('Configuration loaded');

  // ─── Initialize Database ─────────────────────────────
  const db = await initDatabase();
  initTrackerStore(db);
  log.info('Database initialized');

  // Load RPC overrides from DB
  const { getActiveRpc } = await import('./storage/models.js');
  for (const chain of Object.keys(config.chains)) {
    const activeRpc = getActiveRpc(db, chain);
    if (activeRpc && config.chains[chain as ChainId]) {
      config.chains[chain as ChainId]!.rpcWs = activeRpc.url;
      log.info({ chain, rpc: activeRpc.url }, 'Loaded active RPC from database');
    }
  }

  // ─── Initialize Wallet Manager ───────────────────────
  const keystorePassword = process.env['KEYSTORE_PASSWORD'];
  if (!keystorePassword) {
    log.warn('KEYSTORE_PASSWORD not set — wallet operations will fail');
  }
  const walletManager = new WalletManager(keystorePassword ?? 'default-dev-password');

  // Try to load existing wallets
  try {
    walletManager.loadWallets();
  } catch (err) {
    log.warn({ err }, 'No wallets loaded — run `npm run setup` to create wallets');
  }

  // ─── Create Chain Adapters ───────────────────────────
  const adapters = new Map<ChainId, IChainAdapter>();
  const enabledChains: ChainId[] = [];

  if (config.chains.ethereum.enabled) {
    adapters.set('ethereum', new EthereumAdapter(config.chains.ethereum, eventBus));
    enabledChains.push('ethereum');
  }



  if (config.chains.base?.enabled) {
    adapters.set('base', new BaseL2Adapter(config.chains.base, eventBus));
    enabledChains.push('base');
  }

  if (config.chains.polygon?.enabled) {
    adapters.set('polygon', new PolygonAdapter(config.chains.polygon, eventBus));
    enabledChains.push('polygon');
  }

  if (config.chains.arbitrum?.enabled) {
    adapters.set('arbitrum', new ArbitrumAdapter(config.chains.arbitrum, eventBus));
    enabledChains.push('arbitrum');
  }

  if (config.chains.optimism?.enabled) {
    adapters.set('optimism', new OptimismAdapter(config.chains.optimism, eventBus));
    enabledChains.push('optimism');
  }

  if (config.chains.avalanche?.enabled) {
    adapters.set('avalanche', new AvalancheAdapter(config.chains.avalanche, eventBus));
    enabledChains.push('avalanche');
  }

  if (config.chains.bsc?.enabled) {
    adapters.set('bsc', new BscAdapter(config.chains.bsc, eventBus));
    enabledChains.push('bsc');
  }



  if (config.chains.robinhood?.enabled) {
    adapters.set('robinhood', new RobinhoodAdapter(config.chains.robinhood, eventBus));
    enabledChains.push('robinhood');
  }

  log.info({ chains: enabledChains }, 'Chain adapters created');

  // ─── Create Strategy Engine ──────────────────────────
  const strategyEngine = new StrategyEngine(config, walletManager, eventBus);

  // ─── Create Executor ─────────────────────────────────
  const txTracker = new TxTracker(eventBus, db);
  const executor = new Executor(adapters, walletManager, txTracker, eventBus, db);

  // ─── Create Asset Manager ────────────────────────────
  const assetManager = new AssetManager(adapters, walletManager);

  // ─── Create Telegram Bot ─────────────────────────────
  const bot = createBot(config);
  const chatId = parseInt(process.env['TELEGRAM_USER_ID'] ?? '0', 10);

  // Initialize bot dependencies
  const pendingInputs = new Map<number, { field: string; callback: (value: string) => void }>();
  const armedTxs = new Map();

  initBotDeps(
    {
      strategyEngine,
      walletManager,
      adapters,
      executor,
      assetManager,
      db,
      startTime,
    },
    {
      strategyEngine,
      walletManager,
      executor,
      assetManager,
      adapters,
      db,
      startTime,
      pendingInputs,
      armedTxs,
      appConfig: config,
    }
  );

  // Create notification service
  const notificationService = new NotificationService(bot, chatId, eventBus, config);

  // ─── Connect Chain Adapters ──────────────────────────
  await Promise.allSettled(Array.from(adapters.entries()).map(async ([chainId, adapter]) => {
    try {
      await Promise.race([
        adapter.connect(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
      ]);
      log.info({ chain: chainId }, 'Chain adapter connected');
    } catch (err) {
      log.error({ err, chain: chainId }, 'Failed to connect chain adapter during startup');
    }
  }));

  // ─── Start Services ──────────────────────────────────
  strategyEngine.start();
  executor.startTimeoutChecker();
  notificationService.start();

  // Load and start watching trackers
  const trackers = getTrackers(db);
  for (const tracker of trackers) {
    const adapter = adapters.get(tracker.chain);
    if (adapter) {
      adapter.watchContract(tracker.contractAddress, (event) => {
        eventBus.emit('tracker:mint:detected', event);
      });
      log.info({ chain: tracker.chain, contract: tracker.contractAddress }, 'Started tracking contract');
    }
  }

  // Start API Server
  const apiServer = createApiServer({
    strategyEngine,
    walletManager,
    executor,
    adapters,
    startTime
  });
  
  const apiPort = config.server?.apiPort ?? 3001;
  const server = apiServer.listen(apiPort, () => {
    log.info({ port: apiPort }, 'API Server listening on localhost');
  });

  // Launch Telegram bot (non-blocking)
  bot.launch().catch((err) => {
    log.error({ err }, 'Telegram bot launch failed');
  });

  log.info('✅ NFT Mint Bot is running!');
  log.info({
    chains: enabledChains,
    wallets: walletManager.count,
    mode: config.strategy.mode,
  }, 'Bot configuration');

  // ─── Graceful Shutdown ───────────────────────────────
  const shutdown = async (signal: string) => {
    log.info({ signal }, 'Shutting down...');

    // Stop services
    strategyEngine.stop();
    executor.stop();
    notificationService.stop();
    bot.stop(signal);
    
    server.close(() => log.info('API server closed'));

    // Disconnect adapters
    for (const [chainId, adapter] of adapters) {
      try {
        await adapter.disconnect();
        log.info({ chain: chainId }, 'Adapter disconnected');
      } catch (err) {
        log.error({ err, chain: chainId }, 'Error disconnecting adapter');
      }
    }

    // Close database
    closeDatabase();

    log.info('Goodbye! 👋');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ─── Run ────────────────────────────────────────────────

main().catch((err) => {
  log.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});
