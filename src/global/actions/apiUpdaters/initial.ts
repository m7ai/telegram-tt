import type {
  ApiUpdateAuthorizationError,
  ApiUpdateAuthorizationState,
  ApiUpdateConnectionState,
  ApiUpdateCurrentUser,
  ApiUpdateServerTimeOffset,
  ApiUpdateSession,
} from "../../../api/types";
import type { LangCode } from "../../../types";
import type { RequiredGlobalActions } from "../../index";
import type { ActionReturnType, GlobalState } from "../../types";

import { IS_BYPASS_AUTH, IS_WALLET_CREATED } from "../../../config";
import { getCurrentTabId } from "../../../util/establishMultitabRole";
import {
  getShippingError,
  shouldClosePaymentModal,
} from "../../../util/getReadableErrorText";
import { unique } from "../../../util/iteratees";
import { oldSetLanguage } from "../../../util/oldLangProvider";
import { clearWebTokenAuth } from "../../../util/routing";
import { setServerTimeOffset } from "../../../util/serverTime";
import { updateSessionUserId } from "../../../util/sessions";
import { forceWebsync } from "../../../util/websync";
import { isChatChannel, isChatSuperGroup } from "../../helpers";
import { addActionHandler, getGlobal, setGlobal } from "../../index";
import { updateUser, updateUserFullInfo } from "../../reducers";
import { updateTabState } from "../../reducers/tabs";
import { selectTabState } from "../../selectors";
import { selectSharedSettings } from "../../selectors/sharedState";

addActionHandler("apiUpdate", (global, actions, update): ActionReturnType => {
  switch (update["@type"]) {
    case "updateApiReady":
      onUpdateApiReady(global);
      break;

    case "updateAuthorizationState":
      onUpdateAuthorizationState(global, update, actions);
      break;

    case "updateAuthorizationError":
      onUpdateAuthorizationError(global, update);
      break;

    case "updateWebAuthTokenFailed":
      onUpdateWebAuthTokenFailed(global);
      break;

    case "updateConnectionState":
      onUpdateConnectionState(global, actions, update);
      break;

    case "updateSession":
      onUpdateSession(global, actions, update);
      break;

    case "updateServerTimeOffset":
      onUpdateServerTimeOffset(update);
      break;

    case "updateCurrentUser":
      onUpdateCurrentUser(global, update, actions);
      break;

    case "requestReconnectApi":
      global = { ...global, isSynced: false };
      setGlobal(global);

      onUpdateConnectionState(global, actions, {
        "@type": "updateConnectionState",
        connectionState: "connectionStateConnecting",
      });
      actions.initApi();
      break;

    case "requestSync":
      actions.sync();
      break;

    case "updateFetchingDifference":
      global = { ...global, isFetchingDifference: update.isFetching };
      setGlobal(global);
      break;

    case "error": {
      // Suppress errors in bypass auth mode
      if (IS_BYPASS_AUTH) {
        console.log(">>> SUPPRESSING ERROR - BYPASS AUTH MODE:", update.error);
        break;
      }

      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        const paymentShippingError = getShippingError(update.error);
        if (paymentShippingError) {
          actions.addPaymentError({ error: paymentShippingError, tabId });
        } else if (shouldClosePaymentModal(update.error)) {
          actions.closePaymentModal({ tabId });
        } else if (actions.showDialog) {
          actions.showDialog({ data: update.error, tabId });
        }
      });

      break;
    }

    case "notSupportedInFrozenAccount": {
      actions.showNotification({
        title: {
          key: "NotificationTitleNotSupportedInFrozenAccount",
        },
        message: {
          key: "NotificationMessageNotSupportedInFrozenAccount",
        },
        tabId: getCurrentTabId(),
      });
      break;
    }
  }
});

function onUpdateApiReady<T extends GlobalState>(global: T) {
  void oldSetLanguage(selectSharedSettings(global).language as LangCode);
}

