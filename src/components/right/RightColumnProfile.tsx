import type { FC } from "../../lib/teact/teact";
import { memo, useMemo, useState, useEffect } from "../../lib/teact/teact";
import { getActions, withGlobal } from "../../global";

import type { ApiUser } from "../../api/types";

import { selectUser } from "../../global/selectors";
import { selectTabState } from "../../global/selectors/tabs";
import buildClassName from "../../util/buildClassName";

import useLang from "../../hooks/useLang";
import useAsync from "../../hooks/useAsync";
import { formatNumber } from "../../util/formatNumber";

import Button from "../ui/Button";

import "./RightColumnProfile.scss";

type OwnProps = {
  isActive: boolean;
  onClose: () => void;
};

type StateProps = {
  currentUser?: ApiUser;
  isTradingColumnShown?: boolean;
  currentUserId?: string;
};

type WalletData = {
  walletAddress: string;
  balance: number;
  balanceLamports: number;
  telegramUserId: string;
  message: string;
};

type TokenData = {
  mintAddress: string;
  symbol?: string;
  name?: string;
  decimals?: number;
  logoUri?: string;
  price?: string;
  liquidity?: string;
  marketCap?: string;
  holders?: number;
  website?: string;
  twitter?: string;
};

type AggregatedPipelineItem = {
  id: string;
  mintAddress: string;
  activeCount: number;
  createdAt: string;
  lastModifiedAt: string;
  tokenData?: TokenData;
};

type PaginationMeta = {
  currentPage: number;
  limit: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
};

type AggregatedPipelineResponse = {
  telegramUserId: string;
  data: AggregatedPipelineItem[];
  pagination: PaginationMeta;
  message: string;
};

type AggregatedPipelineCountResponse = {
  telegramUserId: string;
  count: number;
  message: string;
};

