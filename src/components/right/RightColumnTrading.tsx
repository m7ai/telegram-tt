import type { FC } from "../../lib/teact/teact";
import {
  memo,
  useRef,
  useEffect,
  useState,
  useMemo,
} from "../../lib/teact/teact";
import { getActions, withGlobal } from "../../global";

import { selectTabState } from "../../global/selectors";
import captureEscKeyListener from "../../util/captureEscKeyListener";

import useHistoryBack from "../../hooks/useHistoryBack";
import useLastCallback from "../../hooks/useLastCallback";
import { useResize } from "../../hooks/useResize";
import useResizeObserver from "../../hooks/useResizeObserver";

import TVChart from "../tradingview/TVChart/TVChart";
import type {
  HMTokenMetadata,
  M7TokenMetadataResponse,
} from "../../hooks/hellomoon/hmApi";
import { M7_API_URL } from "../../config";
import {
  fetchMintAddressMetadata,
  fetchTokenMetadata,
  buySwap,
  sellSwap,
  type BuySwapRequest,
  type SellSwapRequest,
} from "../../hooks/hellomoon/hmApi";
import { formatNumber } from "../../util/formatNumber";
import {
  getUserPresets,
  createUserPreset,
  updateUserPreset,
  type UserPresetConfig,
} from "../../hooks/hellomoon/hmApi";

import "./RightColumnTrading.scss";

interface OwnProps {
  isMobile?: boolean;
}

interface CoinData {
  id: string;
  name: string;
  subtitle: string;
  time: string;
  comments: string;
  score?: string;
  cap: string;
  holders: number;
  volume: string;
  price?: string;
  change?: string;
}

type StateProps = {
  isOpen: boolean;
  selectedCoin?: CoinData;
  selectedMintAddress?: string;
  currentUserId?: string;
};

