import axios from "axios";
import { M7_API_URL } from "../../config";

export type PoolsSortBy = "tvl" | "apr" | "vol";
export type OhlcvInterval =
  | "1s"
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "1h"
  | "2h"
  | "4h"
  | "8h"
  | "1D"
  | "1W";

export interface HMPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const API_URL = "https://hyperswap-public-production.up.railway.app/data";
const API_KEY = "O2c5gIAB/ePI+uP22JnbOvZu2K401M910OQL9YKSQSI="; // hardcoded for ease of testing for now

// M7 Backend API (from env via config)

const bearerToken = `Bearer ${API_KEY}`;

export const fetchPools = async (
  sortBy: PoolsSortBy,
  page: number,
  limit: number,
  q?: string
): Promise<{
  pools: HMPool[];
  pagination: HMPagination;
}> => {
  const params = new URLSearchParams({
    sortBy,
    page: page.toString(),
    limit: limit.toString(),
    ...(q && { q }),
  });
  const response = await fetch(`${API_URL}/pools?${params}`, {
    headers: {
      Authorization: bearerToken,
    },
  });
  return response.json();
};

export const fetchPool = async (poolAddress: string): Promise<HMPool> => {
  const response = await fetch(`${API_URL}/pools/${poolAddress}`, {
    headers: {
      Authorization: bearerToken,
    },
  });
  return response.json();
};

export const fetchPoolTransactions = async (
  poolAddress: string,
  page: number = 1,
  limit: number = 10,
  token?: string
): Promise<{
  transactions: HMPoolTransaction[];
  selectedToken: string;
  inverted: boolean;
  pagination: HMPagination;
}> => {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
    ...(token && { token }),
  });
  const response = await fetch(
    `${API_URL}/pools/${poolAddress}/txs?${params}`,
    {
      headers: {
        Authorization: bearerToken,
      },
    }
  );
  return response.json();
};

export const fetchPoolTransaction = async (
  txHash: string
): Promise<HMPoolTransaction> => {
  const response = await fetch(`${API_URL}/txs/${txHash}`, {
    headers: {
      Authorization: bearerToken,
    },
  });
  return response.json();
};

