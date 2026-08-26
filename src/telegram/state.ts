export type PendingAction = {
  type: 'sell_token';
  chain: string;
  address: string;
} | {
  type: 'custom_gas';
  action: 'mint' | 'buy';
  chain: string;
  address: string;
} | {
  type: 'add_rpc';
  chain: string;
} | {
  type: 'mint_setup' | 'schedule_setup';
  chain: string;
  address: string;
  mintFunction: string;
  priceWei: bigint;
  maxPerTx?: number;
  gasAggression?: string;
} | {
  type: 'transfer_eth';
  step: 'chain' | 'from' | 'to' | 'amount' | 'dest_external';
  chain?: string;
  fromIndex?: number;
  toIndex?: number;
  destAddress?: number | string;
} | {
  type: 'transfer_nft';
  step: 'chain' | 'contract' | 'token' | 'from' | 'to' | 'dest_external';
  chain?: string;
  contract?: string;
  tokenId?: string;
  fromIndex?: number;
  destAddress?: number | string;
} | {
  type: 'disperse_eth';
  step: 'chain' | 'from' | 'amount' | 'to' | 'dest_external';
  chain?: string;
  fromIndex?: number;
} | {
  type: 'sweep_nfts';
  step: 'chain' | 'contract' | 'to' | 'sources' | 'dest_external';
  chain?: string;
  contract?: string;
  destAddress?: number | string;
  sourceIndices?: number[];
  fromIndex?: number;
} | {
  type: 'consolidate_eth';
  step: 'chain' | 'to' | 'sources' | 'amount' | 'dest_external';
  chain?: string;
  destAddress?: number | string;
  sourceIndices?: number[];
  fromIndex?: number;
} | {
  type: 'add_tracker';
};

export const userState = new Map<number, PendingAction>();
