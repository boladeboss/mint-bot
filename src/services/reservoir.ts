import type { ChainId } from '../types/chains.js';

const RESERVOIR_BASE_URLS: Record<ChainId, string> = {
  ethereum: 'https://api.reservoir.tools',
  base: 'https://api-base.reservoir.tools',
  arbitrum: 'https://api-arbitrum.reservoir.tools',
  polygon: 'https://api-polygon.reservoir.tools',
  optimism: 'https://api-optimism.reservoir.tools',
  
  bsc: 'https://api-bsc.reservoir.tools',
  avalanche: 'https://api-avalanche.reservoir.tools',
  robinhood: 'https://api.reservoir.tools', // Dummy fallback
};

export interface ReservoirCollection {
  id: string;
  name: string;
  image?: string;
  description?: string;
  tokenCount: string;
  onSaleCount: string;
  floorAsk?: {
    price?: {
      amount?: {
        decimal?: number;
      };
      currency?: {
        symbol?: string;
      };
    };
  };
  topBid?: {
    price?: {
      amount?: {
        decimal?: number;
      };
      currency?: {
        symbol?: string;
      };
    };
  };
}

export interface ReservoirToken {
  token: {
    contract: string;
    tokenId: string;
    name?: string;
    image?: string;
    collection?: {
      name?: string;
    };
  };
  ownership: {
    tokenCount: string;
  };
}

export class ReservoirService {
  private getBaseUrl(chain: ChainId): string {
    const url = RESERVOIR_BASE_URLS[chain];
    if (!url) throw new Error(`Reservoir not supported on ${chain}`);
    return url;
  }

  async getCollection(chain: ChainId, address: string): Promise<ReservoirCollection | null> {
    try {
      const url = `${this.getBaseUrl(chain)}/collections/v7?id=${address}`;
      const res = await fetch(url, { headers: { 'accept': '*/*' }});
      if (!res.ok) return null;
      
      const data = (await res.json()) as any;
      return data.collections?.[0] || null;
    } catch (e) {
      return null;
    }
  }

  async getUserTokens(chain: ChainId, address: string): Promise<ReservoirToken[]> {
    try {
      const url = `${this.getBaseUrl(chain)}/users/${address}/tokens/v7?limit=20`;
      const res = await fetch(url, { headers: { 'accept': '*/*' }});
      if (!res.ok) return [];
      
      const data = (await res.json()) as any;
      return data.tokens || [];
    } catch (e) {
      return [];
    }
  }

  async getBuyTx(chain: ChainId, collection: string, taker: string): Promise<any> {
    const url = `${this.getBaseUrl(chain)}/execute/buy/v7`;
    const body = {
      items: [{ collection }],
      taker,
      source: 'mint-bot',
      skipBalanceCheck: true
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to generate buy tx: ${errorText}`);
    }

    return await res.json();
  }

  async getSellTx(chain: ChainId, token: string, taker: string): Promise<any> {
    // token format: contractAddress:tokenId
    const url = `${this.getBaseUrl(chain)}/execute/sell/v7`;
    const body = {
      items: [{ token }],
      taker,
      source: 'mint-bot'
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to generate sell tx: ${errorText}`);
    }

    return await res.json();
  }
}

export const reservoirService = new ReservoirService();
