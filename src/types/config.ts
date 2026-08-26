/**
 * Application configuration — maps the YAML config file shape.
 * Also provides a loader that substitutes environment variables.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import 'dotenv/config';

import type { EvmChainConfig } from './chains.js';
import type { StrategyConfig } from './strategy.js';
import type { WalletSelection } from './wallet.js';

/** Full application configuration shape */
export interface AppConfig {
  chains: {
    ethereum: EvmChainConfig;
    base: EvmChainConfig;
    polygon: EvmChainConfig;
    arbitrum: EvmChainConfig;
    optimism: EvmChainConfig;
    avalanche: EvmChainConfig;
    bsc?: EvmChainConfig;
    zora?: EvmChainConfig;
    robinhood?: EvmChainConfig;
  };
  strategy: StrategyConfig;
  wallets: {
    count: number;
    selection: WalletSelection;
  };
  notifications: {
    hourlyDigest: boolean;
    lowBalanceThresholdEth: number;
  };
  server: {
    apiPort: number;
  };
}

/**
 * Substitute `${ENV_VAR}` placeholders in a string with process.env values.
 */
function substituteEnvVars(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_match, varName: string) => {
    return process.env[varName] ?? '';
  });
}

/**
 * Recursively walk an object and substitute env vars in all string values.
 */
function substituteEnvVarsDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return substituteEnvVars(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(substituteEnvVarsDeep);
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = substituteEnvVarsDeep(value);
    }
    return result;
  }
  return obj;
}

/**
 * Load and parse the YAML configuration file.
 * Substitutes `${ENV_VAR}` placeholders with values from process.env.
 */
export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = configPath ?? path.resolve(process.cwd(), 'config', 'default.yaml');
  const rawYaml = fs.readFileSync(resolvedPath, 'utf-8');
  const parsed = parseYaml(rawYaml) as Record<string, unknown>;
  const substituted = substituteEnvVarsDeep(parsed) as AppConfig;
  return substituted;
}
