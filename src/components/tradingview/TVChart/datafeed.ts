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
  supported_resolutions: [
    "1" as ResolutionString,
    "5" as ResolutionString,
    "15" as ResolutionString,
    "30" as ResolutionString,
    "60" as ResolutionString,
    "240" as ResolutionString,
    "1D" as ResolutionString,
    "1W" as ResolutionString,
  ],
  symbols_types: [
    {
      name: "crypto",
      value: "crypto",
    },
  ],
};

const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const activeSubscriptions = new Map<string, () => void>();

function buildWsUrl(wallet?: string) {
  const base = "wss://indexer-api-production.up.railway.app/ws";
  if (!wallet) return base;
  const qp = new URLSearchParams({ wallet }).toString();
  return `${base}?${qp}`;
}

function normalizeWsMessage(raw: any): any {
  // Handle variations: { msg: { ... } } or { message: { ... } } or direct object
  if (!raw) return null;
  if (raw.msg) return raw.msg;
  if (raw.message) return raw.message;
  return raw;
}

export default {
  onReady: (callback: (configuration: object) => void) => {
    setTimeout(() => callback(configurationData));
  },
  resolveSymbol: (
    symbolName: string,
    onSymbolResolvedCallback: (symbolInfo: LibrarySymbolInfo) => void,
    onResolveErrorCallback: (reason: string) => void
  ) => {
    const { tokenMetadata, currency, chartType, walletAddress } = JSON.parse(
      symbolName
    ) as {
      tokenMetadata: HMTokenMetadata;
      currency: "usd" | "whype";
      chartType: "price" | "mcap";
      walletAddress?: string;
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
      has_intraday: true,
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
      walletAddress,
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

    // Debug: invoked when timeframe changes or chart needs history
    try {
      console.log("[TVChart] getBars called", {
        resolution,
        from,
        to,
        countBack,
        symbol: symbolInfo?.address,
        desired: symbolInfo?.desiredAddress,
        currency: symbolInfo?.currency,
      });
    } catch {}

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
        try {
          console.log("[TVChart] getBars returning", {
            bars: formatted.length,
            noData,
          });
        } catch {}
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
  ) => {
    // If this subscriber already exists, clean up first (handles token changes for same UID)
    const existing = activeSubscriptions.get(subscriberUID);
    if (existing) {
      try {
        existing();
      } catch {}
      activeSubscriptions.delete(subscriberUID);
    }

    const tokenAddress: string =
      symbolInfo.desiredAddress || symbolInfo.address;

    const ws = new WebSocket(buildWsUrl(symbolInfo.walletAddress));
    let closed = false;
    let currentTokenAddress = tokenAddress;

    // Debug: subscribeBars invocation details
    try {
      const expectedGranularityForResolution = (() => {
        const map: Record<string, string> = {
          "1S": "1s",
          "1": "1m",
          "5": "5m",
          "15": "15m",
          "30": "30m",
          "60": "1h",
          "120": "2h",
          "240": "4h",
          "480": "8h",
          "1D": "1d",
          "1W": "1w",
          D: "1d",
          W: "1w",
        };
        return map[String(resolution)] || "1d";
      })();
      console.log("[TVChart] subscribeBars", {
        uid: subscriberUID,
        resolution,
        expected: expectedGranularityForResolution,
        tokenAddress,
        wallet: symbolInfo?.walletAddress,
      });
    } catch {}

    const sendSubscribe = () => {
      try {
        console.log("trying to send subscribe");
        ws.send(
          JSON.stringify({
            message: { TokenData: currentTokenAddress },
            action: "Subscribe",
          })
        );
      } catch {}
    };

    const forwardIfMatches = (granularity: string, payload: any) => {
      // Map resolution to expected granularity string values
      const resMap: Record<string, string> = {
        "1S": "1s",
        "1": "1m",
        "5": "5m",
        "15": "15m",
        "30": "30m",
        "60": "1h",
        "120": "2h",
        "240": "4h",
        "480": "8h",
        "1D": "1d",
        "1W": "1w",
        // TV sometimes passes compact day/week codes
        D: "1d",
        W: "1w",
      };

      const expected = resMap[resolution] || "1d";
      if (granularity.toLowerCase() !== expected.toLowerCase()) {
        // Debug: show why it was filtered
        // console.debug('[TV WS] Skip candle', { resolution, expected, got: granularity, token: payload?.token });
        return;
      }

      // Convert to TradingView bar shape
      const bar = {
        time: Number(payload.timestamp) * 1000,
        open: Number(payload.o),
        high: Number(payload.h),
        low: Number(payload.l),
        close: Number(payload.c),
        volume: payload.v != null ? Number(payload.v) : undefined,
      };
      onRealtimeCallback(bar);
    };

    ws.onopen = () => {
      sendSubscribe();
      try {
        console.log("[TVChart] WS open and subscribe sent", {
          token: currentTokenAddress,
          uid: subscriberUID,
        });
      } catch {}
    };

    ws.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        const msg = normalizeWsMessage(parsed);
        if (!msg) return;

        // Guard: ignore price messages not matching current token
        if (msg.messageType === "price" && msg.data) {
          const addr = msg.data.address || msg.data.mintAddress;
          if (!addr || addr !== tokenAddress) {
            return;
          }
          // We don't forward price updates to TradingView, so just ignore even if it matches
          return;
        }

        // Price messages are ignored here; we only handle candles
        if (msg.messageType === "candles" && Array.isArray(msg.data)) {
          console.log({ wsMsg: msg });
          for (const item of msg.data) {
            // Must match token; accept multiple possible fields
            const itemAddress =
              item?.token || item?.address || item?.mintAddress;
            if (itemAddress && tokenAddress && itemAddress !== tokenAddress)
              continue;
            if (!item?.granularity) continue;
            forwardIfMatches(String(item.granularity), item);
          }
        }
      } catch {}
    };

    ws.onclose = () => {};
    ws.onerror = () => {};

    // Monitor for token changes in symbolInfo and resubscribe on the same WS
    const tokenWatch = setInterval(() => {
      try {
        const nextToken = symbolInfo.desiredAddress || symbolInfo.address;
        if (
          nextToken &&
          nextToken !== currentTokenAddress &&
          ws.readyState === WebSocket.OPEN
        ) {
          // Unsubscribe previous token
          try {
            ws.send(
              JSON.stringify({
                message: { TokenData: currentTokenAddress },
                action: "Unsubscribe",
              })
            );
          } catch {}
          // Subscribe new token
          currentTokenAddress = nextToken;
          try {
            console.log("[TVChart] Resubscribing with new token", {
              uid: subscriberUID,
              token: currentTokenAddress,
            });
          } catch {}
          sendSubscribe();
        }
      } catch {}
    }, 1000);

    // Save cleanup for this subscriber
    activeSubscriptions.set(subscriberUID, () => {
      if (closed) return;
      closed = true;
      try {
        clearInterval(tokenWatch);
      } catch {}
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(
            JSON.stringify({
              message: { TokenData: currentTokenAddress },
              action: "Unsubscribe",
            })
          );
        }
      } catch {}
      try {
        console.log("[TVChart] unsubscribeBars cleanup", {
          uid: subscriberUID,
          token: currentTokenAddress,
        });
      } catch {}
      try {
        ws.close();
      } catch {}
    });
  },
  unsubscribeBars: (subscriberUID: string) => {
    const cleanup = activeSubscriptions.get(subscriberUID);
    if (cleanup) {
      try {
        cleanup();
      } catch {}
      activeSubscriptions.delete(subscriberUID);
    }
  },
} as IBasicDataFeed;
