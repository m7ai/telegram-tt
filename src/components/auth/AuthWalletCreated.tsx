import { memo, useState } from "../../lib/teact/teact";
import { getActions, withGlobal } from "../../global";
import axios from "axios";

import type { GlobalState } from "../../global/types";
import type { ApiUser } from "../../api/types";

import useLang from "../../hooks/useLang";
import useLastCallback from "../../hooks/useLastCallback";
import useMultiaccountInfo from "../../hooks/useMultiaccountInfo";

import { VIVA_API_KEY, M7_API_URL } from "../../config";

import Icon from "../common/icons/Icon";
import Button from "../ui/Button";

import { navigateBack } from "./helpers/backNavigation";
import { selectUser } from "../../global/selectors/users";

type StateProps = Pick<
  GlobalState,
  "connectionState" | "authState" | "currentUserId"
> & {
  currentUser?: ApiUser;
};

const AuthWalletCreated = ({
  connectionState,
  authState,
  currentUser,
}: StateProps) => {
  const lang = useLang();
  const [isCreating, setIsCreating] = useState(false);
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [privateKey, setPrivateKey] = useState<string>("");
  const [walletId, setWalletId] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [copySuccess, setCopySuccess] = useState<boolean>(false);
  const [hasClickedCopy, setHasClickedCopy] = useState<boolean>(false);
  const [hasConfirmedSaved, setHasConfirmedSaved] = useState<boolean>(false);

  const accountsInfo = useMultiaccountInfo();
  const hasActiveAccount = Object.values(accountsInfo).length > 0;

  const handleBackNavigation = useLastCallback(() => {
    navigateBack();
  });

  const handleContinue = useLastCallback(async () => {
    // Check if we should use mock data (when APP_MOCKED_CLIENT=1)
    const isMocked = process.env.APP_MOCKED_CLIENT === "1";

    // Only check for currentUser if not in mock mode
    if (!isMocked && !currentUser) {
      setError("No user data available");
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      if (isMocked) {
        // Mock delay to simulate API call
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Mock wallet data for testing
        const mockWalletData = {
          walletAddress: "0x742d35Cc6e6B8b9f8a3D8C4e2b5c7a8F9b2e6c8d",
          privateKey:
            "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          walletId: "turnkey-wallet-" + Math.random().toString(36).substr(2, 9),
        };

        setWalletAddress(mockWalletData.walletAddress);
        setPrivateKey(mockWalletData.privateKey);
        setWalletId(mockWalletData.walletId);
      } else {
        // Call the backend to create Turnkey wallet
        const response = await axios.post(
          `${M7_API_URL}/user/create-wallet`,
          {
            telegramUserId: currentUser?.id,
            telegramAccessHash: currentUser?.accessHash,
            telegramPhoneNumber: currentUser?.phoneNumber,
            telegramFirstName: currentUser?.firstName,
            telegramLastName: currentUser?.lastName,
            telegramUsername: currentUser?.usernames?.[0]?.username,
            telegramIsPremium: currentUser?.isPremium,
            telegramIsVerified: currentUser?.isVerified,
            telegramIsContact: currentUser?.isContact,
            telegramIsSelf: currentUser?.isSelf,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-api-key": VIVA_API_KEY, // Add API key if required
            },
          }
        );

        setWalletAddress(response.data.walletAddress);
        setPrivateKey(response.data.privateKey);
        setWalletId(response.data.walletId);
      }

      // No automatic navigation - user must click Continue button
    } catch (err) {
      console.error("Failed to create wallet:", err);
      if (axios.isAxiosError(err)) {
        const message =
          err.response?.data?.message ||
          err.message ||
          "Failed to create wallet";
        setError(message);
      } else {
        setError(
          err instanceof Error ? err.message : "Failed to create wallet"
        );
      }
    } finally {
      setIsCreating(false);
    }
  });

  const handleCopyWalletAddress = useLastCallback(() => {
    if (navigator.clipboard && walletAddress) {
      navigator.clipboard.writeText(walletAddress);
    }
  });

  const handleCopyPrivateKey = useLastCallback(() => {
    if (navigator.clipboard && privateKey) {
      navigator.clipboard.writeText(privateKey);
    }
  });

  const handleCopyAllPrivateKeys = useLastCallback(async () => {
    if (navigator.clipboard && walletAddress && privateKey) {
      const allKeys = `Wallet Address: ${walletAddress}\nPrivate Key: ${privateKey}`;
      await navigator.clipboard.writeText(allKeys);
      setCopySuccess(true);
      setHasClickedCopy(true);

      // Reset after 2 seconds
      setTimeout(() => {
        setCopySuccess(false);
      }, 2000);
    }
  });

  const handleProceedToApp = useLastCallback(() => {
    // Transition to main app by setting auth state to ready
    const { apiUpdate } = getActions();
    apiUpdate({
      "@type": "updateAuthorizationState",
      authorizationState: "authorizationStateReady",
    });
  });

  const handleCheckboxChange = useLastCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setHasConfirmedSaved(e.target.checked);
    }
  );

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
          <h1 className="auth-title">
            {isCreating
              ? "Creating Wallet..."
              : walletAddress
              ? "Save your private keys"
              : lang("WalletCreatedTitle")}
          </h1>
          <p className="note">
            {isCreating
              ? "Creating your secure Turnkey wallet..."
              : walletAddress
              ? "These are your private keys. Please keep them safe."
              : lang("WalletCreatedMessage")}
          </p>

          {error && (
            <div className="error-message" data-error="true">
              {error}
            </div>
          )}

          {walletAddress && (
            <div className="private-keys-section">
              <div className="private-key-item">
                <div className="private-key-label">Wallet Address:</div>
                <div className="private-key-value">
                  <span className="private-key-text">{walletAddress}</span>
                </div>
              </div>

              {privateKey && (
                <div className="private-key-item">
                  <div className="private-key-label">Private Key:</div>
                  <div className="private-key-value">
                    <span className="private-key-text private-key-sensitive">
                      {privateKey}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {walletAddress && (
            <div className="copy-all-keys-container">
              <div
                className={`copy-all-keys-button ${
                  copySuccess ? "success" : ""
                }`}
                onClick={handleCopyAllPrivateKeys}
              >
                <Icon name={copySuccess ? "check" : "copy"} />
                {copySuccess ? "Copied!" : "Copy private keys"}
              </div>
            </div>
          )}
        </div>
        <div className="auth-footer">
          {hasClickedCopy && (
            <div className="private-keys-warning">
              <div className="checkbox-container">
                <input
                  type="checkbox"
                  id="keys-saved-checkbox"
                  className="keys-saved-checkbox"
                  onChange={handleCheckboxChange}
                  checked={hasConfirmedSaved}
                />
                <label htmlFor="keys-saved-checkbox" className="checkbox-label">
                  I have saved my private keys
                </label>
              </div>
              <p className="warning-subtitle">
                This is your final chance to save these, you will not be able to
                retrieve them again.
              </p>
            </div>
          )}
          <Button
            className={`login-button ${
              walletAddress && hasClickedCopy && !hasConfirmedSaved
                ? "disabled"
                : ""
            }`}
            onClick={walletAddress ? handleProceedToApp : handleContinue}
            disabled={
              isCreating ||
              ((walletAddress && hasClickedCopy && !hasConfirmedSaved) as any)
            }
          >
            {isCreating
              ? "Creating..."
              : walletAddress
              ? "Continue to App"
              : "Create Wallet"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default memo(
  withGlobal((global): StateProps => {
    const currentUser = global.currentUserId
      ? selectUser(global, global.currentUserId)
      : undefined;

    return {
      connectionState: global.connectionState,
      authState: global.authState,
      currentUserId: global.currentUserId,
      currentUser,
    };
  })(AuthWalletCreated)
);
