import { createPublicClient, http, type PublicClient, type Chain } from 'viem';
import { createLogger } from '../core/logger.js';
import type { ArmedTransaction, ChainId, RouteConfig } from '../types/chains.js';

const log = createLogger('route-manager');

export class RouteManager {
  private customClients: Map<string, PublicClient> = new Map();

  /**
   * Initialize custom RPC clients for a specific chain.
   */
  private getClients(chain: Chain, endpoints: string[]): PublicClient[] {
    return endpoints.map((rpcUrl) => {
      let client = this.customClients.get(rpcUrl);
      if (!client) {
        client = createPublicClient({
          chain,
          transport: http(rpcUrl, {
            retryCount: 0,
            timeout: 5000,
          }),
        });
        this.customClients.set(rpcUrl, client);
      }
      return client;
    });
  }

  /**
   * Broadcast an armed transaction using the specified route strategy.
   * Returns the transaction hash if successfully accepted by at least one node.
   */
  async broadcast(
    armedTx: ArmedTransaction,
    viemChain: Chain,
    config: RouteConfig,
    defaultClient: PublicClient
  ): Promise<`0x${string}`> {
    log.info({ type: config.type, chain: armedTx.chain }, 'Broadcasting via route');

    switch (config.type) {
      case 'flashbots':
        return this.broadcastFlashbots(armedTx, viemChain, defaultClient);
      case 'fanout':
        if (!config.endpoints || config.endpoints.length === 0) {
          throw new Error('Fanout route requires an array of RPC endpoints');
        }
        return this.broadcastFanout(armedTx, viemChain, config.endpoints);
      case 'public':
      default:
        return this.broadcastPublic(armedTx, defaultClient);
    }
  }

  /**
   * Send to the default public RPC.
   */
  private async broadcastPublic(armedTx: ArmedTransaction, client: PublicClient): Promise<`0x${string}`> {
    const hash = await client.sendRawTransaction({
      serializedTransaction: armedTx.rawTransaction,
    });
    return hash;
  }

  /**
   * Send via Flashbots Protect RPC to prevent sandwich attacks.
   */
  private async broadcastFlashbots(armedTx: ArmedTransaction, chain: Chain, fallbackClient: PublicClient): Promise<`0x${string}`> {
    if (armedTx.chain !== 'ethereum') {
      log.warn('Flashbots only supported on Ethereum. Falling back to public mempool.');
      return this.broadcastPublic(armedTx, fallbackClient);
    }

    const flashbotsClient = this.getClients(chain, ['https://rpc.flashbots.net'])[0];
    if (!flashbotsClient) {
      throw new Error('Failed to initialize Flashbots client');
    }

    const hash = await flashbotsClient.sendRawTransaction({
      serializedTransaction: armedTx.rawTransaction,
    });
    log.info({ txHash: hash }, 'Sent via Flashbots Protect');
    return hash;
  }

  /**
   * Blast the raw transaction to multiple RPCs simultaneously for lowest latency propagation.
   */
  private async broadcastFanout(armedTx: ArmedTransaction, chain: Chain, endpoints: string[]): Promise<`0x${string}`> {
    const clients = this.getClients(chain, endpoints);
    
    // Fire to all clients in parallel, ignoring individual failures
    const promises = clients.map((client) =>
      client.sendRawTransaction({
        serializedTransaction: armedTx.rawTransaction,
      }).catch((err) => {
        log.warn({ url: client.transport?.url, err: err.message }, 'Fan-out endpoint failed');
        return null;
      })
    );

    const results = await Promise.all(promises);
    
    // Find the first successful hash returned
    const successfulHash = results.find((r) => r !== null);

    if (!successfulHash) {
      throw new Error('All fan-out endpoints failed to broadcast the transaction');
    }

    log.info({ txHash: successfulHash, successCount: results.filter(Boolean).length }, 'Fan-out broadcast complete');
    return successfulHash;
  }
}

export const routeManager = new RouteManager();
