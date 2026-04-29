import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "socket.io";
import {
  createInitialState,
  setupRound,
  getPlayerById,
  getCardById,
  cardLabel,
  jokerName,
  placementLabel,
  playCard,
  discardCard,
  markPlayerFinished,
  hasCardsRemaining,
  advanceTurn,
  buildGameResult,
  pushGameLog,
  createPublicGameView,
} from "../src/shared/rules.js";
import { ROOM_CAPACITY, ROOM_EVENTS, normalizeRoomCode } from "../src/shared/roomProtocol.js";

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
const ROOM_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_IDLE_TTL_MS = 1000 * 60 * 60 * 4;
const SHOULD_SERVE_STATIC = process.env.SERVE_STATIC === "1" || process.env.NODE_ENV === "production";

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(SERVER_DIR, "../dist");
const DIST_INDEX_PATH = path.join(DIST_DIR, "index.html");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

const rooms = new Map();
const socketMemberships = new Map();

function response(ok, extra = {}) {
  return {
    ok,
    ...extra,
  };
}

function distPathFromRequestPath(pathname) {
  const normalizedPath = pathname === "/" ? "/index.html" : pathname;
  const candidatePath = path.resolve(DIST_DIR, `.${normalizedPath}`);

  if (!candidatePath.startsWith(DIST_DIR)) {
    return null;
  }

  return candidatePath;
}

async function readDistFile(filePath) {
  const fileBuffer = await fs.readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  return {
    body: fileBuffer,
    contentType: MIME_TYPES[extension] || "application/octet-stream",
  };
}

async function serveSpaIndex(response) {
  const { body, contentType } = await readDistFile(DIST_INDEX_PATH);
  response.writeHead(200, { "Content-Type": contentType });
  response.end(body);
}

async function tryServeStatic(request, response, requestUrl) {
  if (!SHOULD_SERVE_STATIC || request.method !== "GET") {
    return false;
  }

  if (requestUrl.pathname.startsWith("/socket.io/")) {
    return false;
  }

  const candidatePath = distPathFromRequestPath(requestUrl.pathname);

  if (candidatePath) {
    try {
      const { body, contentType } = await readDistFile(candidatePath);
      response.writeHead(200, { "Content-Type": contentType });
      response.end(body);
      return true;
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "EISDIR") {
        throw error;
      }
    }
  }

  try {
    await serveSpaIndex(response);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function handleHttpRequest(request, response) {
  const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/health") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      ok: true,
      rooms: rooms.size,
      serveStatic: SHOULD_SERVE_STATIC,
    }));
    return;
  }

  if (await tryServeStatic(request, response, requestUrl)) {
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ ok: false, error: "not-found" }));
}

const httpServer = createServer((request, response) => {
  void handleHttpRequest(request, response).catch((error) => {
    console.error("HTTP request failed.", error);

    if (!response.headersSent) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    }

    response.end(JSON.stringify({ ok: false, error: "internal-server-error" }));
  });
});

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

function createRoomCode() {
  let code = "";

  do {
    code = Array.from({ length: 4 }, () => (
      ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)]
    )).join("");
  } while (rooms.has(code));

  return code;
}

function buildSeatSnapshot(player, seat, viewerSocketId) {
  if (!player) {
    return {
      seat,
      empty: true,
    };
  }

  return {
    empty: false,
    seat: player.seat,
    playerId: player.id,
    name: player.name,
    isYou: player.socketId === viewerSocketId,
    connected: true,
    discordId: player.discordId || null,
  };
}

function buildRoomSnapshot(room, viewerSocketId) {
  return {
    code: room.code,
    playerCount: room.players.length,
    capacity: ROOM_CAPACITY,
    canStart: room.players.length === ROOM_CAPACITY && room.gameState === null,
    status: room.gameState
      ? "in-game"
      : room.players.length === ROOM_CAPACITY
        ? "full"
        : "waiting",
    seats: Array.from({ length: ROOM_CAPACITY }, (_, seat) => {
      const player = room.players.find((entry) => entry.seat === seat);
      return buildSeatSnapshot(player, seat, viewerSocketId);
    }),
  };
}

function touchRoom(room) {
  room.updatedAt = Date.now();
}

function cleanupRoomIfEmpty(room) {
  if (room.players.length === 0) {
    rooms.delete(room.code);
  }
}

function getMembership(socketId) {
  return socketMemberships.get(socketId) || null;
}

function getRoomBySocket(socketId) {
  const membership = getMembership(socketId);
  if (!membership) {
    return null;
  }

  return rooms.get(membership.roomCode) || null;
}

