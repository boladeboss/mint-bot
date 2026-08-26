/**
 * Shared EVM adapter logic for Ethereum and Base chains.
 * Uses viem for WebSocket connection, mempool monitoring, and transaction execution.
 */

import {
  createPublicClient,
  createWalletClient,
  webSocket,
  parseEther,
  formatEther,
  type PublicClient,
  type WalletClient,
  type Chain,
  type Transport,
  type WatchPendingTransactionsReturnType,
  type WatchContractEventReturnType,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BaseChainAdapter } from './base-adapter.js';
import { gasOptimizer } from '../strategy/gas-optimizer.js';
import { MINT_SELECTORS, DEFAULT_GAS_LIMIT } from '../core/constants.js';
import type { EventBus } from '../core/event-bus.js';
import type { ChainId, EvmChainConfig, MintTransaction, ArmedTransaction, RouteConfig } from '../types/chains.js';
import type { MintOpportunity, MintResult } from '../types/events.js';
import { routeManager } from '../execution/route-manager.js';

/** ERC-721 Transfer event signature */
const TRANSFER_EVENT_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const COMMON_GETTERS_ABI = [
  { inputs: [], name: 'name', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'price', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'cost', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mintPrice', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'maxPerWallet', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MAX_PER_WALLET', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'maxMintAmount', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'saleIsActive', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isSaleActive', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isPublicSaleActive', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mintingActive', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'publicSaleActive', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'presaleActive', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isPresaleActive', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'allowlistMintActive', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'whitelistMintActive', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'phase', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'step', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'MAX_SUPPLY', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'maxSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'maxPerTx', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'maxMintAmountPerTx', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'publicSale', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'preSale', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isOpen', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'paused', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'status', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'mintState', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'saleState', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
] as const;

export abstract class EvmAdapterBase extends BaseChainAdapter {
  public readonly config: EvmChainConfig;
  protected abstract viemChain: Chain;
  protected client?: PublicClient;
  protected pendingWatcher?: WatchPendingTransactionsReturnType;
  protected contractWatchers: WatchContractEventReturnType[] = [];

  constructor(config: EvmChainConfig, eventBus: EventBus, componentName: string) {
    super(eventBus, componentName);
    this.config = config;
  }

  protected async doConnect(): Promise<void> {
    const isHttp = this.config.rpcWs.startsWith('http');
    
    // Dynamically import http to avoid breaking existing imports if possible, or we can just import it at the top.
    // Wait, let's just use dynamic import for http if it's not imported.
    const viem = await import('viem');
    
    const transport = isHttp 
      ? viem.http(this.config.rpcWs)
      : viem.webSocket(this.config.rpcWs, {
          keepAlive: true,
          reconnect: {
            attempts: 5,
            delay: 2000,
          },
        });

    this.client = createPublicClient({
      chain: this.viemChain,
      transport,
    });

    // Verify connection by fetching chain ID
    const chainId = await this.client.getChainId();
    this.log.info({ chainId }, 'WebSocket connected');
  }

  protected async doDisconnect(): Promise<void> {
    // Cleanup watchers
    if (this.pendingWatcher) {
      this.pendingWatcher();
      this.pendingWatcher = undefined;
    }
    for (const unwatch of this.contractWatchers) {
      unwatch();
    }
    this.contractWatchers = [];
    this.contractWatchers = [];
    this.client = undefined;
  }

  /**
   * Disconnects and reconnects with a new RPC URL.
   */
  async reconnect(newRpcWs: string): Promise<void> {
    this.log.info({ old: this.config.rpcWs, new: newRpcWs }, 'Reconnecting adapter with new RPC');
    await this.disconnect();
    this.config.rpcWs = newRpcWs;
    await this.connect();
  }

  /**
   * Start a global mempool watcher for the chain.
   * Emits alpha:tx:detected if the tx is from an alpha wallet.
   * NOTE: This is extremely RPC intensive!
   */
  startMempoolWatcher(alphaWallets: string[]): void {
    if (!this.client) {
      this.log.warn('Cannot start mempool watcher — not connected');
      return;
    }

    if (this.pendingWatcher) {
      // Already running, just update the logic in the closure? 
      // The pendingWatcher only gives hashes. We'll add this logic to the existing onNewContract watcher to save RPC calls.
      return;
    }
  }

  /**
   * Monitor mempool for new contract deployments (to: null).
   */
  onNewContract(cb: (event: MintOpportunity) => void): void {
    if (!this.client) {
      this.log.warn('Cannot watch — not connected');
      return;
    }

    this.pendingWatcher = this.client.watchPendingTransactions({
      onTransactions: async (hashes) => {
        for (const hash of hashes) {
          try {
            const tx = await this.client!.getTransaction({ hash });

            // 1. Contract deployment: to is null
            if (tx.to === null || tx.to === undefined) {
              const inputHex = tx.input?.slice(0, 10) ?? '';

              this.log.info(
                { txHash: hash, from: tx.from },
                'New contract deployment detected'
              );

              cb({
                chain: this.chain,
                contractAddress: hash, // Will be replaced with actual address on confirmation
                mintFunction: 'deploy',
                price: tx.value ?? 0n,
                estimatedGas: DEFAULT_GAS_LIMIT,
                detectedAt: Date.now(),
              });
            } else {
              // 2. Alpha wallet monitoring
              // Let StrategyEngine filter it based on its current alphaWallets list
              this.eventBus.emit('alpha:tx:detected', { chain: this.chain, tx });
            }
          } catch {
            // Transaction might not be available yet — skip
          }
        }
      },
      // Optional pollingInterval depending on viem transport
    });

    this.log.info('Watching for new contract deployments');
  }

  /**
   * Watch a specific contract for NFT mint activity (ERC-721 Transfer from 0x0).
   */
  watchContract(address: string, cb: (event: MintOpportunity) => void): void {
    if (!this.client) {
      this.log.warn('Cannot watch contract — not connected');
      return;
    }

    const unwatch = this.client.watchEvent({
      address: address as `0x${string}`,
      event: {
        type: 'event',
        name: 'Transfer',
        inputs: [
          { type: 'address', name: 'from', indexed: true },
          { type: 'address', name: 'to', indexed: true },
          { type: 'uint256', name: 'tokenId', indexed: true },
        ],
      },
      onLogs: (logs) => {
        for (const log of logs) {
          // Check if this is a mint (Transfer from zero address)
          const fromAddr = log.args?.from as string | undefined;
          if (
            fromAddr &&
            fromAddr.toLowerCase() === '0x0000000000000000000000000000000000000000'
          ) {
            cb({
              chain: this.chain,
              contractAddress: address,
              mintFunction: 'mint()',
              price: 0n, // Would need to check the transaction value
              estimatedGas: DEFAULT_GAS_LIMIT,
              detectedAt: Date.now(),
              metadata: {
                totalSupply: Number(log.args?.tokenId ?? 0),
              },
            });
          }
        }
      },
    });

    this.contractWatchers.push(unwatch);
    this.log.info({ address }, 'Watching contract for mint events');
  }

  /** Estimate gas for a mint transaction */
  async estimateGas(tx: MintTransaction): Promise<bigint> {
    if (!this.client) throw new Error('Not connected');

    try {
      const estimate = await this.client.estimateGas({
        to: tx.contractAddress as `0x${string}`,
        value: tx.value,
        data: tx.mintFunction as `0x${string}`,
      });
      // Add 20% buffer
      return (estimate * 120n) / 100n;
    } catch (e) {
      this.log.warn({ err: e }, 'Gas estimation failed, using default');
      return DEFAULT_GAS_LIMIT;
    }
  }

  /** Pre-build and sign a transaction without broadcasting it */
  async armTransaction(tx: MintTransaction, privateKey: `0x${string}`): Promise<ArmedTransaction> {
    if (!this.client) throw new Error('Not connected');

    const account = privateKeyToAccount(privateKey);
    
    // --- PREFLIGHT SIMULATION ---
    try {
      this.log.debug({ to: tx.contractAddress, account: account.address }, 'Running preflight simulation');
      await this.client.call({
        account: account.address,
        to: tx.contractAddress as `0x${string}`,
        value: tx.value,
        data: tx.mintFunction as `0x${string}`,
      });
    } catch (err: any) {
      this.log.warn({ err: err.message, to: tx.contractAddress }, 'Preflight simulation failed (revert)');
      throw new Error(`Preflight Simulation Failed: ${err.shortMessage || err.message}`);
    }

    const walletClient = createWalletClient({
      account,
      chain: this.viemChain,
      transport: webSocket(this.config.rpcWs),
    });

    const block = await this.client.getBlock();
    const baseFee = block.baseFeePerGas ?? 0n;
    const gasParams = gasOptimizer.getEvmGasParams(this.config.gas, baseFee);
    const gasLimit = tx.gasLimit ?? DEFAULT_GAS_LIMIT;

    const request = await walletClient.prepareTransactionRequest({
      to: tx.contractAddress as `0x${string}`,
      value: tx.value,
      data: tx.mintFunction as `0x${string}`,
      gas: gasLimit,
      maxFeePerGas: gasParams.maxFeePerGas,
      maxPriorityFeePerGas: gasParams.maxPriorityFeePerGas,
    });

    const signature = await walletClient.signTransaction(request as any);
    const estimatedGasCost = gasLimit * gasParams.maxFeePerGas;

    this.log.info({ to: tx.contractAddress, account: account.address, nonce: request.nonce }, 'Armed transaction');

    return {
      chain: this.chain,
      contractAddress: tx.contractAddress,
      walletAddress: account.address,
      rawTransaction: signature,
      estimatedGasCost,
      nonce: request.nonce as number,
    };
  }

  /** Broadcast a pre-signed raw transaction immediately */
  async sendRawTransaction(armedTx: ArmedTransaction, route: RouteConfig = { type: 'public' }): Promise<MintResult> {
    if (!this.client) throw new Error('Not connected');

    this.log.info({ wallet: armedTx.walletAddress, to: armedTx.contractAddress, route: route.type }, 'Firing armed transaction');
    
    // Broadcast using the RouteManager (Flashbots, Fan-out, or Public fallback)
    const hash = await routeManager.broadcast(armedTx, this.viemChain, route, this.client);

    // Wait for confirmation
    const receipt = await this.client.waitForTransactionReceipt({ hash });
    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;

    this.log.info({ txHash: hash, gasUsed: receipt.gasUsed.toString(), status: receipt.status }, 'Transaction confirmed');

    return {
      chain: this.chain,
      txHash: hash,
      contractAddress: armedTx.contractAddress,
      gasCost,
      walletAddress: armedTx.walletAddress,
      confirmedAt: Date.now(),
    };
  }

  /** Execute a mint transaction */
  async sendMint(tx: MintTransaction, privateKey: `0x${string}`): Promise<MintResult> {
    if (!this.client) throw new Error('Not connected');

    const account = privateKeyToAccount(privateKey);

    const walletClient = createWalletClient({
      account,
      chain: this.viemChain,
      transport: webSocket(this.config.rpcWs),
    });

    // Get current base fee for gas calculation
    const block = await this.client.getBlock();
    const baseFee = block.baseFeePerGas ?? 0n;
    
    // Determine gas parameters
    let maxFeePerGas: bigint;
    let maxPriorityFeePerGas: bigint;
    
    if (tx.customGas) {
      // Use user-provided custom gas values
      maxPriorityFeePerGas = tx.customGas.maxPriorityFeePerGas ?? gasOptimizer.getEvmGasParams(this.config.gas, baseFee).maxPriorityFeePerGas;
      
      if (tx.customGas.maxFeePerGas) {
        maxFeePerGas = tx.customGas.maxFeePerGas;
      } else {
        // Auto-calculate base fee if not provided, just add the custom priority fee to current base fee * 1.5
        maxFeePerGas = (baseFee * 150n / 100n) + maxPriorityFeePerGas;
      }
    } else {
      // Use default strategy
      const gasParams = gasOptimizer.getEvmGasParams(this.config.gas, baseFee);
      maxFeePerGas = gasParams.maxFeePerGas;
      maxPriorityFeePerGas = gasParams.maxPriorityFeePerGas;
    }

    const gasLimit = tx.gasLimit ?? DEFAULT_GAS_LIMIT;

    this.log.info(
      {
        to: tx.contractAddress,
        value: tx.value.toString(),
        maxFeePerGas: maxFeePerGas.toString(),
      },
      'Sending mint transaction'
    );

    const hash = await walletClient.sendTransaction({
      to: tx.contractAddress as `0x${string}`,
      value: tx.value,
      data: tx.mintFunction as `0x${string}`,
      gas: gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    // Wait for confirmation
    const receipt = await this.client.waitForTransactionReceipt({ hash });

    const gasCost = receipt.gasUsed * receipt.effectiveGasPrice;

    this.log.info(
      { txHash: hash, gasUsed: receipt.gasUsed.toString(), status: receipt.status },
      'Transaction confirmed'
    );

    return {
      chain: this.chain,
      txHash: hash,
      contractAddress: tx.contractAddress,
      gasCost,
      walletAddress: account.address,
      confirmedAt: Date.now(),
    };
  }

  /** Get native balance of an address */
  async getBalance(address: string): Promise<bigint> {
    if (!this.client) throw new Error('Not connected');
    return this.client!.getBalance({ address: address as `0x${string}` });
  }

  getPublicClient(): import('viem').PublicClient {
    if (!this.client) throw new Error('Not connected');
    return this.client!;
  }

  /** Get an ERC20 token balance */
  async getTokenBalance(address: string, tokenAddress: string): Promise<bigint> {
    if (!this.client) throw new Error('Not connected');
    const abi = [{ "name": "balanceOf", "type": "function", "inputs": [{"name": "_owner", "type": "address"}], "outputs": [{"name": "balance", "type": "uint256"}], "stateMutability": "view" }];
    const balance = await this.client.readContract({
      address: tokenAddress as `0x${string}`,
      abi,
      functionName: 'balanceOf',
      args: [address as `0x${string}`]
    });
    return balance as bigint;
  }

  /** Get current gas price in wei */
  async getGasPrice(): Promise<bigint> {
    if (!this.client) throw new Error('Not connected');
    return await this.client.getGasPrice();
  }

  /** Get fee data for gas tracker (base fee and priority fee) */
  async getFeeData(): Promise<{ baseFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }> {
    if (!this.client) throw new Error('Not connected');
    try {
      const fees = await this.client.estimateFeesPerGas();
      // estimateFeesPerGas can return maxFeePerGas and maxPriorityFeePerGas for EIP-1559
      // but to get the exact base fee, we might need a block header, or we can infer it
      // baseFee = maxFeePerGas - maxPriorityFeePerGas (roughly, assuming multiplier is 1 for estimate)
      // Actually, viem has `getBlock` which gives baseFeePerGas directly.
      const block = await this.client.getBlock({ blockTag: 'latest' });
      return {
        baseFeePerGas: block.baseFeePerGas ?? undefined,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas ?? undefined
      };
    } catch (err) {
      return {};
    }
  }

  async getContractInfo(address: string, isRetry = false): Promise<import('../types/chains.js').ContractInfo | null> {
    if (!this.client) return null;
    try {
      const bytecode = await this.client.getBytecode({ address: address as `0x${string}` });
      if (!bytecode || bytecode === '0x') {
        return { isValid: false };
      }

      const info: import('../types/chains.js').ContractInfo = { isValid: true };
      const contract = { address: address as `0x${string}`, abi: COMMON_GETTERS_ABI };

      // Helper to safely read a contract view function
      const tryRead = async (functionName: string) => {
        try {
          return await this.client!.readContract({ ...contract, functionName } as any);
        } catch {
          return undefined;
        }
      };

      // Run variable reads concurrently to massively speed up RPC requests
      const [
        name, symbol, priceResult, maxWalletResult, presaleResult, publicSaleResult, isPaused, phaseResult, maxTxResult, totalSupplyResult, maxSupplyResult
      ] = await Promise.all([
        tryRead('name'),
        tryRead('symbol'),
        tryRead('price').then(r => r !== undefined ? r : tryRead('cost')).then(r => r !== undefined ? r : tryRead('mintPrice')),
        tryRead('maxPerWallet').then(r => r !== undefined ? r : tryRead('MAX_PER_WALLET')).then(r => r !== undefined ? r : tryRead('maxMintAmount')),
        tryRead('presaleActive').then(r => r !== undefined ? r : tryRead('isPresaleActive')).then(r => r !== undefined ? r : tryRead('allowlistMintActive')).then(r => r !== undefined ? r : tryRead('whitelistMintActive')).then(r => r !== undefined ? r : tryRead('preSale')),
        tryRead('saleIsActive').then(r => r !== undefined ? r : tryRead('isSaleActive')).then(r => r !== undefined ? r : tryRead('isPublicSaleActive')).then(r => r !== undefined ? r : tryRead('mintingActive')).then(r => r !== undefined ? r : tryRead('publicSaleActive')).then(r => r !== undefined ? r : tryRead('publicSale')).then(r => r !== undefined ? r : tryRead('isOpen')),
        tryRead('paused'),
        tryRead('phase').then(r => r !== undefined ? r : tryRead('step')).then(r => r !== undefined ? r : tryRead('status')).then(r => r !== undefined ? r : tryRead('mintState')).then(r => r !== undefined ? r : tryRead('saleState')),
        tryRead('maxPerTx').then(r => r !== undefined ? r : tryRead('maxMintAmountPerTx')),
        tryRead('totalSupply'),
        tryRead('MAX_SUPPLY').then(r => r !== undefined ? r : tryRead('maxSupply'))
      ]);

      info.name = name as string | undefined;
      info.symbol = symbol as string | undefined;
      
      if (priceResult !== undefined) info.priceWei = BigInt(priceResult as any);
      if (maxWalletResult !== undefined) info.maxPerWallet = Number(maxWalletResult);

      // Phase Detection
      info.mintPhase = 'Unknown';
      if (presaleResult === true) info.mintPhase = 'Whitelist';
      if (publicSaleResult === true) info.mintPhase = 'Public';
      
      // If neither is true but we can read them, or if we have phase/step/status
      if (info.mintPhase === 'Unknown' && phaseResult !== undefined) {
        if (Number(phaseResult) === 0) info.mintPhase = 'Upcoming';
        else if (Number(phaseResult) === 1) info.mintPhase = 'Whitelist';
        else if (Number(phaseResult) >= 2) info.mintPhase = 'Public';
      }
      
      // Overall Active state
      if (isPaused === true) {
        info.isActive = false;
      } else if (presaleResult || publicSaleResult || (phaseResult !== undefined && Number(phaseResult) > 0)) {
        info.isActive = true;
      } else if (presaleResult === false || publicSaleResult === false || (phaseResult !== undefined && Number(phaseResult) === 0)) {
        info.isActive = false;
        if (info.mintPhase === 'Unknown') info.mintPhase = 'Upcoming';
      }

      if (maxTxResult !== undefined) info.maxPerTx = Number(maxTxResult);
      if (totalSupplyResult !== undefined) info.totalSupply = Number(totalSupplyResult);
      if (maxSupplyResult !== undefined) info.maxSupply = Number(maxSupplyResult);

      // Guess the mint function by looking for common 4-byte selectors in the deployed bytecode
      let activeBytecode = bytecode;
      let targetAddress = address as `0x${string}`;
      
      // Check EIP-1967 logical implementation slot
      try {
        const slot = await this.client.getStorageAt({
          address: targetAddress,
          slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'
        });
        if (slot && slot !== '0x' && slot !== '0x0000000000000000000000000000000000000000000000000000000000000000') {
          const implAddress = '0x' + slot.substring(26) as `0x${string}`;
          const implBytecode = await this.client.getBytecode({ address: implAddress });
          if (implBytecode && implBytecode !== '0x') {
            activeBytecode = implBytecode;
          }
        } else if (bytecode.startsWith('0x363d3d373d3d3d363d73') || bytecode.includes('363d3d373d3d3d363d73')) {
          // EIP-1167 Minimal Proxy
          const idx = bytecode.indexOf('363d3d373d3d3d363d73');
          const implAddress = '0x' + bytecode.substring(idx + 20, idx + 60) as `0x${string}`;
          const implBytecode = await this.client.getBytecode({ address: implAddress });
          if (implBytecode && implBytecode !== '0x') {
            activeBytecode = implBytecode;
          }
        }
      } catch (e) {
        // Ignore proxy resolution errors
      }

      const activeBytecodeStr = activeBytecode.substring(2).toLowerCase();
      for (const [selector, signature] of Object.entries(MINT_SELECTORS)) {
        const hex = selector.substring(2).toLowerCase();
        if (activeBytecodeStr.includes(hex)) {
          info.mintFunction = selector;
          break;
        }
      }

      return info;
    } catch (err: any) {
      // If websocket closed, try to reconnect once
      if (!isRetry && err && (err.name === 'WebSocketRequestError' || err.message?.includes('socket has been closed') || err.message?.includes('WebSocket request failed'))) {
        this.log.warn('WebSocket closed, attempting reconnect and retry for getContractInfo...');
        try {
          await this.reconnect(this.config.rpcWs);
          return await this.getContractInfo(address, true);
        } catch (reconnectErr) {
          this.log.error({ err: reconnectErr }, 'Reconnect failed during getContractInfo retry');
        }
      }
      this.log.error({ err, address }, 'Failed to get contract info');
      return null;
    }
  }

  /** Execute a generic transaction (e.g. from Reservoir API) */
  async sendGenericTransaction(tx: { to: string; value: bigint; data: string; customGas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } }, privateKey: `0x${string}`): Promise<string> {
    if (!this.client) throw new Error('Not connected');

    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: this.viemChain,
      transport: webSocket(this.config.rpcWs),
    });

    const block = await this.client.getBlock();
    const baseFee = block.baseFeePerGas ?? 0n;
    
    let maxFeePerGas: bigint;
    let maxPriorityFeePerGas: bigint;
    
    if (tx.customGas) {
      maxPriorityFeePerGas = tx.customGas.maxPriorityFeePerGas ?? gasOptimizer.getEvmGasParams(this.config.gas, baseFee).maxPriorityFeePerGas;
      if (tx.customGas.maxFeePerGas) {
        maxFeePerGas = tx.customGas.maxFeePerGas;
      } else {
        maxFeePerGas = (baseFee * 150n / 100n) + maxPriorityFeePerGas;
      }
    } else {
      const gasParams = gasOptimizer.getEvmGasParams(this.config.gas, baseFee);
      maxFeePerGas = gasParams.maxFeePerGas;
      maxPriorityFeePerGas = gasParams.maxPriorityFeePerGas;
    }

    this.log.info({ to: tx.to, value: tx.value.toString() }, 'Sending generic transaction');

    const hash = await walletClient.sendTransaction({
      to: tx.to as `0x${string}`,
      value: tx.value,
      data: tx.data as `0x${string}`,
      maxFeePerGas,
      maxPriorityFeePerGas,
    });

    return hash;
  }

  /** Sign EIP-712 typed data */
  async signEIP712Message(data: any, privateKey: `0x${string}`): Promise<string> {
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: this.viemChain,
      transport: webSocket(this.config.rpcWs),
    });
    
    // Convert string addresses/hex to proper viem types if necessary
    // Reservoir API returns domain, types, message objects that map 1:1 with viem's signTypedData
    const signature = await walletClient.signTypedData({
      account,
      domain: data.domain,
      types: data.types,
      primaryType: data.primaryType,
      message: data.message,
    });
    
    return signature;
  }
}
