import express from 'express';
import cors from 'cors';
import { createLogger } from '../core/logger.js';
import type { StrategyEngine } from '../strategy/strategy-engine.js';
import type { WalletManager } from '../wallet/wallet-manager.js';
import type { Executor } from '../execution/executor.js';
import type { IChainAdapter, ChainId } from '../types/chains.js';

const log = createLogger('api');

export interface ApiDeps {
  strategyEngine: StrategyEngine;
  walletManager: WalletManager;
  executor: Executor;
  adapters: Map<ChainId, IChainAdapter>;
  startTime: number;
}

export function createApiServer(deps: ApiDeps) {
  const app = express();
  
  app.use(cors());
  app.use(express.json());

  app.get('/api/status', (req, res) => {
    const chains = Array.from(deps.adapters.entries()).map(([chain, adapter]) => ({
      chain,
      connected: adapter.isConnected()
    }));
    
    res.json({
      uptime: Date.now() - deps.startTime,
      chains,
      paused: deps.strategyEngine.isPaused()
    });
  });

  app.get('/api/wallets', (req, res) => {
    const wallets = deps.walletManager.getAllWallets();
    // Convert bigints to strings for JSON
    const serialized = wallets.map(w => {
      const balances: Record<string, string> = {};
      for (const [chain, bal] of w.balances.entries()) {
        balances[chain] = bal.toString();
      }
      return {
        ...w,
        balances
      };
    });
    res.json(serialized);
  });

  app.get('/api/strategy', (req, res) => {
    res.json({
      config: deps.strategyEngine.getConfig(),
      alphaWallets: deps.strategyEngine.getAlphaWallets(),
      watchlist: deps.strategyEngine.getWatchlist(),
      mintsThisHour: deps.strategyEngine.getMintsThisHour()
    });
  });

  app.post('/api/strategy/pause', (req, res) => {
    const { paused } = req.body;
    if (paused) {
      deps.strategyEngine.pause();
    } else {
      deps.strategyEngine.resume();
    }
    res.json({ success: true, paused: deps.strategyEngine.isPaused() });
  });

  app.post('/api/strategy/config', (req, res) => {
    deps.strategyEngine.updateConfig(req.body);
    res.json({ success: true, config: deps.strategyEngine.getConfig() });
  });

  // To be expanded with specific execution routes

  return app;
}