const RightColumnTrading: FC<OwnProps & StateProps> = ({
  isMobile,
  isOpen,
  selectedCoin,
  selectedMintAddress,
  currentUserId,
}) => {
  const { closeTradingColumn } = getActions();
  const containerRef = useRef<HTMLDivElement>(null!);

  // Enable resizing from the left edge; persist width to CSS var so layout reflows
  const { initResize, resetResize, handleMouseUp } = useResize(
    containerRef,
    (newWidthPx) => {
      const root = document.documentElement;
      root.style.setProperty("--trading-column-width", `${newWidthPx}px`);
    },
    () => {
      const root = document.documentElement;
      root.style.removeProperty("--trading-column-width");
    },
    undefined,
    "--trading-column-width",
    true
  );

  // Ensure a fixed default width when the trading column opens
  useEffect(() => {
    if (isOpen) {
      const root = document.documentElement;
      root.style.setProperty("--trading-column-width", "500px");
    }
  }, [isOpen]);

  // Note: Removed width observer to prevent automatic shrinking/capping on mount

  // Token metadata state
  const [tokenMetadata, setTokenMetadata] = useState<
    M7TokenMetadataResponse | undefined
  >();
  const [isLoadingTokenMetadata, setIsLoadingTokenMetadata] = useState(false);
  const [tokenMetadataError, setTokenMetadataError] = useState<string | null>(
    null
  );

  // TVChart state and logic
  const [chartTokenMetadata, setChartTokenMetadata] = useState<
    HMTokenMetadata | undefined
  >();
  const [isLoadingChart, setIsLoadingChart] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);

  // Trading state
  const [tradeType, setTradeType] = useState<"buy" | "sell">("buy");
  const [selectedPoolTab, setSelectedPoolTab] = useState<"P1" | "P2" | "P3">(
    "P1"
  );
  const [inputAmount, setInputAmount] = useState<string>("");

  // Swap state
  const [isSwapLoading, setIsSwapLoading] = useState(false);
  const [lastTransactionId, setLastTransactionId] = useState<string | null>(
    null
  );
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapErrorDetails, setSwapErrorDetails] = useState<{
    status?: number;
    signature?: string;
    transactionMessage?: string;
    transactionLogs?: string[];
  } | null>(null);
  const [isSyncingHoldings, setIsSyncingHoldings] = useState(false);
  const syncingStartRef = useRef<number>(0);

  // Derived state for user holdings
  const userHoldings = useMemo(() => {
    return tokenMetadata?.userHoldings || 0;
  }, [tokenMetadata?.userHoldings]);

  // Mounted ref for safe async updates
  const isMountedRef = useRef(true);
  const wsRef = useRef<WebSocket | null>(null);
  const previousMintRef = useRef<string | undefined>(undefined);
  const selectedMintRef = useRef<string | undefined>(undefined);
  const [wsWalletAddress, setWsWalletAddress] = useState<string | undefined>(
    undefined
  );
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Fetch wallet address for WS connection
  useEffect(() => {
    let aborted = false;
    const fetchWallet = async () => {
      if (!currentUserId) return;
      try {
        const res = await fetch(`${M7_API_URL}/user/get-balance`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramUserId: currentUserId }),
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!aborted) setWsWalletAddress(data?.walletAddress);
      } catch (e) {
        // ignore
      }
    };
    fetchWallet();
    return () => {
      aborted = true;
    };
  }, [currentUserId]);

  // Keep a ref of the latest selectedMintAddress
  useEffect(() => {
    selectedMintRef.current = selectedMintAddress;
  }, [selectedMintAddress]);

  // WS connect and base handlers
  useEffect(() => {
    if (!isOpen || !wsWalletAddress) return;

    // Close any existing socket before opening a new one
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
    }

    const url = `wss://m7-api-production.up.railway.app/ws?wallet=${encodeURIComponent(
      wsWalletAddress
    )}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      const mintToSubscribe = selectedMintRef.current;
      if (!mintToSubscribe) return;
      // Subscribe current mint on open
      try {
        ws.send(
          JSON.stringify({
            message: { TokenData: mintToSubscribe },
            action: "Subscribe",
          })
        );
        previousMintRef.current = mintToSubscribe;
      } catch {}
    };

    ws.onmessage = (e: MessageEvent) => {
      try {
        const msg = JSON.parse(e.data);

        if (msg?.messageType === "price" && msg?.data?.price) {
          const msgAddress = msg?.data?.address || msg?.data?.mintAddress;
          const currentMint = selectedMintRef.current;
          if (!msgAddress || !currentMint || msgAddress !== currentMint) {
            // Ignore price updates for other tokens
            return;
          }
          setTokenMetadata((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              tokenData: {
                ...prev.tokenData,
                price: String(msg.data.price),
                priceUsd:
                  msg.data.priceUsd !== undefined
                    ? String(msg.data.priceUsd)
                    : prev.tokenData?.priceUsd,
                // Optionally sync other fields if present
                marketCap: msg.data.marketCap ?? prev.tokenData?.marketCap,
                liquidity: msg.data.liquidity ?? prev.tokenData?.liquidity,
                curveProgress:
                  msg.data.curveProgress ?? prev.tokenData?.curveProgress,
                solReserves:
                  msg.data.solReserves ?? prev.tokenData?.solReserves,
                tokenReserves:
                  msg.data.tokenReserves ?? prev.tokenData?.tokenReserves,
              },
            } as M7TokenMetadataResponse;
          });
        }
      } catch {
        // ignore malformed messages
      }
    };

    ws.onerror = (err) => {
      console.error("[WS] Error", err);
      // noop; UI already handles error states for chart/metadata
    };

    ws.onclose = () => {
      // clear ref on close
      if (wsRef.current === ws) {
        wsRef.current = null;
      }
    };

    return () => {
      try {
        // Best-effort unsubscribe before closing
        if (ws.readyState === WebSocket.OPEN && previousMintRef.current) {
          ws.send(
            JSON.stringify({
              message: { TokenData: previousMintRef.current },
              action: "Unsubscribe",
            })
          );
        }
      } catch {}
      try {
        ws.close();
      } catch {}
    };
  }, [isOpen, wsWalletAddress]);

  // When selectedMintAddress changes, re-subscribe on the existing WS
  useEffect(() => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!selectedMintAddress) return;

    try {
      if (previousMintRef.current) {
        ws.send(
          JSON.stringify({
            message: { TokenData: previousMintRef.current },
            action: "Unsubscribe",
          })
        );
      }
    } catch {}

    try {
      ws.send(
        JSON.stringify({
          message: { TokenData: selectedMintAddress },
          action: "Subscribe",
        })
      );
      previousMintRef.current = selectedMintAddress;
    } catch {}
  }, [selectedMintAddress]);

  // Helper: refresh once and return whether holdings changed vs previous
  const refreshHoldingsOnce = useLastCallback(
    async (previousHoldings: number) => {
      if (!selectedMintAddress || !currentUserId) return false;
      try {
        const data = await fetchTokenMetadata(
          selectedMintAddress,
          currentUserId
        );
        if (!isMountedRef.current) return false;
        setTokenMetadata(data);
        return (
          typeof data?.userHoldings !== "undefined" &&
          data.userHoldings !== previousHoldings
        );
      } catch (err) {
        console.error("[TokenMetadata] Failed to refresh after swap:", err);
        return false;
      }
    }
  );

  // Helper: syncing state with minimum visible duration
  const startSyncing = useLastCallback(() => {
    syncingStartRef.current = Date.now();
    setIsSyncingHoldings(true);
  });

  const endSyncing = useLastCallback(async () => {
    const minimumVisibleMs = 1000;
    const elapsed = Date.now() - syncingStartRef.current;
    if (elapsed < minimumVisibleMs) {
      await new Promise((resolve) =>
        setTimeout(resolve, minimumVisibleMs - elapsed)
      );
    }
    if (isMountedRef.current) {
      setIsSyncingHoldings(false);
    }
  });

  // Helper: poll up to 30s every 2s until holdings change
  const pollForUpdatedHoldings = useLastCallback(
    async (previousHoldings: number) => {
      if (!selectedMintAddress || !currentUserId) return;
      const maxDurationMs = 30000;
      const intervalMs = 2000;
      const startMs = Date.now();
      startSyncing();
      while (Date.now() - startMs < maxDurationMs && isMountedRef.current) {
        try {
          const data = await fetchTokenMetadata(
            selectedMintAddress,
            currentUserId
          );
          if (!isMountedRef.current) return;
          if (
            typeof data?.userHoldings !== "undefined" &&
            data.userHoldings !== previousHoldings
          ) {
            setTokenMetadata(data);

            await endSyncing();
            return;
          }
        } catch (err) {
          console.error("[TokenMetadata] Polling error after swap:", err);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
      await endSyncing();
    }
  );

  // Image loading state
  const [logoLoadError, setLogoLoadError] = useState(false);

  // Fetch token metadata when mintAddress or currentUserId changes
  useEffect(() => {
    if (!selectedMintAddress || !currentUserId) {
      setTokenMetadata(undefined);
      setTokenMetadataError(null);
      setLogoLoadError(false);
      return;
    }

    setIsLoadingTokenMetadata(true);
    setTokenMetadataError(null);

    fetchTokenMetadata(selectedMintAddress, currentUserId)
      .then((data) => {
        setTokenMetadata(data);
        setIsLoadingTokenMetadata(false);
        setLogoLoadError(false);
      })
      .catch((err) => {
        console.error("[TokenMetadata] Failed to load token metadata", err);
        setTokenMetadataError(err.message || "Failed to load token metadata");
        setIsLoadingTokenMetadata(false);
      });
  }, [selectedMintAddress, currentUserId]);

  // Use selected mint address
  const mintAddress = selectedMintAddress;

  useEffect(() => {
    if (!mintAddress) return;

    setIsLoadingChart(true);
    setChartError(null);

    fetchMintAddressMetadata(mintAddress)
      .then((tokenData) => {
        setChartTokenMetadata(tokenData);
        setIsLoadingChart(false);
      })
      .catch((err) => {
        console.error("[TVChart] Failed to load token metadata", err);
        setChartError(err.message || "Failed to load chart data");
        setIsLoadingChart(false);
      });
  }, [mintAddress]);

  const TVChartElem = useMemo(() => {
    if (!chartTokenMetadata) return null;
    return (
      <TVChart
        tokenMetadata={chartTokenMetadata}
        settings={{ chartType: "price", currency: "usd", wsWalletAddress }}
      />
    );
  }, [chartTokenMetadata]);

  const handleClose = useLastCallback(() => {
    closeTradingColumn();
  });

  const handleInputAmountChange = useLastCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      // Allow only valid number inputs
      if (value === "" || /^\d*\.?\d*$/.test(value)) {
        setInputAmount(value);
      }
    }
  );

  const handleInputButtonClick = useLastCallback((amount: string) => {
    setInputAmount(amount);
  });

  const handlePercentageClick = useLastCallback((percentage: number) => {
    if (userHoldings <= 0) {
      console.warn("No holdings available for percentage calculation");
      setInputAmount("0");
      return;
    }

    const calculatedAmount = (userHoldings * percentage) / 100;
    setInputAmount(calculatedAmount.toString());
  });

  const handleCloseTransaction = useLastCallback(() => {
    setLastTransactionId(null);
  });

  const handleCloseError = useLastCallback(() => {
    setSwapError(null);
    setSwapErrorDetails(null);
  });

  // Preset editor state
  const [isEditingPresets, setIsEditingPresets] = useState(false);
  const [presets, setPresets] = useState<UserPresetConfig[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | undefined>(
    undefined
  );
  const [presetForm, setPresetForm] = useState({
    config_name: "",
    priority_fee: "0",
    slippage_percentage: "0",
    is_mev: false,
    is_turbo: false,
    jito_bribe_amount: "0",
  });

  // Load presets when component mounts or currentUserId changes
  useEffect(() => {
    if (currentUserId) {
      getUserPresets(currentUserId)
        .then((data) => {
          setPresets(data);
        })
        .catch((err) => {
          console.error("Failed to load presets on mount:", err);
        });
    }
  }, [currentUserId]);

  const handleToggleEditPresets = useLastCallback(async () => {
    const next = !isEditingPresets;
    setIsEditingPresets(next);
    if (next && currentUserId) {
      try {
        const data = await getUserPresets(currentUserId);
        setPresets(data);
        const first = data[0];
        if (first) {
          setActivePresetId(first.id);
          setPresetForm({
            config_name: first.configName,
            priority_fee: first.priorityFee.toString(),
            slippage_percentage: first.slippagePercentage.toString(),
            is_mev: first.isMev,
            is_turbo: first.isTurbo,
            jito_bribe_amount: first.jitoBribeAmount.toString(),
          });
        } else {
          setActivePresetId(undefined);
          setPresetForm({
            config_name: "",
            priority_fee: "0",
            slippage_percentage: "0",
            is_mev: false,
            is_turbo: false,
            jito_bribe_amount: "0",
          });
        }
      } catch (e) {
        console.error("Failed to load presets", e);
      }
    }
  });

  const handlePresetFieldChange = useLastCallback(
    (field: keyof typeof presetForm, value: string | boolean) => {
      setPresetForm((prev) => ({ ...prev, [field]: value as any }));
    }
  );

  const handleSelectPreset = useLastCallback((id: string) => {
    const p = presets.find((x) => x.id === id);
    if (!p) return;
    setActivePresetId(id);
    setPresetForm({
      config_name: p.configName,
      priority_fee: p.priorityFee.toString(),
      slippage_percentage: p.slippagePercentage.toString(),
      is_mev: p.isMev,
      is_turbo: p.isTurbo,
      jito_bribe_amount: p.jitoBribeAmount.toString(),
    });
  });

  const handleSavePreset = useLastCallback(async () => {
    if (!currentUserId) return;
    const payloadCommon = {
      config_name: presetForm.config_name,
      priority_fee: Number(presetForm.priority_fee),
      slippage_percentage: Number(presetForm.slippage_percentage),
      is_mev: !!presetForm.is_mev,
      is_turbo: !!presetForm.is_turbo,
      jito_bribe_amount: Number(presetForm.jito_bribe_amount),
    };
    try {
      let saved: UserPresetConfig;
      if (activePresetId) {
        saved = await updateUserPreset(activePresetId, {
          telegramId: currentUserId,
          ...payloadCommon,
        });
      } else {
        saved = await createUserPreset({
          telegramId: currentUserId,
          ...payloadCommon,
        });
      }
      // refresh list
      const data = await getUserPresets(currentUserId);
      setPresets(data);
      setActivePresetId(saved.id);
    } catch (e) {
      console.error("Failed to save preset", e);
    }
  });

  const handleBuySwap = useLastCallback(async () => {
    if (!currentUserId || !selectedMintAddress) {
      console.error("Missing required data for buy swap:", {
        currentUserId,
        selectedMintAddress,
      });
      return;
    }

    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      console.error("Invalid input amount:", inputAmount);
      return;
    }

    // Clear previous transaction/error and start loading
    setLastTransactionId(null);
    setSwapError(null);
    setIsSwapLoading(true);

    try {
      const previousHoldings = userHoldings;
      // Get active preset ID based on selected pool tab
      const activePreset = presets.find(
        (p, index) => selectedPoolTab === `P${index + 1}`
      );

      const swapRequest: BuySwapRequest = {
        telegramUserId: currentUserId,
        inputAmount: amount,
        outputMintAddress: selectedMintAddress,
        presetId: activePreset?.id,
      };

      console.log("Executing buy swap:", swapRequest);
      const result = await buySwap(swapRequest);
      console.log("Buy swap successful:", result);

      // Store the transaction ID for display
      setLastTransactionId(result.transactionId);

      // Switch from processing to syncing state and start balance refresh/polling
      setIsSwapLoading(false);
      startSyncing();

      // Refresh once; if unchanged, poll up to 30s for update
      const updated = await refreshHoldingsOnce(previousHoldings);
      if (!updated) {
        await pollForUpdatedHoldings(previousHoldings);
      } else {
        await endSyncing();
      }

      // Refresh wallet balance in profile
      if (typeof (window as any).refreshWalletBalance === "function") {
        (window as any).refreshWalletBalance();
      }
    } catch (error: any) {
      console.error("Buy swap failed:", error);

      // Extract error message from response
      let errorMessage = "Transaction failed. Please try again.";
      const responseData = error?.response?.data;
      if (typeof responseData === "string") {
        errorMessage = responseData;
      } else if (responseData?.message) {
        errorMessage = responseData.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      setSwapError(errorMessage);
      setSwapErrorDetails({
        status: error?.response?.status,
        signature: responseData?.signature,
        transactionMessage:
          responseData?.transactionMessage || responseData?.message,
        transactionLogs: responseData?.transactionLogs,
      });
    } finally {
      setIsSwapLoading(false);
    }
  });

  const handleSellSwap = useLastCallback(async () => {
    if (!currentUserId || !selectedMintAddress) {
      console.error("Missing required data for sell swap:", {
        currentUserId,
        selectedMintAddress,
      });
      return;
    }

    const amount = parseFloat(inputAmount);
    if (isNaN(amount) || amount <= 0) {
      console.error("Invalid input amount:", inputAmount);
      return;
    }

    // Clear previous transaction/error and start loading
    setLastTransactionId(null);
    setSwapError(null);
    setIsSwapLoading(true);

    try {
      const previousHoldings = userHoldings;
      // Get active preset ID based on selected pool tab
      const activePreset = presets.find(
        (p, index) => selectedPoolTab === `P${index + 1}`
      );

      const swapRequest: SellSwapRequest = {
        telegramUserId: currentUserId,
        inputAmount: amount,
        inputMintAddress: selectedMintAddress,
        presetId: activePreset?.id,
      };

      console.log("Executing sell swap:", swapRequest);
      const result = await sellSwap(swapRequest);
      console.log("Sell swap successful:", result);

      // Store the transaction ID for display
      setLastTransactionId(result.transactionId);

      // Switch from processing to syncing state and start balance refresh/polling
      setIsSwapLoading(false);
      startSyncing();

      // Refresh once; if unchanged, poll up to 30s for update
      const updated = await refreshHoldingsOnce(previousHoldings);
      if (!updated) {
        await pollForUpdatedHoldings(previousHoldings);
      } else {
        await endSyncing();
      }

      // Refresh wallet balance in profile
      if (typeof (window as any).refreshWalletBalance === "function") {
        (window as any).refreshWalletBalance();
      }
    } catch (error: any) {
      console.error("Sell swap failed:", error);

      // Extract error message from response
      let errorMessage = "Transaction failed. Please try again.";
      const responseData = error?.response?.data;
      if (typeof responseData === "string") {
        errorMessage = responseData;
      } else if (responseData?.message) {
        errorMessage = responseData.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      setSwapError(errorMessage);
      setSwapErrorDetails({
        status: error?.response?.status,
        signature: responseData?.signature,
        transactionMessage:
          responseData?.transactionMessage || responseData?.message,
        transactionLogs: responseData?.transactionLogs,
      });
    } finally {
      setIsSwapLoading(false);
    }
  });

  const handleSwap = useLastCallback(async () => {
    if (tradeType === "buy") {
      await handleBuySwap();
    } else {
      await handleSellSwap();
    }
  });

  // Handle ESC key
  useHistoryBack({
    isActive: isOpen,
    onBack: handleClose,
  });

  // Capture ESC key
  captureEscKeyListener(() => {
    if (isOpen) {
      handleClose();
    }
  });

  return (
    <div
      ref={containerRef}
      className="RightColumnTrading"
      id="RightColumnTrading"
    >
      {!isMobile && (
        <div
          className="resize-handle"
          onMouseDown={initResize}
          onMouseUp={handleMouseUp}
          onDoubleClick={resetResize}
        />
      )}
      {(selectedCoin || tokenMetadata) && (
        <div className="trading-content">
          <div className="coin-item trading-header">
            {/* Loading State */}
            {isLoadingTokenMetadata && (
              <div className="token-loading-state">
                Loading token metadata...
              </div>
            )}

            {/* Error State */}
            {tokenMetadataError && (
              <div className="token-error-state">
                Error: {tokenMetadataError}
              </div>
            )}

            {/* Token Data */}
            {!isLoadingTokenMetadata &&
              !tokenMetadataError &&
              (tokenMetadata?.found || selectedCoin) && (
                <>
                  {/* Top row: Avatar, Name with copy icon, Time, and Metrics */}
                  <div className="coin-top-row">
                    <div className="coin-left">
                      <div className="coin-avatar">
                        {tokenMetadata?.tokenData?.logoUri && !logoLoadError ? (
                          <img
                            src={tokenMetadata.tokenData.logoUri}
                            alt="Token logo"
                            className="token-logo"
                            width="24"
                            height="24"
                            onError={() => {
                              setLogoLoadError(true);
                            }}
                          />
                        ) : null}
                      </div>
                      <div className="coin-content">
                        <div className="coin-info">
                          <span className="coin-name">
                            {tokenMetadata?.tokenData?.name ||
                              tokenMetadata?.tokenData?.symbol ||
                              selectedCoin?.name ||
                              "Unknown Token"}
                          </span>
                          <svg
                            className="coin-copy-icon"
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <rect
                              x="9"
                              y="9"
                              width="13"
                              height="13"
                              rx="2"
                              ry="2"
                            ></rect>
                            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                          </svg>
                        </div>
                      </div>
                    </div>

                    <div className="coin-metrics-and-close">
                      <button
                        type="button"
                        className="trading-close-button"
                        onClick={handleClose}
                        aria-label="Close"
                      >
                        <svg
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Bottom row: Stats */}
                  <div className="coin-stats-row">
                    <div className="stat-item left-aligned">
                      <img
                        src="/svg/liq.svg"
                        alt="liquidity"
                        className="stat-icon"
                        width="11"
                        height="10"
                      />
                      <span className="stat-value">
                        {tokenMetadata?.tokenData?.liquidity
                          ? `$${formatNumber(
                              tokenMetadata.tokenData.liquidity
                            )}`
                          : selectedCoin?.cap || "N/A"}
                      </span>
                    </div>

                    <div className="stats-right-group">
                      <div className="stat-item">
                        <img
                          src="/svg/people.svg"
                          alt="people"
                          className="stat-icon"
                          width="11"
                          height="10"
                        />
                        <span className="stat-value">
                          {tokenMetadata?.tokenData?.holders !== undefined
                            ? formatNumber(tokenMetadata.tokenData.holders)
                            : selectedCoin?.holders?.toLocaleString() || "N/A"}
                        </span>
                      </div>
                      <span className="stat-separator">|</span>
                      <div className="stat-item">
                        $
                        <span className="stat-value">
                          {tokenMetadata?.tokenData?.priceUsd
                            ? formatNumber(tokenMetadata.tokenData.priceUsd)
                            : selectedCoin?.price || "N/A"}
                        </span>
                      </div>
                      <span className="stat-separator">|</span>
                      <span className="stat-separator">|</span>
                      <div className="stat-item mc-group">
                        <span className="stat-value">MC</span>
                        <img
                          src="/svg/mc.svg"
                          alt="market cap"
                          className="stat-icon"
                          width="11"
                          height="10"
                        />
                        <span className="stat-value change-value">
                          {tokenMetadata?.tokenData?.marketCap
                            ? `$${formatNumber(
                                tokenMetadata.tokenData.marketCap
                              )}`
                            : selectedCoin?.cap || "N/A"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* User Holdings Row */}
                  {tokenMetadata?.userHoldings !== undefined && (
                    <div className="user-holdings-row">
                      <div className="holdings-item">
                        <img
                          src="/svg/wallet.svg"
                          alt="holdings"
                          className="stat-icon"
                          width="11"
                          height="10"
                        />
                        <span className="holdings-label">Your Holdings:</span>
                        <span className="holdings-value">
                          {tokenMetadata.userHoldings.toLocaleString()}
                        </span>
                        <span className="holdings-symbol">
                          {tokenMetadata?.tokenData?.symbol || "tokens"}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
          </div>

          {/* TVChart Component */}
          <div className="chart-container">
            {isLoadingChart && (
              <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #3DCEC5;">
                Loading chart...
              </div>
            )}
            {chartError && (
              <div style="display: flex; align-items: center; justify-content: center; height: 100%; color: #ff6b6b;">
                Error: {chartError}
              </div>
            )}
            {TVChartElem && TVChartElem}
          </div>

          {/* Trade Sidebar */}
          <div className="trade-sidebar">
            {/* Quick trade section */}
            <div className="trade-section">
              <div className="trade-section-content">
                <div className="trade-buttons">
                  <button
                    className={`trade-button trade-button-buy ${
                      tradeType === "buy" ? "active" : ""
                    }`}
                    onClick={() => setTradeType("buy")}
                  >
                    Buy
                  </button>
                  <button
                    className={`trade-button trade-button-sell ${
                      tradeType === "sell" ? "active" : ""
                    }`}
                    onClick={() => setTradeType("sell")}
                  >
                    Sell
                  </button>
                </div>

                <div className="amount-container">
                  <div className="amount-input-group">
                    <input
                      type="number"
                      placeholder="0.00"
                      className="amount-input"
                      value={inputAmount}
                      onChange={handleInputAmountChange}
                    />
                    <svg
                      className="solana-icon"
                      width="12"
                      height="12"
                      viewBox="0 0 13 11"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M2.61661 7.97555C2.68902 7.90314 2.78858 7.8609 2.89418 7.8609H12.4703C12.6453 7.8609 12.7328 8.07209 12.6091 8.19579L10.7174 10.0875C10.645 10.1599 10.5454 10.2021 10.4398 10.2021H0.863708C0.68872 10.2021 0.601225 9.99093 0.724924 9.86724L2.61661 7.97555Z"
                        fill="#686A6D"
                      />
                      <path
                        d="M2.61661 0.912591C2.69204 0.840182 2.7916 0.797943 2.89418 0.797943H12.4703C12.6453 0.797943 12.7328 1.00914 12.6091 1.13284L10.7174 3.02452C10.645 3.09693 10.5454 3.13917 10.4398 3.13917H0.863708C0.68872 3.13917 0.601225 2.92798 0.724924 2.80428L2.61661 0.912591Z"
                        fill="#686A6D"
                      />
                      <path
                        d="M10.7174 4.42144C10.645 4.34903 10.5454 4.30679 10.4398 4.30679H0.863708C0.68872 4.30679 0.601225 4.51799 0.724924 4.64169L2.61661 6.53337C2.68902 6.60578 2.78858 6.64802 2.89418 6.64802H12.4703C12.6453 6.64802 12.7328 6.43683 12.6091 6.31313L10.7174 4.42144Z"
                        fill="#686A6D"
                      />
                    </svg>
                  </div>
                  {tradeType === "buy" ? (
                    <div className="percentage-buttons">
                      <button
                        className="input-button"
                        onClick={() => handleInputButtonClick("0.001")}
                      >
                        0.001
                      </button>
                      <button
                        className="input-button"
                        onClick={() => handleInputButtonClick("0.1")}
                      >
                        0.1
                      </button>
                      <button
                        className="input-button"
                        onClick={() => handleInputButtonClick("0.5")}
                      >
                        0.5
                      </button>
                      <button
                        className="input-button"
                        onClick={() => handleInputButtonClick("1")}
                      >
                        1
                      </button>
                    </div>
                  ) : (
                    <div className="percentage-buttons">
                      <button
                        className="input-button"
                        onClick={() => handlePercentageClick(10)}
                      >
                        10%
                      </button>
                      <button
                        className="input-button"
                        onClick={() => handlePercentageClick(25)}
                      >
                        25%
                      </button>
                      <button
                        className="input-button"
                        onClick={() => handlePercentageClick(50)}
                      >
                        50%
                      </button>
                      <button
                        className="input-button"
                        onClick={() => handlePercentageClick(100)}
                      >
                        100%
                      </button>
                    </div>
                  )}

                  {tradeType === "sell" && (
                    <div className="holdings-info">
                      <span className="holdings-label">Holdings:</span>
                      <span className="holdings-amount">
                        {userHoldings.toLocaleString()}{" "}
                        {tokenMetadata?.tokenData?.symbol || "tokens"}
                      </span>
                    </div>
                  )}
                </div>

                <button
                  className={`buy-now-button ${
                    isSwapLoading || isSyncingHoldings ? "loading" : ""
                  }`}
                  onClick={handleSwap}
                  disabled={isSwapLoading || isSyncingHoldings}
                >
                  {isSwapLoading || isSyncingHoldings ? (
                    <>
                      <svg
                        className="loading-spinner"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M21 12a9 9 0 11-6.219-8.56" />
                      </svg>
                      {isSwapLoading
                        ? "Processing..."
                        : "Syncing Token Holdings On Chain..."}
                    </>
                  ) : (
                    <>
                      <svg
                        className="buy-now-icon"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                      </svg>
                      {tradeType === "buy" ? "Buy now" : "Sell now"}
                    </>
                  )}
                </button>

                {lastTransactionId && (
                  <div className="transaction-result">
                    <div className="transaction-header">
                      <div className="transaction-success">
                        Swap successful!
                      </div>
                      <button
                        className="close-transaction-button"
                        onClick={handleCloseTransaction}
                        title="Close"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                    <div className="transaction-id">
                      <span className="transaction-label">Transaction ID:</span>
                      <span className="transaction-hash">
                        {lastTransactionId.slice(0, 8)}...
                        {lastTransactionId.slice(-8)}
                      </span>
                      <a
                        className="solscan-link"
                        href={`https://solscan.io/tx/${lastTransactionId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="View transaction on Solscan"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                          <polyline points="15,3 21,3 21,9"></polyline>
                          <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                      </a>
                    </div>
                  </div>
                )}

                {swapError && (
                  <div className="transaction-error">
                    <div className="transaction-header">
                      <div className="transaction-failed">
                        Transaction Failed
                      </div>
                      <button
                        className="close-transaction-button"
                        onClick={handleCloseError}
                        title="Close"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>
                    <div className="error-message">
                      {swapError}
                      {swapErrorDetails?.transactionMessage && (
                        <div className="error-details">
                          <div className="error-details-title">Details</div>
                          <pre className="error-details-pre">
                            {swapErrorDetails.transactionMessage}
                          </pre>
                        </div>
                      )}
                      {swapErrorDetails?.transactionLogs?.length ? (
                        <div className="error-logs">
                          <div className="error-details-title">Logs</div>
                          <pre className="error-details-pre">
                            {JSON.stringify(
                              swapErrorDetails.transactionLogs,
                              null,
                              2
                            )}
                          </pre>
                        </div>
                      ) : null}
                      <div className="error-suggestions">
                        You can retry the transaction or adjust your trading
                        presets below to help ensure successful execution.
                      </div>
                    </div>
                    {(swapErrorDetails?.signature ||
                      (swapError.includes("check transaction") &&
                        swapError.match(/[A-Za-z0-9]{44}/g))) && (
                      <div className="transaction-id">
                        <span className="transaction-label">Check status:</span>
                        <a
                          className="solscan-link"
                          href={`https://solscan.io/tx/${
                            swapErrorDetails?.signature ||
                            swapError.match(/[A-Za-z0-9]{44}/g)![0]
                          }`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="View transaction on Solscan"
                        >
                          View on Solscan
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                            <polyline points="15,3 21,3 21,9"></polyline>
                            <line x1="10" y1="14" x2="21" y2="3"></line>
                          </svg>
                        </a>
                      </div>
                    )}
                  </div>
                )}

                <div className="preset-stats">
                  <div className="preset-stat">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M3 20V8a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v12"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M13 10h5a2 2 0 0 1 2 2v6"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M18 18a1 1 0 1 0 2 0 1 1 0 1 0-2 0"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M5 10h4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span className="preset-stat-value">
                      {(() => {
                        const activePreset = presets.find(
                          (p, index) => selectedPoolTab === `P${index + 1}`
                        );
                        return activePreset
                          ? activePreset.priorityFee
                          : "1,000,000";
                      })()}
                    </span>
                  </div>
                  <div className="preset-stat">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M12 2v20m8-10H4"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    </svg>
                    <span className="preset-stat-value">
                      {(() => {
                        const activePreset = presets.find(
                          (p, index) => selectedPoolTab === `P${index + 1}`
                        );
                        return activePreset
                          ? `${activePreset.slippagePercentage}%`
                          : "0.5%";
                      })()}
                    </span>
                  </div>
                  <div className="preset-stat">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                        fill="currentColor"
                      />
                    </svg>
                    <span className="preset-stat-value">
                      {(() => {
                        const activePreset = presets.find(
                          (p, index) => selectedPoolTab === `P${index + 1}`
                        );
                        return activePreset
                          ? activePreset.jitoBribeAmount
                          : "0";
                      })()}
                    </span>
                  </div>
                  <div className="preset-stat">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path d="M12 2L8 6h8l-4-4z" fill="currentColor" />
                      <rect
                        x="10"
                        y="6"
                        width="4"
                        height="12"
                        fill="currentColor"
                      />
                      <path d="M8 18h8v2H8v-2z" fill="currentColor" />
                    </svg>
                    <span className="preset-stat-value">
                      {(() => {
                        const activePreset = presets.find(
                          (p, index) => selectedPoolTab === `P${index + 1}`
                        );
                        return activePreset
                          ? activePreset.isMev
                            ? "ON"
                            : "OFF"
                          : "OFF";
                      })()}
                    </span>
                  </div>
                  <div className="preset-stat">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
                        fill="currentColor"
                      />
                    </svg>
                    <span className="preset-stat-value">
                      {(() => {
                        const activePreset = presets.find(
                          (p, index) => selectedPoolTab === `P${index + 1}`
                        );
                        return activePreset
                          ? activePreset.isTurbo
                            ? "ON"
                            : "OFF"
                          : "OFF";
                      })()}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Trading Presets section */}
            <div className="trade-section">
              <div className="trade-section-content">
                <div className="pools-tabs">
                  {presets.map((preset, index) => (
                    <button
                      key={preset.id}
                      className={`pool-tab ${
                        selectedPoolTab === `P${index + 1}`
                          ? "pool-tab-active"
                          : ""
                      }`}
                      onClick={() => {
                        setSelectedPoolTab(
                          `P${index + 1}` as "P1" | "P2" | "P3"
                        );
                        // Apply preset settings to trading form
                        // You can add logic here to apply preset settings to trading inputs
                      }}
                    >
                      {preset.configName}
                    </button>
                  ))}
                  {/* Show "No Presets" if no presets loaded */}
                  {presets.length === 0 && (
                    <button className="pool-tab pool-tab-active" disabled>
                      No Presets
                    </button>
                  )}
                  <button
                    className="input-button edit-button"
                    onClick={handleToggleEditPresets}
                  >
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      <path
                        d="m18.5 2.5 a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </div>

                {isEditingPresets && (
                  <div className="preset-editor">
                    <button
                      className="preset-close"
                      onClick={handleToggleEditPresets}
                    >
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                      >
                        <path
                          d="M18 6L6 18"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <path
                          d="M6 6l12 12"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <div className="preset-tabs">
                      {presets.map((p) => (
                        <button
                          key={p.id}
                          className={`preset-tab ${
                            activePresetId === p.id ? "preset-tab-active" : ""
                          }`}
                          onClick={() => handleSelectPreset(p.id)}
                        >
                          {p.configName}
                        </button>
                      ))}
                      {presets.length < 3 && (
                        <button
                          className={`preset-tab ${
                            !activePresetId ? "preset-tab-active" : ""
                          }`}
                          onClick={() => {
                            setActivePresetId(undefined);
                            setPresetForm({
                              config_name: "",
                              priority_fee: "0",
                              slippage_percentage: "0",
                              is_mev: false,
                              is_turbo: false,
                              jito_bribe_amount: "0",
                            });
                          }}
                        >
                          New
                        </button>
                      )}
                    </div>

                    <div className="preset-form">
                      <div className="preset-field">
                        <label className="preset-label">
                          Preset name *
                          <span className="char-count">
                            {10 - presetForm.config_name.length} characters
                            remaining
                          </span>
                        </label>
                        <input
                          type="text"
                          className="preset-input"
                          value={presetForm.config_name}
                          onChange={(e) =>
                            handlePresetFieldChange(
                              "config_name",
                              e.target.value.slice(0, 10)
                            )
                          }
                        />
                      </div>

                      <div className="preset-field">
                        <label className="preset-label">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M12 2L8 6h3v6h2V6h3l-4-4z"
                              fill="currentColor"
                            />
                            <path d="M8 18h8v2H8v-2z" fill="currentColor" />
                          </svg>
                          priority fee *
                        </label>
                        <div className="preset-input-with-dropdown">
                          <input
                            type="text"
                            className="preset-input"
                            value={presetForm.priority_fee}
                            onChange={(e) =>
                              handlePresetFieldChange(
                                "priority_fee",
                                e.target.value
                              )
                            }
                            placeholder="Text"
                          />
                          <button className="preset-dropdown">
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <path
                                d="M6 9l6 6 6-6"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="preset-field">
                        <label className="preset-label">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M12 2v20m8-10H4"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                            />
                          </svg>
                          slippage *
                        </label>
                        <div className="preset-input-with-unit">
                          <input
                            type="number"
                            className="preset-input"
                            value={presetForm.slippage_percentage}
                            onChange={(e) =>
                              handlePresetFieldChange(
                                "slippage_percentage",
                                e.target.value
                              )
                            }
                          />
                          <span className="preset-unit">%</span>
                        </div>
                      </div>

                      <div className="preset-field">
                        <div className="preset-toggle-section">
                          <div className="preset-toggle-info">
                            <h4>MEV reduction</h4>
                            <p>Activate to prevent MEV on transactions</p>
                          </div>
                          <button
                            className={`preset-toggle ${
                              presetForm.is_mev ? "preset-toggle-active" : ""
                            }`}
                            onClick={() =>
                              handlePresetFieldChange(
                                "is_mev",
                                !presetForm.is_mev
                              )
                            }
                          >
                            <div className="preset-toggle-slider">
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
                                <path
                                  d="M12 2L8 6h8l-4-4z"
                                  fill="currentColor"
                                />
                                <rect
                                  x="10"
                                  y="6"
                                  width="4"
                                  height="12"
                                  fill="currentColor"
                                />
                                <path d="M8 18h8v2H8v-2z" fill="currentColor" />
                              </svg>
                            </div>
                          </button>
                        </div>
                      </div>

                      <div className="preset-field">
                        <label className="preset-label">
                          <svg
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                          >
                            <path
                              d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"
                              fill="currentColor"
                            />
                          </svg>
                          Buy Bribe
                        </label>
                        <p className="preset-description">
                          minimum 0.001 sol bribe required for successful jito
                          transaction
                        </p>
                        <div className="preset-input-with-dropdown">
                          <input
                            type="text"
                            className="preset-input"
                            value={presetForm.jito_bribe_amount}
                            onChange={(e) =>
                              handlePresetFieldChange(
                                "jito_bribe_amount",
                                e.target.value
                              )
                            }
                            placeholder="min. 0.001"
                          />
                          <button className="preset-dropdown">
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <path
                                d="M6 9l6 6 6-6"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                        </div>
                      </div>

                      <div className="preset-field">
                        <div className="preset-toggle-section">
                          <div className="preset-toggle-info">
                            <h4>Turbo mode</h4>
                            <p>
                              Turbo transactions get sent to top validators,
                              giving you the best chance of success
                            </p>
                          </div>
                          <button
                            className={`preset-toggle ${
                              presetForm.is_turbo ? "preset-toggle-active" : ""
                            }`}
                            onClick={() =>
                              handlePresetFieldChange(
                                "is_turbo",
                                !presetForm.is_turbo
                              )
                            }
                          >
                            <div className="preset-toggle-slider">
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
                                <path
                                  d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"
                                  fill="currentColor"
                                />
                              </svg>
                            </div>
                          </button>
                        </div>
                      </div>

                      <button
                        className="preset-save-button"
                        onClick={handleSavePreset}
                      >
                        Save Preset
                      </button>
                    </div>
                  </div>
                )}

                <div className="token-metrics">
                  <div className="token-metric">
                    <span className="token-metric-label">Price</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.priceUsd
                        ? `$${formatNumber(tokenMetadata.tokenData.priceUsd)}`
                        : selectedCoin?.price || "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">Liquidity</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.liquidity
                        ? `$${formatNumber(tokenMetadata.tokenData.liquidity)}`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">Market Cap</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.marketCap
                        ? `$${formatNumber(tokenMetadata.tokenData.marketCap)}`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">FDV</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.fdv
                        ? `$${formatNumber(tokenMetadata.tokenData.fdv)}`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">Holders</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.holders !== undefined
                        ? formatNumber(tokenMetadata.tokenData.holders)
                        : "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">Supply</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.totalSupply
                        ? `${formatNumber(tokenMetadata.tokenData.totalSupply)}`
                        : "N/A"}
                    </span>
                  </div>
                </div>

                {/* Social Media Links */}
                {(tokenMetadata?.tokenData?.website ||
                  tokenMetadata?.tokenData?.twitter ||
                  tokenMetadata?.tokenData?.discord) && (
                  <div className="token-social">
                    <div className="token-social-title">Links</div>
                    <div className="token-social-links">
                      {tokenMetadata.tokenData.website && (
                        <a
                          href={
                            tokenMetadata.tokenData.website.startsWith("http")
                              ? tokenMetadata.tokenData.website
                              : `https://${tokenMetadata.tokenData.website}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="token-social-link"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="token-social-icon"
                          >
                            <path
                              fill="currentColor"
                              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
                            />
                          </svg>
                          Website
                        </a>
                      )}
                      {tokenMetadata.tokenData.twitter && (
                        <a
                          href={
                            tokenMetadata.tokenData.twitter.startsWith("http")
                              ? tokenMetadata.tokenData.twitter
                              : `https://twitter.com/${tokenMetadata.tokenData.twitter.replace(
                                  "@",
                                  ""
                                )}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="token-social-link"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="token-social-icon"
                          >
                            <path
                              fill="currentColor"
                              d="M22.46 6c-.77.35-1.6.58-2.46.69.88-.53 1.56-1.37 1.88-2.38-.83.5-1.75.85-2.72 1.05C18.37 4.5 17.26 4 16 4c-2.35 0-4.27 1.92-4.27 4.29 0 .34.04.67.11.98C8.28 9.09 5.11 7.38 3 4.79c-.37.63-.58 1.37-.58 2.15 0 1.49.75 2.81 1.91 3.56-.71 0-1.37-.2-1.95-.5v.03c0 2.08 1.48 3.82 3.44 4.21a4.22 4.22 0 0 1-1.93.07 4.28 4.28 0 0 0 4 2.98 8.521 8.521 0 0 1-5.33 1.84c-.34 0-.68-.02-1.02-.06C3.44 20.29 5.7 21 8.12 21 16 21 20.33 14.46 20.33 8.79c0-.19 0-.37-.01-.56.84-.6 1.56-1.36 2.14-2.23z"
                            />
                          </svg>
                          Twitter
                        </a>
                      )}
                      {tokenMetadata.tokenData.discord && (
                        <a
                          href={
                            tokenMetadata.tokenData.discord.startsWith("http")
                              ? tokenMetadata.tokenData.discord
                              : `https://discord.gg/${tokenMetadata.tokenData.discord}`
                          }
                          target="_blank"
                          rel="noopener noreferrer"
                          className="token-social-link"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            className="token-social-icon"
                          >
                            <path
                              fill="currentColor"
                              d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"
                            />
                          </svg>
                          Discord
                        </a>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(
  withGlobal<OwnProps>((global): StateProps => {
    const tabState = selectTabState(global);

    return {
      isOpen: Boolean(tabState.isTradingColumnShown),
      selectedCoin: tabState.selectedTradingCoin,
      selectedMintAddress: tabState.selectedTradingMintAddress,
      currentUserId: global.currentUserId,
    };
  })(RightColumnTrading)
);
