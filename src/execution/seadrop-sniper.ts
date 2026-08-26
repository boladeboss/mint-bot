import { encodeFunctionData, PublicClient, Address } from 'viem';
import { pino } from 'pino';

const log = pino({ name: 'seadrop-sniper' });

export const SEADROP_ADDRESS = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5' as const;
const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1F0DF003000390027140000fAa719' as const;

export const PUBLIC_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'nftContract', type: 'address' },
      { internalType: 'address', name: 'feeRecipient', type: 'address' },
      { internalType: 'address', name: 'minterIfNotPayer', type: 'address' },
      { internalType: 'uint256', name: 'quantity', type: 'uint256' }
    ],
    name: 'mintPublic',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: 'nftContract', type: 'address' }],
    name: 'getPublicDrop',
    outputs: [{
      components: [
        { internalType: 'uint80', name: 'mintPrice', type: 'uint80' },
        { internalType: 'uint48', name: 'startTime', type: 'uint48' },
        { internalType: 'uint48', name: 'endTime', type: 'uint48' },
        { internalType: 'uint16', name: 'maxTotalMintableByWallet', type: 'uint16' },
        { internalType: 'uint16', name: 'feeBps', type: 'uint16' },
        { internalType: 'bool', name: 'restrictFeeRecipients', type: 'bool' }
      ],
      internalType: 'struct PublicDrop',
      name: '',
      type: 'tuple'
    }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: 'nftContract', type: 'address' }],
    name: 'getAllowedFeeRecipients',
    outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;

export interface PublicDrop {
  mintPrice: bigint;
  startTime: number;
  endTime: number;
  maxTotalMintableByWallet: number;
  feeBps: number;
  restrictFeeRecipients: boolean;
}

export interface LocalMintPlan {
  to: Address;
  data: string;
  value: bigint;
  drop: PublicDrop;
  feeRecipient: Address;
}

export async function fetchPublicDrop(
  client: PublicClient,
  nftContract: Address
): Promise<PublicDrop | null> {
  try {
    const raw = await client.readContract({
      address: SEADROP_ADDRESS,
      abi: PUBLIC_ABI,
      functionName: 'getPublicDrop',
      args: [nftContract]
    }) as any;

    const drop: PublicDrop = {
      mintPrice: raw.mintPrice,
      startTime: raw.startTime,
      endTime: raw.endTime,
      maxTotalMintableByWallet: raw.maxTotalMintableByWallet,
      feeBps: raw.feeBps,
      restrictFeeRecipients: raw.restrictFeeRecipients
    };

    if (drop.startTime === 0 && drop.endTime === 0 && drop.maxTotalMintableByWallet === 0) {
      return null;
    }
    return drop;
  } catch (err) {
    log.debug({ err, contract: nftContract }, 'Contract is not a SeaDrop public drop');
    return null;
  }
}

export async function resolveFeeRecipient(
  client: PublicClient,
  nftContract: Address,
  restricted: boolean
): Promise<{ address: Address; source: string } | null> {
  let allowed: readonly Address[] = [];
  try {
    allowed = await client.readContract({
      address: SEADROP_ADDRESS,
      abi: PUBLIC_ABI,
      functionName: 'getAllowedFeeRecipients',
      args: [nftContract]
    }) as readonly Address[];
  } catch (err) {
    // Ignore
  }

  if (allowed.length > 0) {
    return { address: allowed[0]!, source: 'allowed fee recipient on-chain' };
  }
  if (restricted) {
    return null;
  }
  return { address: OPENSEA_FEE_RECIPIENT, source: 'OpenSea default' };
}

export function encodeMintPublic(
  nftContract: Address,
  feeRecipient: Address,
  quantity: number
): string {
  return encodeFunctionData({
    abi: PUBLIC_ABI,
    functionName: 'mintPublic',
    args: [
      nftContract,
      feeRecipient,
      '0x0000000000000000000000000000000000000000' as Address,
      BigInt(quantity)
    ]
  });
}

export async function buildLocalMintPlan(
  client: PublicClient,
  nftContract: Address,
  quantity: number
): Promise<LocalMintPlan | null> {
  const drop = await fetchPublicDrop(client, nftContract);
  if (!drop) return null;

  const fee = await resolveFeeRecipient(client, nftContract, drop.restrictFeeRecipients);
  if (!fee) return null;

  return {
    to: SEADROP_ADDRESS,
    data: encodeMintPublic(nftContract, fee.address, quantity),
    value: drop.mintPrice * BigInt(quantity),
    drop,
    feeRecipient: fee.address
  };
}
