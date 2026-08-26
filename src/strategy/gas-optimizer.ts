/**
 * Gas optimization — dynamic fee calculation for EVM and Solana chains.
 */

import type { EvmGasConfig, GasAggression } from '../types/chains.js';
import { GWEI } from '../core/constants.js';

/** Aggression multipliers for gas bidding */
const AGGRESSION_MULTIPLIERS: Record<GasAggression, number> = {
  conservative: 1,
  normal: 1.5,
  aggressive: 3,
  max: 10,
};

export class GasOptimizer {
  /** Get the numeric multiplier for an aggression level */
  getAggressionMultiplier(aggression: GasAggression): number {
    return AGGRESSION_MULTIPLIERS[aggression];
  }

  /**
   * Calculate EIP-1559 gas parameters for EVM chains.
   * @param config - Gas config from chain settings
   * @param currentBaseFee - Current base fee in wei
   */
  getEvmGasParams(
    config: EvmGasConfig,
    currentBaseFee: bigint
  ): { maxFeePerGas: bigint; maxPriorityFeePerGas: bigint } {
    if (config.mode === 'custom' && config.customBaseFeeGwei !== undefined && config.customPriorityFeeGwei !== undefined) {
      const customBase = BigInt(Math.floor(config.customBaseFeeGwei * Number(GWEI)));
      const customPrio = BigInt(Math.floor(config.customPriorityFeeGwei * Number(GWEI)));
      return {
        maxFeePerGas: customBase + customPrio,
        maxPriorityFeePerGas: customPrio,
      };
    }

    const multiplier = this.getAggressionMultiplier(config.aggression);

    // Apply aggression to priority fee
    const basePriorityFee = BigInt(config.maxPriorityFeeGwei) * GWEI;
    const adjustedPriorityFee = BigInt(Math.ceil(Number(basePriorityFee) * multiplier));

    // maxFeePerGas = (multiplier * baseFee) + priorityFee
    const feeMultiplierScaled = BigInt(Math.ceil(config.maxFeeMultiplier * 100));
    const adjustedBaseFee = (currentBaseFee * feeMultiplierScaled) / 100n;
    const maxFeePerGas = adjustedBaseFee + adjustedPriorityFee;

    return {
      maxFeePerGas,
      maxPriorityFeePerGas: adjustedPriorityFee,
    };
  }


}

/** Global singleton gas optimizer */
export const gasOptimizer = new GasOptimizer();
