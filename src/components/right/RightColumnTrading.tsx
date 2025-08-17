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

import TVChart from "../tradingview/TVChart/TVChart";
import type {
  HMPoolTokenMetadata,
  M7TokenMetadataResponse,
} from "../../hooks/hellomoon/hmApi";
import {
  fetchPoolTokenMetadata,
  fetchTokenMetadata,
  buySwap,
  sellSwap,
  type BuySwapRequest,
  type SellSwapRequest,
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
  score: string;
  cap: string;
  holders: number;
  volume: string;
  change: string;
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

  // Token metadata state
  const [tokenMetadata, setTokenMetadata] = useState<
    M7TokenMetadataResponse | undefined
  >();
  const [isLoadingTokenMetadata, setIsLoadingTokenMetadata] = useState(false);
  const [tokenMetadataError, setTokenMetadataError] = useState<string | null>(
    null
  );

  // TVChart state and logic
  const [poolMetadata, setPoolMetadata] = useState<
    HMPoolTokenMetadata | undefined
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

  // Derived state for user holdings
  const userHoldings = useMemo(() => {
    return tokenMetadata?.userHoldings || 0;
  }, [tokenMetadata?.userHoldings]);

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
        console.log("[TokenMetadata] Successfully fetched:", data);
      })
      .catch((err) => {
        console.error("[TokenMetadata] Failed to load token metadata", err);
        setTokenMetadataError(err.message || "Failed to load token metadata");
        setIsLoadingTokenMetadata(false);
      });
  }, [selectedMintAddress, currentUserId]);

  // Use hardcoded pool address
  const poolAddress = "0x337b56d87a6185cd46af3ac2cdf03cbc37070c30";

  useEffect(() => {
    if (!poolAddress) return;

    console.log("[TVChart] Fetching pool metadata for:", poolAddress);
    setIsLoadingChart(true);
    setChartError(null);

    fetchPoolTokenMetadata(poolAddress)
      .then((data) => {
        setPoolMetadata(data);
        setIsLoadingChart(false);
      })
      .catch((err) => {
        console.error("[TVChart] Failed to load pool metadata", err);
        setChartError(err.message || "Failed to load chart data");
        setIsLoadingChart(false);
      });
  }, [poolAddress]);

  const TVChartElem = useMemo(() => {
    if (!poolMetadata) return null;
    return (
      <TVChart
        poolMetadata={poolMetadata}
        settings={{ chartType: "price", currency: "usd" }}
      />
    );
  }, [poolMetadata]);

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
      const swapRequest: BuySwapRequest = {
        telegramUserId: currentUserId,
        inputAmount: amount,
        outputMintAddress: selectedMintAddress,
      };

      console.log("Executing buy swap:", swapRequest);
      const result = await buySwap(swapRequest);
      console.log("Buy swap successful:", result);

      // Store the transaction ID for display
      setLastTransactionId(result.transactionId);

      // Refresh token metadata to get updated token count
      if (selectedMintAddress && currentUserId) {
        fetchTokenMetadata(selectedMintAddress, currentUserId)
          .then((data) => {
            setTokenMetadata(data);
            console.log("[TokenMetadata] Refreshed after buy swap:", data);
          })
          .catch((err) => {
            console.error(
              "[TokenMetadata] Failed to refresh after buy swap:",
              err
            );
          });
      }

      // Refresh wallet balance in profile
      if (typeof (window as any).refreshWalletBalance === "function") {
        (window as any).refreshWalletBalance();
      }
    } catch (error: any) {
      console.error("Buy swap failed:", error);

      // Extract error message from response
      let errorMessage = "Transaction failed. Please try again.";
      if (error?.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      setSwapError(errorMessage);
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
      const swapRequest: SellSwapRequest = {
        telegramUserId: currentUserId,
        inputAmount: amount,
        inputMintAddress: selectedMintAddress,
      };

      console.log("Executing sell swap:", swapRequest);
      const result = await sellSwap(swapRequest);
      console.log("Sell swap successful:", result);

      // Store the transaction ID for display
      setLastTransactionId(result.transactionId);

      // Refresh token metadata to get updated token count
      if (selectedMintAddress && currentUserId) {
        fetchTokenMetadata(selectedMintAddress, currentUserId)
          .then((data) => {
            setTokenMetadata(data);
            console.log("[TokenMetadata] Refreshed after sell swap:", data);
          })
          .catch((err) => {
            console.error(
              "[TokenMetadata] Failed to refresh after sell swap:",
              err
            );
          });
      }

      // Refresh wallet balance in profile
      if (typeof (window as any).refreshWalletBalance === "function") {
        (window as any).refreshWalletBalance();
      }
    } catch (error: any) {
      console.error("Sell swap failed:", error);

      // Extract error message from response
      let errorMessage = "Transaction failed. Please try again.";
      if (error?.response?.data?.message) {
        errorMessage = error.response.data.message;
      } else if (error?.message) {
        errorMessage = error.message;
      }

      setSwapError(errorMessage);
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
                        {tokenMetadata?.tokenData?.liquidity?.toLocaleString() ||
                          selectedCoin?.cap ||
                          "N/A"}
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
                          {tokenMetadata?.tokenData?.holders?.toLocaleString() ||
                            selectedCoin?.holders?.toLocaleString() ||
                            "N/A"}
                        </span>
                      </div>
                      <span className="stat-separator">|</span>
                      <div className="stat-item">
                        $
                        <span className="stat-value">
                          {tokenMetadata?.tokenData?.price
                            ? parseFloat(tokenMetadata.tokenData.price).toFixed(
                                6
                              )
                            : selectedCoin?.score || "N/A"}
                        </span>
                      </div>
                      <span className="stat-separator">|</span>
                      {/* <div className="stat-item">
                        <img
                          src="/svg/chart.svg"
                          alt="volume"
                          className="stat-icon"
                          width="11"
                          height="10"
                        />
                        <span className="stat-value">
                          {tokenMetadata?.tokenData?.marketCap?.toLocaleString() ||
                            selectedCoin?.volume ||
                            "N/A"}
                        </span>
                      </div> */}
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
                          {tokenMetadata?.tokenData?.marketCap?.toLocaleString() ||
                            selectedCoin?.change ||
                            "N/A"}
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
                      <button className="input-button edit-button">
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
                  className={`buy-now-button ${isSwapLoading ? "loading" : ""}`}
                  onClick={handleSwap}
                  disabled={isSwapLoading}
                >
                  {isSwapLoading ? (
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
                      Processing...
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
                    <div className="error-message">{swapError}</div>
                    {swapError.includes("check transaction") &&
                      swapError.match(/[A-Za-z0-9]{44}/g) && (
                        <div className="transaction-id">
                          <span className="transaction-label">
                            Check status:
                          </span>
                          <a
                            className="solscan-link"
                            href={`https://solscan.io/tx/${
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

                <div className="trade-stats">
                  <div className="trade-stat">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M14 11V8C14 6.34 12.66 5 11 5H4C2.34 5 1 6.34 1 8V11C1 12.66 2.34 14 4 14H6L8 17H10L8 14H11C12.66 14 14 12.66 14 11Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                      />
                      <path
                        d="M21 16V19C21 20.1 20.1 21 19 21H16C14.9 21 14 20.1 14 19V16C14 14.9 14.9 14 16 14H19C20.1 14 21 14.9 21 16Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                      />
                    </svg>
                    <span className="trade-stat-value">0.01</span>
                  </div>
                  <div className="trade-stat">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        d="M16 8L8 16"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                      <path
                        d="M8 8H16V16"
                        stroke="currentColor"
                        strokeWidth="2"
                      />
                    </svg>
                    <span className="trade-stat-value">30%</span>
                  </div>
                  <div className="trade-stat">
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M7 10V12C7 13.1 7.9 14 9 14H12V17L17 12L12 7V10H7Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        fill="none"
                      />
                    </svg>
                    <span className="trade-stat-value">0.01</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Pools section */}
            <div className="trade-section">
              <div className="trade-section-content">
                <div className="pools-tabs">
                  <button
                    className={`pool-tab ${
                      selectedPoolTab === "P1" ? "pool-tab-active" : ""
                    }`}
                    onClick={() => setSelectedPoolTab("P1")}
                  >
                    P1
                  </button>
                  <button
                    className={`pool-tab ${
                      selectedPoolTab === "P2" ? "pool-tab-active" : ""
                    }`}
                    onClick={() => setSelectedPoolTab("P2")}
                  >
                    P2
                  </button>
                  <button
                    className={`pool-tab ${
                      selectedPoolTab === "P3" ? "pool-tab-active" : ""
                    }`}
                    onClick={() => setSelectedPoolTab("P3")}
                  >
                    P3
                  </button>
                </div>

                <div className="token-metrics">
                  <div className="token-metric">
                    <span className="token-metric-label">Price</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.price
                        ? `$${parseFloat(tokenMetadata.tokenData.price).toFixed(
                            6
                          )}`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">Liquidity</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.liquidity
                        ? `$${(
                            parseFloat(tokenMetadata.tokenData.liquidity) /
                            1000000
                          ).toFixed(2)}M`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">Market Cap</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.marketCap
                        ? `$${(
                            parseFloat(tokenMetadata.tokenData.marketCap) /
                            1000000
                          ).toFixed(2)}M`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">FDV</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.fdv
                        ? `$${(
                            parseFloat(tokenMetadata.tokenData.fdv) / 1000000
                          ).toFixed(2)}M`
                        : "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">Holders</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.holders
                        ? tokenMetadata.tokenData.holders.toLocaleString()
                        : "N/A"}
                    </span>
                  </div>
                  <div className="token-metric">
                    <span className="token-metric-label">Supply</span>
                    <span className="token-metric-value">
                      {tokenMetadata?.tokenData?.totalSupply
                        ? `${(
                            parseFloat(tokenMetadata.tokenData.totalSupply) /
                            1000000
                          ).toFixed(2)}M`
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
