import { memo } from "../../lib/teact/teact";
import { getActions, withGlobal } from "../../global";

import type { GlobalState } from "../../global/types";

import useLang from "../../hooks/useLang";
import useLastCallback from "../../hooks/useLastCallback";
import useMultiaccountInfo from "../../hooks/useMultiaccountInfo";

import Icon from "../common/icons/Icon";
import Button from "../ui/Button";

import { navigateBack } from "./helpers/backNavigation";

type StateProps = Pick<GlobalState, "connectionState" | "authState">;

const AuthWalletCreated = ({ connectionState, authState }: StateProps) => {
  const lang = useLang();

  const accountsInfo = useMultiaccountInfo();
  const hasActiveAccount = Object.values(accountsInfo).length > 0;

  // Mock private keys - in real implementation these would come from wallet generation
  const solanaPrivateKey = "4g8KdF9xLaB5wr7EuU6BRkZzYxF2PTjBEkj5U3sbxvQd";
  const tronPrivateKey = "TXb7vFZNwa3E7YuR6PXaVu6JdjdM9FbWTd";

  const handleBackNavigation = useLastCallback(() => {
    navigateBack();
  });

  const handleContinue = useLastCallback(() => {
    // Transition to main app by setting auth state to ready
    const { apiUpdate } = getActions();
    apiUpdate({
      "@type": "updateAuthorizationState",
      authorizationState: "authorizationStateReady",
    });
  });

  const handleCopyPrivateKey = useLastCallback((privateKey: string) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(privateKey);
    }
  });

  const handleCopyAllKeys = useLastCallback(() => {
    const allKeys = `Solana (SOL): ${solanaPrivateKey}\nTron (TRX): ${tronPrivateKey}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(allKeys);
    }
  });

  return (
    <div id="auth-wallet-created-form" className="custom-scroll">
      {hasActiveAccount && (
        <Button
          size="smaller"
          round
          color="translucent"
          className="auth-close"
          onClick={handleBackNavigation}
        >
          <Icon name="close" />
        </Button>
      )}
      <div className="auth-container">
        <div className="auth-header">
          <div className="auth-header-title">Wallet created</div>
        </div>
        <div className="auth-form wallet">
          <div className="wallet-success-icon">
            <img src="./svg/wallet-created.svg" alt="Wallet Created" />
          </div>
          <h1 className="auth-title">{lang("WalletCreatedTitle")}</h1>
          <p className="note">{lang("WalletCreatedMessage")}</p>

          <div className="private-keys-section">
            <div className="private-key-item">
              <div className="private-key-label">Solana (SOL):</div>
              <div className="private-key-value">
                <span className="private-key-text">{solanaPrivateKey}</span>
                <button
                  className="copy-private-key-button"
                  aria-label="Copy Solana private key"
                  onClick={() => handleCopyPrivateKey(solanaPrivateKey)}
                >
                  <Icon name="copy" />
                </button>
              </div>
            </div>
          </div>
        </div>
        <div className="auth-footer">
          <Button className="login-button" onClick={handleContinue}>
            {lang("Create")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default memo(
  withGlobal((global): StateProps => {
    return {
      connectionState: global.connectionState,
      authState: global.authState,
    };
  })(AuthWalletCreated)
);
