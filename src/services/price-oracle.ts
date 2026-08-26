import { EventEmitter } from 'events';

export type TokenId = 'ethereum' | 'base' | 'arbitrum' | 'optimism' | 'binancecoin' | 'avalanche-2' | 'solana' | 'matic-network';

export class PriceOracle extends EventEmitter {
  private prices: Map<TokenId, number> = new Map();
  private isPolling = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private tokenIds: TokenId[] = ['ethereum', 'binancecoin', 'avalanche-2', 'solana', 'matic-network'];

  constructor() {
    super();
  }

  public async start() {
    if (this.isPolling) return;
    this.isPolling = true;
    
    // Fetch immediately
    await this.fetchPrices();

    // Poll every 60 seconds
    this.pollInterval = setInterval(() => {
      this.fetchPrices();
    }, 60000);
  }

  public stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
  }

  public getPrice(token: TokenId): number {
    return this.prices.get(token) ?? 0;
  }

  private async fetchPrices() {
    try {
      const ids = this.tokenIds.join('%2C');
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
      const response = await fetch(url);
      
      if (!response.ok) {
        console.error('Failed to fetch prices from CoinGecko:', response.statusText);
        return;
      }

      const data = await response.json();
      
      for (const token of this.tokenIds) {
        if (data[token] && data[token].usd) {
          this.prices.set(token, data[token].usd);
        }
      }
      this.emit('pricesUpdated');
    } catch (e) {
      console.error('Error fetching prices:', e);
    }
  }
}

export const priceOracle = new PriceOracle();