function getPlayerRecord(room, socketId) {
  const membership = getMembership(socketId);
  if (!membership || membership.roomCode !== room.code) {
    return null;
  }

  return room.players.find((player) => player.seat === membership.seat) || null;
}

function emitRoomUpdated(room) {
  room.players.forEach((player) => {
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) {
      return;
    }

    socket.emit(ROOM_EVENTS.ROOM_UPDATED, buildRoomSnapshot(room, player.socketId));
  });
}

function emitServerError(room, message) {
  room.players.forEach((player) => {
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) {
      return;
    }

    socket.emit(ROOM_EVENTS.SERVER_ERROR, { message });
  });
}

function emitGameViews(room) {
  if (!room.gameState) {
    return;
  }

  room.players.forEach((player) => {
    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) {
      return;
    }

    socket.emit(ROOM_EVENTS.GAME_VIEW, {
      room: buildRoomSnapshot(room, player.socketId),
      game: createPublicGameView(room.gameState, player.seat),
    });
  });
}

function lowestAvailableSeat(room) {
  for (let seat = 0; seat < ROOM_CAPACITY; seat += 1) {
    if (!room.players.some((player) => player.seat === seat)) {
      return seat;
    }
  }

  return null;
}

function addPlayerToRoom(socket, room, payload) {
  const seat = lowestAvailableSeat(room);
  if (seat === null) {
    return null;
  }

  const requestedName = String(payload?.playerName || `Player ${seat + 1}`)
    .trim()
    .slice(0, 20);

  const player = {
    id: `${room.code}-${seat}-${Math.random().toString(36).slice(2, 8)}`,
    seat,
    socketId: socket.id,
    name: requestedName || `Player ${seat + 1}`,
    discordId: payload?.discordUser?.id || null,
    joinedAt: Date.now(),
  };

  room.players.push(player);
  room.players.sort((a, b) => a.seat - b.seat);
  socketMemberships.set(socket.id, {
    roomCode: room.code,
    seat,
  });
  socket.join(room.code);
  touchRoom(room);
  return player;
}

function removePlayerFromRoom(socket, reason = "left") {
  const membership = getMembership(socket.id);
  if (!membership) {
    return;
  }

  const room = rooms.get(membership.roomCode);
  socketMemberships.delete(socket.id);
  socket.leave(membership.roomCode);

  if (!room) {
    return;
  }

  const leavingPlayer = room.players.find((player) => player.seat === membership.seat) || null;
  room.players = room.players.filter((player) => player.seat !== membership.seat);
  touchRoom(room);

  if (room.gameState && leavingPlayer) {
    room.gameState = null;
    emitServerError(
      room,
      `${leavingPlayer.name} が${reason === "disconnect" ? "切断" : "退出"}したため対戦を終了しました。`,
    );
  }

  cleanupRoomIfEmpty(room);

  if (rooms.has(membership.roomCode)) {
    emitRoomUpdated(room);
  }
}

function startRoomGame(room) {
  const state = createInitialState();
  state.started = true;
  const playerConfigs = room.players
    .sort((a, b) => a.seat - b.seat)
    .map((player) => ({
      name: player.name,
      isHuman: true,
    }));

  const { starter, nextPlayer } = setupRound(state, playerConfigs);
  state.log = [];
  pushGameLog(state, `${nextPlayer.name} から時計回りに進行します。`);
  pushGameLog(state, `${starter.name} が開始時に ♠7 を出しました。`);
  room.gameState = state;
  touchRoom(room);
}

function applyActionLog(state, outcome) {
  if (outcome.matchedPlacement && outcome.removedCard.kind === "joker") {
    pushGameLog(
      state,
      `${outcome.player.name} が${jokerName(outcome.removedCard)}を${placementLabel(outcome.matchedPlacement)}として出しました。`,
    );
    return;
  }

  if (outcome.matchedPlacement) {
    pushGameLog(state, `${outcome.player.name} が${cardLabel(outcome.removedCard)}を場に出しました。`);
    return;
  }

  pushGameLog(state, `${outcome.player.name} は手札を1枚捨てました。`);
}

