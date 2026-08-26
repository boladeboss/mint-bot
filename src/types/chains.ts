/**
 * Chain and adapter type definitions for the multi-chain mint bot.
 */

/** Supported blockchain identifiers */
export type ChainId = 'ethereum' | 'base' | 'polygon' | 'arbitrum' | 'optimism' | 'avalanche' | 'bsc' | 'robinhood';

/** Gas aggression levels for bidding strategies */
export type GasAggression = 'conservative' | 'normal' | 'aggressive' | 'max';

/** EVM (Ethereum/Base) gas configuration */
export interface EvmGasConfig {
  mode?: 'auto' | 'custom';
  maxPriorityFeeGwei: number;
  maxFeeMultiplier: number;
  aggression: GasAggression;
  customBaseFeeGwei?: number;
  customPriorityFeeGwei?: number;
}

/** Union of all gas config shapes */
export type GasConfig = EvmGasConfig;

export interface EvmChainConfig {
  enabled: boolean;
  rpcWs: string;
  chainId: number;
  explorer: string;
  gas: EvmGasConfig;
  usdcAddress?: string;
}


/** A mint transaction to be sent to a chain */
export interface MintTransaction {
  chain: ChainId;
  contractAddress: string;
  mintFunction: string;
  args: unknown[];
  value: bigint;
  gasLimit?: bigint;
  customGas?: {
    maxFeePerGas?: bigint;
    maxPriorityFeePerGas?: bigint;
  };
}

/** Route strategies for broadcasting transactions */
export type RouteType = 'public' | 'flashbots' | 'fanout';

export interface RouteConfig {
  type: RouteType;
  endpoints?: string[];
}

/** A pre-signed, fully armed transaction ready for immediate dispatch */
export interface ArmedTransaction {
  chain: ChainId;
  contractAddress: string;
  walletAddress: string;
  rawTransaction: `0x${string}`;
  estimatedGasCost: bigint;
  nonce: number;
}


export interface ContractInfo {
  isValid: boolean;
  name?: string;
  symbol?: string;
  priceWei?: bigint;
  maxPerWallet?: number;
  maxPerTx?: number;
  totalSupply?: number;
  maxSupply?: number;
  isActive?: boolean;
  mintPhase?: 'Whitelist' | 'Public' | 'Upcoming' | 'Unknown';
  mintFunction?: string;
}

/** Interface that all chain adapters must implement */
export interface IChainAdapter {
  /** The chain this adapter handles */
  readonly chain: ChainId;

  /** The configuration for this chain, if applicable */
  readonly config?: EvmChainConfig;

  /** Establish connection to the chain's RPC */
  connect(): Promise<void>;

  /** Disconnect from the chain */
  disconnect(): Promise<void>;

  /** Monitor for new contract deployments */
  onNewContract(cb: (event: import('./events.js').MintOpportunity) => void): void;

  /** Watch a specific contract address for mint events */
  watchContract(address: string, cb: (event: import('./events.js').MintOpportunity) => void): void;

  /** Estimate gas for a mint transaction */
  estimateGas(tx: MintTransaction): Promise<bigint>;

  /** Pre-build and sign a transaction without broadcasting it */
  armTransaction(tx: MintTransaction, privateKey: `0x${string}`): Promise<ArmedTransaction>;

  /** Broadcast a pre-signed raw transaction immediately */
  sendRawTransaction(armedTx: ArmedTransaction, route?: RouteConfig): Promise<import('./events.js').MintResult>;

  /** Send a mint transaction (build, sign, and broadcast) and return the result */
  sendMint(tx: MintTransaction, privateKey: `0x${string}`): Promise<import('./events.js').MintResult>;

  /** Get the native balance of an address */
  getBalance(address: string): Promise<bigint>;

  /** Get an ERC20 token balance */
  getTokenBalance(address: string, tokenAddress: string): Promise<bigint>;

  /** Get current gas price in wei */
  getGasPrice(): Promise<bigint>;

  /** Whether the adapter is currently connected */
  isConnected(): boolean;

  /** Fetch contract details for a given address */
  getContractInfo(address: string): Promise<ContractInfo | null>;

  /** Disconnect and reconnect with a new RPC URL */
  reconnect(newRpcWs: string): Promise<void>;

  /** Execute a generic transaction (e.g. from Reservoir API) */
  sendGenericTransaction(tx: { to: string; value: bigint; data: string; customGas?: { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } }, privateKey: `0x${string}`): Promise<string>;

  /** Sign EIP-712 typed data */
  signEIP712Message(data: any, privateKey: `0x${string}`): Promise<string>;

  /** Get detailed fee data for gas tracker */
  getFeeData?(): Promise<{ baseFeePerGas?: bigint; maxPriorityFeePerGas?: bigint }>;

  /** Get underlying viem public client */
  getPublicClient(): import('viem').PublicClient;
}
