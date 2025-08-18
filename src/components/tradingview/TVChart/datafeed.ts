import {
  LibrarySymbolInfo,
  ResolutionString,
  HistoryCallback,
  SubscribeBarsCallback,
  DatafeedConfiguration,
  IBasicDataFeed,
  PeriodParams,
  Timezone,
} from "./charting_library";
import {
  fetchMintAddressOhlcv,
  HMTokenMetadata,
} from "../../../hooks/hellomoon/hmApi";
import { RES_TO_INTERVAL } from "./helpers";

const configurationData: DatafeedConfiguration = {
  supported_resolutions: ["1D", "1W"] as ResolutionString[],
  symbols_types: [
    {
      name: "crypto",
      value: "crypto",
    },
  ],
};

const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const activeSubscriptions = new Map<string, () => void>();

export default {
  onReady: (callback: (configuration: object) => void) => {
    setTimeout(() => callback(configurationData));
  },
  resolveSymbol: (
    symbolName: string,
    onSymbolResolvedCallback: (symbolInfo: LibrarySymbolInfo) => void,
    onResolveErrorCallback: (reason: string) => void
  ) => {
    const { tokenMetadata, currency, chartType } = JSON.parse(symbolName) as {
      tokenMetadata: HMTokenMetadata;
      currency: "usd" | "whype";
      chartType: "price" | "mcap";
    };

    // For single token view, use the token directly
    const desiredToken = tokenMetadata;
    const baseToken = null;

    const symbolDisplayName = desiredToken?.symbol || "Unknown";

    const symbolInfo: any = {
      name: symbolDisplayName,
      ticker: symbolDisplayName,
      description: symbolDisplayName,
      type: "crypto",
      session: "24x7",
      timezone: userTimezone as Timezone,
      exchange: "Solana",
      minmov: 1,
      pricescale: 10 ** 16,
      has_intraday: false,
      has_seconds: false,
      has_weekly_and_monthly: true,
      has_daily: true,
      listed_exchange: "Solana",
      format: "price",
      supported_resolutions: configurationData.supported_resolutions || [],
      volume_precision: 2,
      data_status: "streaming",
      address: tokenMetadata.address,
      desiredAddress: desiredToken?.address,
      currency,
    };

    setTimeout(() => onSymbolResolvedCallback(symbolInfo));
  },
  getBars: (
    symbolInfo: any,
    resolution: ResolutionString,
    periodParams: PeriodParams,
    onHistoryCallback: HistoryCallback,
    onErrorCallback: (error: string) => void
  ) => {
    const { from, to, countBack } = periodParams;

    fetchMintAddressOhlcv(
      symbolInfo.address,
      RES_TO_INTERVAL[resolution],
      from,
      to,
      countBack,
      symbolInfo.currency === "usd",
      symbolInfo.desiredAddress
    )
      .then((data) => {
        // Filter to the requested time range to satisfy TV's paginator
        const filtered = (data.data || []).filter((bar) => {
          const t = bar.t; // seconds
          if (from != null && t < from) return false;
          if (to != null && t > to) return false;
          return true;
        });

        const formatted = filtered.map((bar) => ({
          time: bar.t * 1000,
          open: bar.o,
          high: bar.h,
          low: bar.l,
          close: bar.c,
          volume: bar.v,
        }));

        const noData = formatted.length === 0;
        if (noData) {
          console.log("[TVChart] No data in requested range");
        }
        // Signal noData so TradingView stops requesting older ranges
        // @ts-ignore - meta argument supported by TradingView
        onHistoryCallback(formatted, { noData });
      })
      .catch((error) => {
        console.error("[TVChart] Error fetching OHLCV data:", error);
        onErrorCallback(error?.message || "Failed to fetch chart data");
      });
  },
  subscribeBars: (
    symbolInfo: any,
    resolution: ResolutionString,
    onRealtimeCallback: SubscribeBarsCallback,
    subscriberUID: string,
    onResetCacheNeededCallback: () => void
  ) => {},
  unsubscribeBars: (subscriberUID: string) => {},
} as IBasicDataFeed;
