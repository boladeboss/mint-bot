/**
 * Global constants — chain metadata, derivation paths, known selectors.
 */

import type { ChainId } from '../types/chains.js';

export const DERIVATION_PATHS = {
  ethereum: "m/44'/60'/0'/0",
} as const;
/** Common NFT mint function 4-byte selectors */
export const MINT_SELECTORS: Record<string, string> = {
  '0x1249c58b': 'mint()',
  '0xa0712d68': 'mint(uint256)',
  '0x40c10f19': 'mint(address,uint256)',
  '0x6a627842': 'mint(address)',
  '0xa945bf80': 'publicMint()',
  '0x2db11544': 'publicSaleMint(uint256)',
  '0x84bb1e42': 'mintPublic(uint256)',
  '0xa723533e': 'mintNFT(uint256)',
  '0xd85d3d27': 'mintPublic(string)',
  '0x14f710fe': 'freeMint()',
} as const;



export const CHAIN_NAMES: Record<ChainId, string> = {
  ethereum: 'Ethereum',
  base: 'Base',
  polygon: 'Polygon',
  arbitrum: 'Arbitrum',
  optimism: 'Optimism',
  avalanche: 'Avalanche',
  bsc: 'BNB Chain',
  
  robinhood: 'Robinhood',
} as const;

export const EXPLORER_TX_PATH: Record<ChainId, string> = {
  ethereum: '/tx/',
  base: '/tx/',
  polygon: '/tx/',
  arbitrum: '/tx/',
  optimism: '/tx/',
  avalanche: '/tx/',
  bsc: '/tx/',
  
  robinhood: '/tx/',
} as const;

export const CHAIN_EMOJI: Record<ChainId, string> = {
  ethereum: '⟠',
  base: '🔵',
  polygon: '🟪',
  arbitrum: '💙',
  optimism: '🔴',
  avalanche: '🔺',
  bsc: '🟡',
  
  robinhood: '🏹',
} as const;

/** Gas unit conversions */
export const GWEI = 1_000_000_000n;
export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const WEI_PER_ETH = 1_000_000_000_000_000_000n;

/** Decimal places */
export const ETH_DECIMALS = 18;
export const SOL_DECIMALS = 9;

/** Default gas limit for EVM mint transactions */
export const DEFAULT_GAS_LIMIT = 300_000n;

/** Reconnection settings */
export const MAX_RECONNECT_ATTEMPTS = 10;
export const BASE_RECONNECT_DELAY_MS = 1000;
export const MAX_RECONNECT_DELAY_MS = 30_000;