function applyGameAction(room, seat, payload) {
  const state = room.gameState;
  if (!state) {
    return response(false, { error: "game-not-started" });
  }

  if (state.result) {
    return response(false, { error: "game-already-finished" });
  }

  if (state.turnIndex !== seat) {
    return response(false, { error: "not-your-turn" });
  }

  const player = getPlayerById(state, seat);
  if (!player) {
    return response(false, { error: "player-not-found" });
  }

  const liveCard = getCardById(player, payload?.cardId);
  if (!liveCard) {
    return response(false, { error: "card-not-found" });
  }

  let outcome = null;

  if (payload?.type === "play") {
    outcome = playCard(state, seat, liveCard, payload.placement);
  } else if (payload?.type === "discard") {
    outcome = discardCard(state, seat, liveCard);
  } else {
    return response(false, { error: "unsupported-action" });
  }

  if (!outcome) {
    return response(false, { error: "illegal-action" });
  }

  applyActionLog(state, outcome);

  const finishedPlayer = markPlayerFinished(state, seat);
  if (finishedPlayer) {
    pushGameLog(state, `${finishedPlayer.name} の手札がなくなりました。`);
  }

  if (!hasCardsRemaining(state)) {
    state.result = buildGameResult(state);
    pushGameLog(state, `${state.result.winnerName} が${state.result.winLabel}で勝ちました。`);
  } else {
    advanceTurn(state);
  }

  touchRoom(room);
  emitGameViews(room);
  emitRoomUpdated(room);
  return response(true);
}

io.on("connection", (socket) => {
  socket.emit(ROOM_EVENTS.SERVER_READY, {
    socketId: socket.id,
    roomCapacity: ROOM_CAPACITY,
  });

  socket.on(ROOM_EVENTS.ROOM_CREATE, (payload, ack = () => {}) => {
    if (getMembership(socket.id)) {
      ack(response(false, { error: "already-in-room" }));
      return;
    }

    const roomCode = createRoomCode();
    const room = {
      code: roomCode,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      players: [],
      gameState: null,
    };

    rooms.set(roomCode, room);
    const player = addPlayerToRoom(socket, room, payload);

    emitRoomUpdated(room);
    ack(response(true, {
      roomCode,
      seat: player.seat,
      room: buildRoomSnapshot(room, socket.id),
    }));
  });

  socket.on(ROOM_EVENTS.ROOM_JOIN, (payload, ack = () => {}) => {
    if (getMembership(socket.id)) {
      ack(response(false, { error: "already-in-room" }));
      return;
    }

    const roomCode = normalizeRoomCode(payload?.roomCode);
    const room = rooms.get(roomCode);

    if (!room) {
      ack(response(false, { error: "room-not-found" }));
      return;
    }

    if (room.gameState) {
      ack(response(false, { error: "game-already-started" }));
      return;
    }

    if (room.players.length >= ROOM_CAPACITY) {
      ack(response(false, { error: "room-full" }));
      return;
    }

    const player = addPlayerToRoom(socket, room, payload);
    emitRoomUpdated(room);
    ack(response(true, {
      roomCode,
      seat: player.seat,
      room: buildRoomSnapshot(room, socket.id),
    }));
  });

  socket.on(ROOM_EVENTS.ROOM_LEAVE, (_payload, ack = () => {}) => {
    if (!getMembership(socket.id)) {
      ack(response(false, { error: "not-in-room" }));
      return;
    }

    removePlayerFromRoom(socket, "left");
    ack(response(true));
  });

  socket.on(ROOM_EVENTS.ROOM_START, (_payload, ack = () => {}) => {
    const room = getRoomBySocket(socket.id);
    if (!room) {
      ack(response(false, { error: "not-in-room" }));
      return;
    }

    if (room.players.length !== ROOM_CAPACITY) {
      ack(response(false, { error: "room-not-full" }));
      return;
    }

    if (room.gameState) {
      ack(response(false, { error: "game-already-started" }));
      return;
    }

    startRoomGame(room);
    emitRoomUpdated(room);
    emitGameViews(room);
    ack(response(true, {
      room: buildRoomSnapshot(room, socket.id),
    }));
  });

  socket.on(ROOM_EVENTS.GAME_ACTION, (payload, ack = () => {}) => {
    const room = getRoomBySocket(socket.id);
    if (!room) {
      ack(response(false, { error: "not-in-room" }));
      return;
    }

    const player = getPlayerRecord(room, socket.id);
    if (!player) {
      ack(response(false, { error: "player-not-found" }));
      return;
    }

    ack(applyGameAction(room, player.seat, payload));
  });

  socket.on("disconnect", () => {
    removePlayerFromRoom(socket, "disconnect");
  });
});

setInterval(() => {
  const now = Date.now();

  rooms.forEach((room, code) => {
    if (room.players.length === 0 && now - room.updatedAt >= ROOM_IDLE_TTL_MS) {
      rooms.delete(code);
    }
  });
}, 60_000).unref?.();

httpServer.listen(PORT, HOST, () => {
  const serveMode = SHOULD_SERVE_STATIC ? "client+room-server" : "room-server";
  console.log(`Activity server listening on http://${HOST}:${PORT} (${serveMode})`);
});