function onUpdateAuthorizationState<T extends GlobalState>(
  global: T,
  update: ApiUpdateAuthorizationState,
  actions?: RequiredGlobalActions
) {
  global = getGlobal();

  const wasAuthReady = global.authState === "authorizationStateReady";
  const previousAuthState = global.authState;
  const authState = update.authorizationState;

  // In dev:WalletCreated mode, don't override ready state with other auth states
  // This prevents API from forcing back to auth flow after user clicks Create
  if (
    IS_WALLET_CREATED &&
    global.authState === "authorizationStateReady" &&
    authState !== "authorizationStateReady"
  ) {
    console.log("Preventing auth state override in dev:WalletCreated mode", {
      currentState: global.authState,
      attemptedState: authState,
    });
    return;
  }

  // Mark loading finished but defer changing authState to per-case handlers below
  global = {
    ...global,
    authIsLoading: false,
  };
  setGlobal(global);

  global = getGlobal();

  switch (authState) {
    case "authorizationStateLoggingOut":
      void forceWebsync(false);

      global = {
        ...global,
        authState: "authorizationStateLoggingOut",
        isLoggingOut: true,
      };
      setGlobal(global);
      break;
    case "authorizationStateWaitCode":
      global = {
        ...global,
        authState: "authorizationStateWaitCode",
        authIsCodeViaApp: update.isCodeViaApp,
      };
      setGlobal(global);
      break;
    case "authorizationStateWaitPassword":
      global = {
        ...global,
        authState: "authorizationStateWaitPassword",
        authHint: update.hint,
      };

      if (update.noReset) {
        global = {
          ...global,
          hasWebAuthTokenPasswordRequired: true,
        };
      }

      setGlobal(global);
      break;
    case "authorizationStateWaitQrCode":
      global = {
        ...global,
        authState: "authorizationStateWaitQrCode",
        authIsLoadingQrCode: false,
        authQrCode: update.qrCode,
      };
      setGlobal(global);
      break;
    case "authorizationStateReady": {
      console.log(
        "Authorization state ready. wasAuthReady:",
        wasAuthReady,
        "previousAuthState:",
        previousAuthState
      );
      if (wasAuthReady) {
        // Already in ready state; ensure it's set and exit
        global = {
          ...global,
          authState: "authorizationStateReady",
        };
        setGlobal(global);
        break;
      }

      void forceWebsync(true);

      // On first successful authorization, always show WalletCreated screen.
      // If returning from WalletCreated (user pressed Continue), proceed to ready.
      if (previousAuthState !== "authorizationStateWalletCreated") {
        global = {
          ...global,
          isLoggingOut: false,
          authState: "authorizationStateWalletCreated",
        };
        setGlobal(global);
        break;
      }

      // Coming back from WalletCreated → finish to ready and activate tabs
      global = {
        ...global,
        isLoggingOut: false,
        authState: "authorizationStateReady",
      };
      Object.values(global.byTabId).forEach(({ id: tabId }) => {
        global = updateTabState(
          global,
          {
            isInactive: false,
          },
          tabId
        );
      });
      setGlobal(global);

      break;
    }
    case "authorizationStateWalletCreated": {
      // Wallet creation state - user stays here until they proceed
      global = {
        ...global,
        authState: "authorizationStateWalletCreated",
        isLoggingOut: false,
      };
      setGlobal(global);
      break;
    }
  }
}

function onUpdateAuthorizationError<T extends GlobalState>(
  global: T,
  update: ApiUpdateAuthorizationError
) {
  // TODO: Investigate why TS is not happy with spread for lang related types
  global = {
    ...global,
  };
  global.authErrorKey = update.errorKey;
  setGlobal(global);
}

function onUpdateWebAuthTokenFailed<T extends GlobalState>(global: T) {
  clearWebTokenAuth();
  global = getGlobal();

  global = {
    ...global,
    hasWebAuthTokenFailed: true,
  };
  setGlobal(global);
}

function onUpdateConnectionState<T extends GlobalState>(
  global: T,
  actions: RequiredGlobalActions,
  update: ApiUpdateConnectionState
) {
  const { connectionState } = update;

  global = getGlobal();
  const tabState = selectTabState(global, getCurrentTabId());
  if (
    connectionState === "connectionStateReady" &&
    tabState.isMasterTab &&
    tabState.multitabNextAction
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (actions as any)[tabState.multitabNextAction.action](
      tabState.multitabNextAction.payload
    );
    actions.clearMultitabNextAction({ tabId: tabState.id });
  }

  if (connectionState === global.connectionState) {
    return;
  }

  global = {
    ...global,
    connectionState,
  };
  setGlobal(global);

  if (global.isSynced) {
    const channelStackIds = Object.values(global.byTabId)
      .flatMap((tab) => tab.messageLists)
      .map((messageList) => messageList.chatId)
      .filter((chatId) => {
        const chat = global.chats.byId[chatId];
        return chat && (isChatChannel(chat) || isChatSuperGroup(chat));
      });
    if (connectionState === "connectionStateReady" && channelStackIds.length) {
      unique(channelStackIds).forEach((chatId) => {
        actions.requestChannelDifference({ chatId });
      });
    }
  }

  if (connectionState === "connectionStateBroken") {
    actions.signOut({ forceInitApi: true });
  }
}

function onUpdateSession<T extends GlobalState>(
  global: T,
  actions: RequiredGlobalActions,
  update: ApiUpdateSession
) {
  const { sessionData } = update;
  const { authRememberMe, authState } = global;
  const isEmpty = !sessionData || !sessionData.mainDcId;

  const isTest = sessionData?.isTest;
  if (isTest) {
    global = {
      ...global,
      config: {
        ...global.config,
        isTestServer: isTest,
      },
    };
    setGlobal(global);
  }

  if (!authRememberMe || authState !== "authorizationStateReady" || isEmpty) {
    return;
  }

  actions.saveSession({ sessionData });
}

function onUpdateServerTimeOffset(update: ApiUpdateServerTimeOffset) {
  setServerTimeOffset(update.serverTimeOffset);
}

function onUpdateCurrentUser<T extends GlobalState>(
  global: T,
  update: ApiUpdateCurrentUser,
  actions?: RequiredGlobalActions
) {
  const { currentUser, currentUserFullInfo } = update;

  global = {
    ...updateUser(global, currentUser.id, currentUser),
    currentUserId: currentUser.id,
  };
  global = updateUserFullInfo(global, currentUser.id, currentUserFullInfo);
  setGlobal(global);

  updateSessionUserId(currentUser.id);

  // Check wallet after user is set and if we're in a state that should proceed to wallet creation
  const currentGlobal = getGlobal();
  console.log(
    "Current user set:",
    currentUser.id,
    "Auth state:",
    currentGlobal.authState
  );

  if (
    currentGlobal.authState === "authorizationStateWalletCreated" &&
    actions?.checkWallet
  ) {
    console.log("Calling checkWallet for current user:", currentUser.id);
    actions.checkWallet({ telegramUserId: currentUser.id });
  }
}