const RightColumnProfile: FC<OwnProps & StateProps> = ({
  isActive,
  onClose,
  currentUser,
  isTradingColumnShown,
  currentUserId,
}) => {
  const { openTradingColumn } = getActions();
  const lang = useLang();
  const [isCoinsExpanded, setIsCoinsExpanded] = useState(true);
  const [selectedCoinId, setSelectedCoinId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [coinsPerPage] = useState(10);
  const [logoLoadErrors, setLogoLoadErrors] = useState<Set<string>>(new Set());
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [lastRefreshTime, setLastRefreshTime] = useState<number>(0);

  const className = buildClassName("RightColumnProfile", isActive && "active");

  // Fetch wallet balance function
  const fetchWalletBalance = async (): Promise<WalletData | undefined> => {
    if (!currentUserId) {
      return undefined;
    }

    try {
      const response = await fetch("http://localhost:8888/user/get-balance", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          telegramUserId: currentUserId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Failed to fetch wallet balance:", error);
      throw error;
    }
  };

  // Fetch aggregated pipeline count function
  const fetchAggregatedPipelineCount = async (): Promise<
    AggregatedPipelineCountResponse | undefined
  > => {
    if (!currentUserId) {
      return undefined;
    }

    try {
      const response = await fetch(
        "http://localhost:8888/user/get-aggregated-pipeline-count",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            telegramUserId: currentUserId,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Failed to fetch aggregated pipeline count:", error);
      throw error;
    }
  };

  // Fetch aggregated pipeline data function
  const fetchAggregatedPipelineData = async (): Promise<
    AggregatedPipelineResponse | undefined
  > => {
    if (!currentUserId) {
      return undefined;
    }

    try {
      const response = await fetch(
        "http://localhost:8888/user/get-aggregated-pipeline",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            telegramUserId: currentUserId,
            page: currentPage,
            limit: coinsPerPage,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Failed to fetch aggregated pipeline data:", error);
      throw error;
    }
  };

  // Add a refresh trigger for wallet balance
  const [walletRefreshTrigger, setWalletRefreshTrigger] = useState(0);

  // Create a refresh function that can be called from outside
  const refreshWalletBalance = () => {
    setWalletRefreshTrigger((prev) => prev + 1);
  };

  // Expose the refresh function globally for other components to use
  useEffect(() => {
    (window as any).refreshWalletBalance = refreshWalletBalance;
    return () => {
      delete (window as any).refreshWalletBalance;
    };
  }, []);

  // Listen for pipeline data refresh events with rate limiting
  useEffect(() => {
    const handleRefreshPipelineData = () => {
      const now = Date.now();
      const RATE_LIMIT_MS = 5000; // 5 seconds

      // Check if enough time has passed since last refresh
      if (now - lastRefreshTime < RATE_LIMIT_MS) {
        console.log(
          `🔄 Refresh rate limited. Last refresh was ${Math.round(
            (now - lastRefreshTime) / 1000
          )}s ago, minimum interval is ${RATE_LIMIT_MS / 1000}s`
        );
        return;
      }

      console.log("🔄 Received refreshPipelineData event, refreshing data...");
      setLastRefreshTime(now);
      setRefreshTrigger((prev) => prev + 1);
      setWalletRefreshTrigger((prev) => prev + 1);
    };

    window.addEventListener("refreshPipelineData", handleRefreshPipelineData);

    return () => {
      window.removeEventListener(
        "refreshPipelineData",
        handleRefreshPipelineData
      );
    };
  }, [lastRefreshTime]);

  // Use async hook to fetch wallet data
  const {
    result: walletData,
    isLoading: isWalletLoading,
    error: walletError,
  } = useAsync(fetchWalletBalance, [currentUserId, walletRefreshTrigger]);

  // Use async hook to fetch aggregated pipeline count
  const {
    result: countData,
    isLoading: isCountLoading,
    error: countError,
  } = useAsync(fetchAggregatedPipelineCount, [currentUserId, refreshTrigger]);

  // Use async hook to fetch aggregated pipeline data
  const {
    result: pipelineData,
    isLoading: isPipelineLoading,
    error: pipelineError,
  } = useAsync(fetchAggregatedPipelineData, [
    currentUserId,
    currentPage,
    coinsPerPage,
    refreshTrigger,
  ]);

  // Helper function to shorten wallet address
  const shortenAddress = (address: string) => {
    if (!address) return "";
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
  };

  // Get display values
  const displayAddress = walletData?.walletAddress || "";
  const shortAddress = shortenAddress(displayAddress);
  const displayBalance = formatNumber(walletData?.balance);

  const toggleCoinsVisibility = () => {
    setIsCoinsExpanded(!isCoinsExpanded);
  };

  const handleCoinClick = (item: AggregatedPipelineItem) => {
    setSelectedCoinId(item.id);

    const coinData = {
      id: item.id,
      name: item.tokenData?.name || item.tokenData?.symbol || "Unknown Token",
      subtitle: `Mint: ${item.mintAddress.slice(0, 8)}...`,
      time: "Active",
      comments: formatNumber(item.activeCount),
      score: formatNumber(item.activeCount),
      cap: formatNumber(item.tokenData?.liquidity),
      holders: item.tokenData?.holders || 0,
      volume: formatNumber(item.tokenData?.marketCap),
      change: formatNumber(item.tokenData?.price),
    };

    openTradingColumn({
      coin: coinData,
      mintAddress: item.mintAddress,
    });

    console.log("✅ openTradingColumn action dispatched");
  };

  // Deselect coin when trading column closes
  useEffect(() => {
    if (!isTradingColumnShown && selectedCoinId) {
      setSelectedCoinId(null);
    }
  }, [isTradingColumnShown, selectedCoinId]);

  return (
    <div className={className}>
      {/* Header Section - Following AppSidebar design */}
      <div className="sidebar-header">
        <div className="brand-section">
          <span className="moonraker-brand-text">Moonraker</span>
        </div>

        <div className="wallet-section">
          <div className="wallet-column">
            <span className="wallet-label">Wallet address</span>
            <div className="wallet-value-group">
              {isWalletLoading ? (
                <span className="wallet-address loading">Loading...</span>
              ) : walletError ? (
                <span className="wallet-address error">
                  Error loading wallet
                </span>
              ) : (
                <span className="wallet-address" title={displayAddress}>
                  {shortAddress || "No wallet found"}
                </span>
              )}
              <button
                className="copy-button"
                aria-label="Copy wallet address"
                onClick={() => {
                  if (displayAddress) {
                    navigator.clipboard.writeText(displayAddress);
                  }
                }}
                disabled={!displayAddress}
              >
                <svg
                  className="copy-icon"
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path>
                </svg>
              </button>
            </div>
          </div>
          <div className="balance-column">
            <span className="balance-label">Balance</span>
            <div className="balance-value-group">
              {isWalletLoading ? (
                <span className="balance-amount loading">Loading...</span>
              ) : walletError ? (
                <span className="balance-amount error">Error</span>
              ) : (
                <span className="balance-amount">{displayBalance}</span>
              )}
              <img
                className="balance-icon"
                src="/solana/Solana (SOL).svg"
                alt="Solana"
                width="12"
                height="10"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Content Section */}
      <div className="sidebar-content">
        <div className="search-section">
          <div className="search-input-wrapper">
            <svg
              className="search-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <path d="m21 21-4.35-4.35"></path>
            </svg>
            <input
              type="text"
              placeholder="Search coins"
              className="search-input"
            />
          </div>
        </div>

        <div className="coins-group">
          <div className="group-label" onClick={toggleCoinsVisibility}>
            <span>
              Scanned coins (
              {isCountLoading
                ? "..."
                : countError
                ? "0"
                : countData?.count || 0}
              )
            </span>
            <svg
              className={buildClassName(
                "chevron-icon",
                !isCoinsExpanded && "collapsed"
              )}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6,9 12,15 18,9"></polyline>
            </svg>
          </div>
          {isCoinsExpanded && (
            <div className="coins-content">
              {isPipelineLoading ? (
                <div className="loading-state">Loading scanned coins...</div>
              ) : pipelineError ? (
                <div className="error-state">Error loading coins</div>
              ) : !pipelineData?.data?.length ? (
                <div className="empty-state">No scanned coins found</div>
              ) : (
                <>
                  <div className="coins-list">
                    {pipelineData.data.map((item) => (
                      <div
                        key={item.id}
                        className={buildClassName(
                          "coin-item",
                          "clickable",
                          selectedCoinId === item.id && "selected"
                        )}
                        onClick={() => handleCoinClick(item)}
                      >
                        {/* Top row: Avatar, Name with copy icon, Time, and Metrics */}
                        <div className="coin-top-row">
                          <div className="coin-left">
                            <div className="">
                              {item.tokenData?.logoUri &&
                              !logoLoadErrors.has(item.id) ? (
                                <img
                                  src={item.tokenData.logoUri}
                                  alt="Token logo"
                                  className="token-logo"
                                  width="24"
                                  height="24"
                                  onError={() => {
                                    setLogoLoadErrors((prev) =>
                                      new Set(prev).add(item.id)
                                    );
                                  }}
                                />
                              ) : (
                                <div className="coin-avatar" />
                              )}
                            </div>
                            <div className="coin-content">
                              <div className="coin-info">
                                <span className="coin-name">
                                  {item.tokenData?.name ||
                                    item.tokenData?.symbol ||
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    navigator.clipboard.writeText(
                                      item.mintAddress
                                    );
                                  }}
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
                              <div className="coin-subtitle-row">
                                <p className="coin-subtitle">
                                  {item.mintAddress.slice(0, 8)}...
                                  {item.mintAddress.slice(-4)}
                                </p>
                              </div>
                            </div>
                          </div>

                          <div className="coin-metrics">
                            <div className="metric-badge">
                              <img
                                src="/svg/chat.svg"
                                alt="chat"
                                className="message-icon"
                                width="14"
                                height="14"
                              />
                              <span className="metric-value">
                                {formatNumber(item.activeCount)}
                              </span>
                            </div>
                            {/* <div className="metric-badge">
                              <img
                                src="/svg/radar.svg"
                                alt="radar"
                                className="sparkles-icon"
                                width="14"
                                height="14"
                              />
                              <span className="metric-value">
                                {formatNumber(item.activeCount)}
                              </span>
                            </div> */}
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
                              {formatNumber(item.tokenData?.liquidity)}
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
                                {formatNumber(item.tokenData?.holders)}
                              </span>
                            </div>
                            <span className="stat-separator">|</span>
                            <div className="stat-item">
                              <span className="stat-value">$</span>
                              <span className="stat-value change-value">
                                {formatNumber(item.tokenData?.price)}
                              </span>
                            </div>
                            {/* <span className="stat-separator">|</span>
                            <div className="stat-item">
                              <img
                                src="/svg/chart.svg"
                                alt="volume"
                                className="stat-icon"
                                width="11"
                                height="10"
                              />
                              <span className="stat-value">
                                {formatNumber(item.tokenData?.marketCap)}
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
                                {formatNumber(item.tokenData?.marketCap)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Pagination Controls */}
                  {pipelineData.pagination.totalPages > 1 && (
                    <div className="pagination-controls">
                      <button
                        className="pagination-button"
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={!pipelineData.pagination.hasPrevious}
                      >
                        Previous
                      </button>
                      <span className="pagination-info">
                        Page {pipelineData.pagination.currentPage} of{" "}
                        {pipelineData.pagination.totalPages}
                      </span>
                      <button
                        className="pagination-button"
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={!pipelineData.pagination.hasNext}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Footer Section */}
      <div className="sidebar-footer">
        <div className="footer-left">
          <button className="footer-action-button clear-button">
            <svg
              className="clear-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            </svg>
            Clear coins
          </button>
        </div>
        <div className="footer-right">
          <button className="footer-action-button buy-button">
            <svg
              className="zap-icon"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polygon points="13,2 3,14 12,14 11,22 21,10 12,10 13,2"></polygon>
            </svg>
            Buy
          </button>
          <div className="input-menu-container">
            <input
              type="text"
              className="buy-amount-input"
              placeholder="0.1"
              defaultValue="0.1"
            />
            <button className="menu-button" aria-label="Menu">
              <img
                className="solana-icon"
                src="/solana/Solana (SOL)-grey.svg"
                alt="Solana"
                width="12"
                height="10"
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default memo(
  withGlobal<OwnProps>((global): StateProps => {
    const currentUser = global.currentUserId
      ? selectUser(global, global.currentUserId)
      : undefined;

    const tabState = selectTabState(global);

    return {
      currentUser,
      currentUserId: global.currentUserId,
      isTradingColumnShown: tabState.isTradingColumnShown,
    };
  })(RightColumnProfile)
);