export const fetchMintAddressOhlcv = async (
  mintAddress: string,
  interval: OhlcvInterval = "1m",
  from?: number,
  to?: number,
  take?: number,
  usd?: boolean,
  token?: string
): Promise<{
  mintAddress: string;
  interval: OhlcvInterval;
  selectedToken: string;
  inverted: boolean;
  data: HMOhlcv[];
}> => {
  // Map intervals to our TradingView endpoint format
  const intervalMap: { [key in OhlcvInterval]: string } = {
    "1s": "1D", // Not supported, fallback to 1D
    "1m": "1D", // Not supported, fallback to 1D
    "5m": "1D", // Not supported, fallback to 1D
    "15m": "1D", // Not supported, fallback to 1D
    "30m": "1D", // Not supported, fallback to 1D
    "1h": "1D", // Not supported, fallback to 1D
    "2h": "1D", // Not supported, fallback to 1D
    "4h": "1D", // Not supported, fallback to 1D
    "8h": "1D", // Not supported, fallback to 1D
    "1D": "1D",
    "1W": "1W",
  };

  const mappedInterval = intervalMap[interval] || "1D";
  const currency = usd ? "usd" : "sol";

  console.log({
    address: token || mintAddress,
    type: mappedInterval,
    currency: currency,
  });

  try {
    const response = await axios.get(`${M7_API_URL}/tradingview/ohlcv`, {
      params: {
        address: token || mintAddress,
        type: mappedInterval,
        currency: currency,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    const result = response.data;

    // Transform BirdeyeOHLCVItem[] to HMOhlcv[] format
    const transformedData: HMOhlcv[] = result.data.map((item: any) => ({
      t: item.unixTime, // Convert from unixTime to t
      o: item.o, // open
      h: item.h, // high
      l: item.l, // low
      c: item.c, // close
      v: item.v, // volume
    }));

    console.log("[MintAddressOhlcv] Transformed data:", transformedData);

    return {
      mintAddress: mintAddress,
      interval,
      selectedToken: token || mintAddress,
      inverted: false,
      data: transformedData,
    };
  } catch (error) {
    console.error("Error fetching OHLCV data from M7 backend:", error);

    // Fallback to empty data or throw error
    return {
      mintAddress: mintAddress,
      interval,
      selectedToken: token || mintAddress,
      inverted: false,
      data: [],
    };
  }
};

export const fetchPairPools = async (
  token0: string,
  token1: string,
  page: number = 1,
  limit: number = 10
): Promise<{
  pools: HMPool[];
  pagination: HMPagination;
}> => {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  const response = await fetch(
    `${API_URL}/pools/pair/${token0}/${token1}?${params}`,
    {
      headers: {
        Authorization: bearerToken,
      },
    }
  );
  return response.json();
};

export const fetchPoolsByToken = async (
  token: string,
  page: number = 1,
  limit: number = 10
): Promise<{
  pools: HMPool[];
  pagination: HMPagination;
}> => {
  const params = new URLSearchParams({
    page: page.toString(),
    limit: limit.toString(),
  });
  const response = await fetch(`${API_URL}/pools/token/${token}?${params}`, {
    headers: {
      Authorization: bearerToken,
    },
  });
  return response.json();
};

export interface HMTokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  createdAt: string;
  updatedAt: string;
}

export interface HMPoolTokenMetadata {
  address: string;
  token0: HMTokenMetadata | null;
  token1: HMTokenMetadata | null;
}

export const fetchMintAddressMetadata = async (
  mintAddress: string
): Promise<HMTokenMetadata> => {
  try {
    const response = await axios.get(`${M7_API_URL}/tradingview/token-data`, {
      params: {
        mintAddress: mintAddress,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });

    // Extract the data from the response
    const tokenData = response.data.data;

    // Transform to HMTokenMetadata format
    return {
      address: tokenData.address,
      symbol: tokenData.symbol,
      name: tokenData.name,
      decimals: tokenData.decimals,
      createdAt: tokenData.createdAt,
      updatedAt: tokenData.updatedAt,
    };
  } catch (error) {
    console.error("Error fetching mint address metadata:", error);
    throw new Error("Failed to fetch mint address metadata");
  }
};

export interface HMPool {
  address: string;
  token0: string;
  token1: string;
  fee: number;
  tickSpacing: number;
  createdAt: string;
  updatedAt: string;
  poolFactory: string;
  txHash: string;
  blockNumber: string;
  blockTimestamp: string;
  feeProtocol0: number;
  feeProtocol1: number;
  currentTvlUSD: number;
  currentTvlToken0: number;
  currentTvlToken1: number;
  currentPrice: number;
  currentPriceUSD: number;
  currentSqrtPriceX96: string;
  currentTick: number;
  currentLiquidity: string;
  volume24hUSD: number;
  fees24hUSD: number;
  swaps24h: number;
  volume7dUSD: number;
  fees7dUSD: number;
  apr24h: number;
  apr7d: number;
  totalVolumeUSD: number;
  totalFeesUSD: number;
  totalSwaps: number;
  lastTxBlock: string | null;
  lastTxTimestamp: string | null;
  count?: {
    transactions: number;
    positions: number;
  };
}

export interface HMOhlcv {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}
type HMTransactionType =
  | "SWAP"
  | "MINT"
  | "BURN"
  | "COLLECT"
  | "INITIALIZE"
  | "COLLECT_PROTOCOL";

export interface HMPoolTransaction {
  id: string;
  txHash: string;
  blockNumber: string;
  blockTimestamp: string;
  logIndex: number;
  poolAddress: string;
  transactionType: HMTransactionType;
  sender: string;
  recipient: string;
  amount0: number;
  amount1: number;
  sqrtPriceX96: string | null;
  liquidity: string | null;
  tick: number | null;
  tickLower: number | null;
  tickUpper: number | null;
  liquidityAmount: string | null;
  hypePriceUSD: number | null;
  zeroForOne: boolean | null;
  amountInNet: number | null;
  amountOutNet: number | null;
  amountInGross: number | null;
  feesToken0: number | null;
  feesToken1: number | null;
  volumeToken0: number | null;
  volumeToken1: number | null;
  volumeUSD: number | null;
  feesUSD: number | null;
  price: number | null;
  priceUSD: number | null;
  tvlToken0: number | null;
  tvlToken1: number | null;
  tvlUSD: number | null;
}

// M7 Token Metadata Types
export interface M7TokenData {
  mintAddress: string;
  price?: string;
  priceUsd?: string;
  liquidity?: string;
  totalSupply?: string;
  circulatingSupply?: string;
  fdv?: string;
  marketCap?: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  logoUri?: string;
  holders?: number;
  website?: string;
  twitter?: string;
  discord?: string;
  curveProgress?: string;
  solReserves?: string;
  tokenReserves?: string;
}

export interface M7TokenMetadataResponse {
  telegramUserId: string;
  mintAddress: string;
  found: boolean;
  userHoldings?: number;
  tokenData?: M7TokenData;
  message: string;
}

// M7 API Functions
export const fetchTokenMetadata = async (
  mintAddress: string,
  telegramUserId: string
): Promise<M7TokenMetadataResponse> => {
  const response = await fetch(`${M7_API_URL}/user/get-token-metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      telegramUserId,
      mintAddress,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch token metadata: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
};

// Swap/Buy functionality
export interface BuySwapRequest {
  telegramUserId: string;
  inputAmount: number;
  outputMintAddress: string;
  presetId?: string;
}

export interface SellSwapRequest {
  telegramUserId: string;
  inputAmount: number;
  inputMintAddress: string;
  presetId?: string;
}

export interface BuySwapResponse {
  transactionId: string;
  telegramUserId: string;
  walletAddress: string;
  inputMintAddress: string;
  outputMintAddress: string;
  inputAmount: number;
  message: string;
}

export const buySwap = async (
  request: BuySwapRequest
): Promise<BuySwapResponse> => {
  try {
    const response = await axios.post(`${M7_API_URL}/solana/buySwap`, request, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to execute buy swap: ${error.response?.status} ${
          error.response?.statusText || error.message
        }`
      );
    }
    throw error;
  }
};

// User Preset Configs
export interface UserPresetConfig {
  id: string;
  configName: string;
  telegramId: string;
  priorityFee: number;
  slippagePercentage: number;
  isMev: boolean;
  isTurbo: boolean;
  jitoBribeAmount: number;
  insertedAt?: string | Date;
  lastModifiedAt?: string | Date;
}

export interface CreatePresetRequest {
  config_name: string;
  telegramId: string;
  priority_fee: number;
  slippage_percentage: number;
  is_mev: boolean;
  is_turbo: boolean;
  jito_bribe_amount: number;
}

export interface UpdatePresetRequest {
  telegramId: string;
  config_name?: string;
  priority_fee?: number;
  slippage_percentage?: number;
  is_mev?: boolean;
  is_turbo?: boolean;
  jito_bribe_amount?: number;
}

export const getUserPresets = async (
  telegramId: string
): Promise<UserPresetConfig[]> => {
  const res = await axios.get(`${M7_API_URL}/user/config`, {
    params: { telegramId },
  });
  return res.data?.data ?? [];
};

export const createUserPreset = async (
  request: CreatePresetRequest
): Promise<UserPresetConfig> => {
  const res = await axios.post(`${M7_API_URL}/user/config`, request, {
    headers: { "Content-Type": "application/json" },
  });
  return res.data?.data;
};

export const updateUserPreset = async (
  id: string,
  request: UpdatePresetRequest
): Promise<UserPresetConfig> => {
  const res = await axios.put(`${M7_API_URL}/user/config/${id}`, request, {
    headers: { "Content-Type": "application/json" },
  });
  return res.data?.data;
};

export const sellSwap = async (
  request: SellSwapRequest
): Promise<BuySwapResponse> => {
  try {
    const response = await axios.post(
      `${M7_API_URL}/solana/sellSwap`,
      request,
      {
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to execute sell swap: ${error.response?.status} ${
          error.response?.statusText || error.message
        }`
      );
    }
    throw error;
  }
};
