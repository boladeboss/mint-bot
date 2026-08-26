import type { ChainId, IChainAdapter } from '../types/chains.js';
import type { WalletManager } from '../wallet/wallet-manager.js';
import { createLogger } from '../core/logger.js';
import { encodeFunctionData, parseAbi } from 'viem';

const log = createLogger('asset-manager');

const ERC721_ABI = parseAbi([
  'function transferFrom(address from, address to, uint256 tokenId) external'
]);

export class AssetManager {
  private adapters: Map<ChainId, IChainAdapter>;
  private walletManager: WalletManager;

  constructor(
    adapters: Map<ChainId, IChainAdapter>,
    walletManager: WalletManager
  ) {
    this.adapters = adapters;
    this.walletManager = walletManager;
  }

  /**
   * Transfer ETH from one wallet to another.
   */
  async transferEth(
    chain: ChainId,
    fromWalletIndex: number,
    destination: number | string,
    amountWei: bigint,
    customGas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }
  ): Promise<string> {
    const adapter = this.adapters.get(chain);
    if (!adapter || !adapter.isConnected()) throw new Error(`Adapter not connected for ${chain}`);

    const fromPk = this.walletManager.getPrivateKey(fromWalletIndex);
    if (!fromPk) throw new Error('Invalid source wallet specified');

    let toAddress: string;
    if (typeof destination === 'number') {
      const toWallet = this.walletManager.getWallet(destination);
      if (!toWallet) throw new Error('Invalid destination wallet specified');
      toAddress = toWallet.info.address;
    } else {
      toAddress = destination;
    }

    log.info({ chain, from: fromWalletIndex, to: destination, amount: amountWei.toString() }, 'Executing ETH transfer');

    const txHash = await adapter.sendGenericTransaction({
      to: toAddress,
      value: amountWei,
      data: '0x',
      customGas
    }, fromPk);

    return txHash;
  }

  /**
   * Disperse ETH from one wallet to multiple wallets.
   */
  async disperseEth(
    chain: ChainId,
    fromWalletIndex: number,
    destinations: (number | string)[],
    amountWeiPerWallet: bigint,
    customGas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }
  ): Promise<string[]> {
    const txHashes: string[] = [];
    for (const to of destinations) {
      const hash = await this.transferEth(chain, fromWalletIndex, to, amountWeiPerWallet, customGas);
      txHashes.push(hash);
    }
    return txHashes;
  }

  /**
   * Consolidate ETH from multiple wallets to one destination.
   */
  async consolidateEth(
    chain: ChainId,
    fromWalletIndices: number[],
    destination: number | string,
    amountWeiPerWallet: bigint,
    customGas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }
  ): Promise<string[]> {
    const txHashes: string[] = [];
    for (const fromIndex of fromWalletIndices) {
      // Don't send to self if destination is the same wallet
      if (typeof destination === 'number' && destination === fromIndex) continue;
      
      try {
        const hash = await this.transferEth(chain, fromIndex, destination, amountWeiPerWallet, customGas);
        txHashes.push(hash);
      } catch (err: any) {
        log.error({ err, chain, fromIndex }, 'Failed to consolidate ETH from wallet');
      }
    }
    return txHashes;
  }

  /**
   * Sweep NFTs from multiple wallets to one destination.
   */
  async sweepNfts(
    chain: ChainId,
    fromWalletIndices: number[],
    destination: number | string,
    contractAddress: string,
    reservoirService: any, // passed in dynamically or imported
    customGas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }
  ): Promise<string[]> {
    const txHashes: string[] = [];
    
    for (const fromIndex of fromWalletIndices) {
      if (typeof destination === 'number' && destination === fromIndex) continue;

      const wallet = this.walletManager.getWallet(fromIndex);
      if (!wallet) continue;

      try {
        const tokens = await reservoirService.getUserTokens(chain, wallet.info.address);
        // Filter by contract
        const matchingTokens = tokens.filter((t: any) => t.token.contract.toLowerCase() === contractAddress.toLowerCase());
        
        for (const t of matchingTokens) {
          const hash = await this.transferNft(chain, contractAddress, t.token.tokenId, fromIndex, destination, customGas);
          txHashes.push(hash);
        }
      } catch (err: any) {
        log.error({ err, chain, fromIndex, contractAddress }, 'Failed to sweep NFTs from wallet');
      }
    }
    
    return txHashes;
  }

  /**
   * Transfer an NFT from one wallet to another.
   */
  async transferNft(
    chain: ChainId,
    contractAddress: string,
    tokenId: string,
    fromWalletIndex: number,
    destination: number | string,
    customGas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }
  ): Promise<string> {
    const adapter = this.adapters.get(chain);
    if (!adapter || !adapter.isConnected()) throw new Error(`Adapter not connected for ${chain}`);

    const fromPk = this.walletManager.getPrivateKey(fromWalletIndex);
    const fromWallet = this.walletManager.getWallet(fromWalletIndex);
    if (!fromPk || !fromWallet) throw new Error('Invalid source wallet specified');

    let toAddress: string;
    if (typeof destination === 'number') {
      const toWallet = this.walletManager.getWallet(destination);
      if (!toWallet) throw new Error('Invalid destination wallet specified');
      toAddress = toWallet.info.address;
    } else {
      toAddress = destination;
    }

    log.info({ chain, contract: contractAddress, token: tokenId, from: fromWalletIndex, to: destination }, 'Executing NFT transfer');

    const data = encodeFunctionData({
      abi: ERC721_ABI,
      functionName: 'transferFrom',
      args: [fromWallet.info.address as `0x${string}`, toAddress as `0x${string}`, BigInt(tokenId)],
    });

    const txHash = await adapter.sendGenericTransaction({
      to: contractAddress,
      value: 0n,
      data,
      customGas
    }, fromPk);

    return txHash;
  }
}
