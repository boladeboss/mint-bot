/**
 * Safety filters — runs before every mint to protect against overspend and rug pulls.
 */

import type { StrategyConfig, FilterResult } from '../types/strategy.js';
import { WEI_PER_ETH } from '../core/constants.js';

/**
 * Convert ETH (as a number) to wei (bigint).
 */
function ethToWei(eth: number): bigint {
  // Multiply by 1e18 using integer math to avoid floating point issues
  return BigInt(Math.floor(eth * 1e9)) * 1_000_000_000n;
}

/** Check if mint price is within configured maximum */
export function checkMaxPrice(price: bigint, maxPriceEth: number): FilterResult {
  const maxWei = ethToWei(maxPriceEth);
  if (price > maxWei) {
    return {
      pass: false,
      reason: `Mint price ${price} wei exceeds max ${maxWei} wei (${maxPriceEth} ETH)`,
    };
  }
  return { pass: true };
}

/** Check if estimated gas cost is within configured maximum */
export function checkMaxGas(estimatedGas: bigint, maxGasEth: number): FilterResult {
  const maxWei = ethToWei(maxGasEth);
  if (estimatedGas > maxWei) {
    return {
      pass: false,
      reason: `Gas estimate ${estimatedGas} wei exceeds max ${maxWei} wei (${maxGasEth} ETH)`,
    };
  }
  return { pass: true };
}

/** Check if wallet has sufficient balance for price + gas */
export function checkBalance(balance: bigint, price: bigint, estimatedGas: bigint): FilterResult {
  const totalCost = price + estimatedGas;
  if (balance < totalCost) {
    return {
      pass: false,
      reason: `Insufficient balance: ${balance} wei < ${totalCost} wei (price + gas)`,
    };
  }
  return { pass: true };
}

/** Check if enough time has passed since last mint */
export function checkCooldown(lastMintTime: number, cooldownSeconds: number): FilterResult {
  const elapsed = (Date.now() - lastMintTime) / 1000;
  if (elapsed < cooldownSeconds) {
    return {
      pass: false,
      reason: `Cooldown active: ${Math.ceil(cooldownSeconds - elapsed)}s remaining`,
    };
  }
  return { pass: true };
}

/** Check if hourly mint limit has been reached */
export function checkHourlyLimit(mintsThisHour: number, maxPerHour: number): FilterResult {
  if (mintsThisHour >= maxPerHour) {
    return {
      pass: false,
      reason: `Hourly limit reached: ${mintsThisHour}/${maxPerHour} mints`,
    };
  }
  return { pass: true };
}

/** Run all safety filters — returns first failure or { pass: true } */
export function runAllFilters(params: {
  price: bigint;
  estimatedGas: bigint;
  balance: bigint;
  lastMintTime: number;
  mintsThisHour: number;
  config: StrategyConfig;
}): FilterResult {
  const checks: FilterResult[] = [
    checkMaxPrice(params.price, params.config.maxMintPriceEth),
    checkMaxGas(params.estimatedGas, params.config.maxGasEth),
    checkBalance(params.balance, params.price, params.estimatedGas),
    checkCooldown(params.lastMintTime, params.config.cooldownSeconds),
    checkHourlyLimit(params.mintsThisHour, params.config.maxMintsPerHour),
  ];

  const failed = checks.find((c) => !c.pass);
  return failed ?? { pass: true };
}
