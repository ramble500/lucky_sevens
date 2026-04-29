import { DiscordSDK } from "@discord/embedded-app-sdk";

const PARTICIPANTS_EVENT = "ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE";
const SDK_READY_TIMEOUT_MS = 6000;

function formatParticipant(participant) {
  return {
    id: participant.id,
    username: participant.username || "",
    globalName: participant.global_name || "",
    avatar: participant.avatar || null,
    bot: Boolean(participant.bot),
  };
}

function buildSnapshot(state) {
  return {
    mode: state.mode,
    ready: state.ready,
    canInvite: state.canInvite,
    reason: state.reason || "",
    participants: [...state.participants],
    error: state.error || null,
  };
}

function createBrowserBridge(reason, error = null) {
  const state = {
    mode: "browser",
    ready: false,
    canInvite: false,
    reason,
    participants: [],
    error,
  };

  return {
    ...buildSnapshot(state),
    sdk: null,
    getSnapshot() {
      return buildSnapshot(state);
    },
    onChange(listener) {
      listener(buildSnapshot(state));
      return () => {};
    },
    async refreshParticipants() {
      return [];
    },
    async openInviteDialog() {
      return false;
    },
    async dispose() {
      return undefined;
    },
  };
}

function withTimeout(promise, timeoutMs, timeoutReason) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(timeoutReason));
      }, timeoutMs);
    }),
  ]);
}

export async function setupDiscordBridge() {
  const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID;

  if (!clientId) {
    console.warn("VITE_DISCORD_CLIENT_ID is not set. Starting in local browser mode.");
    return createBrowserBridge("client-id-missing");
  }

  try {
    const sdk = new DiscordSDK(clientId);
    await withTimeout(
      sdk.ready(),
      SDK_READY_TIMEOUT_MS,
      `Discord SDK ready timed out after ${SDK_READY_TIMEOUT_MS}ms`,
    );

    const listeners = new Set();
    const state = {
      mode: "discord",
      ready: true,
      canInvite: true,
      reason: "",
      participants: [],
      error: null,
    };

    function emit() {
      const snapshot = buildSnapshot(state);
      listeners.forEach((listener) => {
        listener(snapshot);
      });
    }

    async function refreshParticipants() {
      try {
        const response = await sdk.commands.getInstanceConnectedParticipants();
        state.participants = (response?.participants || []).map(formatParticipant);
        emit();
      } catch (error) {
        console.warn("Failed to fetch Discord Activity participants.", error);
        state.error = error;
        emit();
      }

      return [...state.participants];
    }

    try {
      await sdk.subscribe(PARTICIPANTS_EVENT, (payload) => {
        state.participants = (payload?.participants || []).map(formatParticipant);
        emit();
      });
    } catch (error) {
      console.warn("Failed to subscribe to Discord Activity participant updates.", error);
      state.error = error;
    }

    await refreshParticipants();

    console.info("Discord Embedded App SDK is ready.");

    return {
      ...buildSnapshot(state),
      sdk,
      getSnapshot() {
        return buildSnapshot(state);
      },
      onChange(listener) {
        listeners.add(listener);
        listener(buildSnapshot(state));
        return () => {
          listeners.delete(listener);
        };
      },
      refreshParticipants,
      async openInviteDialog() {
        try {
          await sdk.commands.openInviteDialog();
          return true;
        } catch (error) {
          console.warn("Failed to open the Discord invite dialog.", error);
          state.error = error;
          emit();
          return false;
        }
      },
      async dispose() {
        listeners.clear();

        try {
          await sdk.unsubscribe(PARTICIPANTS_EVENT);
        } catch (error) {
          console.warn("Failed to unsubscribe from Discord Activity participant updates.", error);
        }
      },
    };
  } catch (error) {
    console.warn("Discord SDK handshake failed. Falling back to local browser mode.", error);
    return createBrowserBridge(
      error?.message?.includes("timed out") ? "sdk-ready-timeout" : "sdk-ready-failed",
      error,
    );
  }
}
