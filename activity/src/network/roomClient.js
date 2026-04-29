import { io } from "socket.io-client";
import { ROOM_EVENTS, normalizeRoomCode } from "../shared/roomProtocol.js";

function createListenerSet() {
  return new Set();
}

function resolveRoomServerUrl(options = {}) {
  if (options.serverUrl) {
    return options.serverUrl;
  }

  const configuredUrl = String(import.meta.env.VITE_ROOM_SERVER_URL || "").trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  if (import.meta.env.DEV) {
    return "http://127.0.0.1:3001";
  }

  return window.location.origin;
}

export function createRoomClient(options = {}) {
  const serverUrl = resolveRoomServerUrl(options);
  const socket = io(serverUrl, {
    autoConnect: false,
  });
  let connectPromise = null;

  const listeners = {
    ready: createListenerSet(),
    room: createListenerSet(),
    game: createListenerSet(),
    error: createListenerSet(),
  };

  function notify(kind, payload) {
    listeners[kind].forEach((listener) => listener(payload));
  }

  function on(eventName, listener) {
    listeners[eventName].add(listener);
    return () => {
      listeners[eventName].delete(listener);
    };
  }

  function ensureConnected() {
    if (socket.connected) {
      return Promise.resolve();
    }

    if (connectPromise) {
      return connectPromise;
    }

    connectPromise = new Promise((resolve, reject) => {
      const handleConnect = () => {
        cleanup();
        connectPromise = null;
        resolve();
      };

      const handleError = (error) => {
        cleanup();
        connectPromise = null;
        reject(error);
      };

      function cleanup() {
        socket.off("connect", handleConnect);
        socket.off("connect_error", handleError);
      }

      socket.on("connect", handleConnect);
      socket.on("connect_error", handleError);
      socket.connect();
    });

    return connectPromise;
  }

  async function request(eventName, payload) {
    await ensureConnected();
    return new Promise((resolve) => {
      socket.emit(eventName, payload, (response) => {
        resolve(response);
      });
    });
  }

  socket.on(ROOM_EVENTS.SERVER_READY, (payload) => {
    notify("ready", payload);
  });

  socket.on(ROOM_EVENTS.ROOM_UPDATED, (payload) => {
    notify("room", payload);
  });

  socket.on(ROOM_EVENTS.GAME_VIEW, (payload) => {
    notify("game", payload);
  });

  socket.on(ROOM_EVENTS.SERVER_ERROR, (payload) => {
    notify("error", payload);
  });

  return {
    serverUrl,
    socket,
    connect() {
      return ensureConnected();
    },
    disconnect() {
      connectPromise = null;
      socket.disconnect();
    },
    onReady(listener) {
      return on("ready", listener);
    },
    onRoomUpdate(listener) {
      return on("room", listener);
    },
    onGameView(listener) {
      return on("game", listener);
    },
    onError(listener) {
      return on("error", listener);
    },
    async createRoom(payload) {
      return request(ROOM_EVENTS.ROOM_CREATE, payload);
    },
    async joinRoom(payload) {
      return request(ROOM_EVENTS.ROOM_JOIN, {
        ...payload,
        roomCode: normalizeRoomCode(payload?.roomCode),
      });
    },
    async leaveRoom() {
      return request(ROOM_EVENTS.ROOM_LEAVE, {});
    },
    async startRoomGame() {
      return request(ROOM_EVENTS.ROOM_START, {});
    },
    async sendGameAction(payload) {
      return request(ROOM_EVENTS.GAME_ACTION, payload);
    },
  };
}
