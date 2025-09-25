import { memo, useEffect, useState } from "../../lib/teact/teact";
import { withGlobal } from "../../global";
import { M7_API_URL } from "../../config";
import { formatNumber } from "../../util/formatNumber";

type StateProps = {
  currentUserId?: string;
};

type WalletHolding = {
  mintAddress: string;
  amount: number;
  symbol?: string | null;
  logoUri?: string | null;
};

const Footer = ({ currentUserId }: StateProps) => {
  const [usd, setUsd] = useState<number | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | undefined>();

  const [holdings, setHoldings] = useState<WalletHolding[] | undefined>();
  const [holdingsLoading, setHoldingsLoading] = useState(false);
  const [holdingsError, setHoldingsError] = useState<Error | undefined>();

  useEffect(() => {
    let isMounted = true;
    const fetchSolPrice = async () => {
      try {
        setIsLoading(true);
        const response = await fetch(`${M7_API_URL}/solana/price/sol`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (isMounted) {
          setUsd(data?.usd);
        }
      } catch (e: any) {
        if (isMounted) setError(e);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    void fetchSolPrice();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const fetchHoldings = async () => {
      if (!currentUserId) {
        setHoldings(undefined);
        return;
      }
      try {
        setHoldingsLoading(true);
        const response = await fetch(`${M7_API_URL}/user/get-wallet-holdings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ telegramUserId: currentUserId }),
        });
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (isMounted) {
          setHoldings(Array.isArray(data?.holdings) ? data.holdings : []);
        }
      } catch (e: any) {
        if (isMounted) setHoldingsError(e);
      } finally {
        if (isMounted) setHoldingsLoading(false);
      }
    };

    void fetchHoldings();
    return () => {
      isMounted = false;
    };
  }, [currentUserId]);

  const displayUsd = usd !== undefined ? `$${formatNumber(usd)}` : undefined;

  return (
    <div className="app-footer" role="contentinfo" aria-label="Footer">
      <div className="footer-left">
        <div className="brand">
          {isLoading ? (
            <span className="sol-price">...</span>
          ) : error ? (
            <span className="sol-price">—</span>
          ) : (
            <span className="sol-price">{displayUsd}</span>
          )}
          <img
            className="balance-icon"
            src="/solana/Solana(Colored).svg"
            alt="SOL"
          />
        </div>
        <div className="wallet-tracker">
          <img
            className="wallet-icon"
            src="/svg/footer/wallet.svg"
            alt="Wallet"
          />
          <span className="wallet-text">Wallet tracker</span>
          <span className="wallet-holdings">
            {holdingsLoading ? (
              <span>...</span>
            ) : holdingsError ? (
              <span>—</span>
            ) : holdings && holdings.length > 0 ? (
              <>
                {holdings.map((h) => (
                  <span className="wallet-holding-item" key={h.mintAddress}>
                    {h.logoUri ? (
                      <img
                        className="wallet-token-logo"
                        src={h.logoUri}
                        alt={h.symbol || h.mintAddress}
                        width={14}
                        height={14}
                      />
                    ) : null}
                    <span className="wallet-holding-symbol">
                      {h.symbol || h.mintAddress.slice(0, 4)}
                    </span>
                    <span className="wallet-holding-amount">
                      {formatNumber(h.amount)}
                    </span>
                  </span>
                ))}
              </>
            ) : (
              <span>0 tokens</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
};

export default memo(
  withGlobal<{}>(
    (global): StateProps => ({
      currentUserId: global.currentUserId,
    })
  )(Footer)
);
