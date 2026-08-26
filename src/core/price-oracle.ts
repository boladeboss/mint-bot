import type { ChainId } from '../types/chains.js';

// Cache to avoid spamming the API
const priceCache = new Map<string, { price: number; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/** Get the Coingecko ID for the native token of a chain */
function getCoinIdForChain(chain: ChainId): string {
  switch (chain) {
    case 'ethereum':
    case 'base':
    case 'arbitrum':
    case 'optimism':
      return 'ethereum';
    case 'polygon':
      return 'matic-network';
    case 'avalanche':
      return 'avalanche-2';
    case 'bsc':
      return 'binancecoin';
    default:
      return 'ethereum';
  }
}

/** Get the symbol for a chain's native token */
export function getNativeSymbol(chain: ChainId): string {
  switch (chain) {
    case 'polygon': return 'MATIC';
    case 'avalanche': return 'AVAX';
    case 'bsc': return 'BNB';
    default: return 'ETH';
  }
}

/** Fetch USD price for a chain's native token */
export async function getNativePriceUsd(chain: ChainId): Promise<number> {
  const coinId = getCoinIdForChain(chain);
  
  const cached = priceCache.get(coinId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.price;
  }
  
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`);
    if (!res.ok) throw new Error('API failed');
    const data = await res.json() as any;
    const price = data[coinId]?.usd ?? 0;
    
    if (price > 0) {
      priceCache.set(coinId, { price, timestamp: Date.now() });
    }
    return price;
  } catch (err) {
    // If API fails, return last cached price or 0
    return cached?.price ?? 0;
  }
}
