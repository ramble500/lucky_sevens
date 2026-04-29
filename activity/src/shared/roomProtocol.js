export const ROOM_CAPACITY = 3;

export const ROOM_EVENTS = {
  SERVER_READY: "server:ready",
  SERVER_ERROR: "server:error",
  ROOM_CREATE: "room:create",
  ROOM_JOIN: "room:join",
  ROOM_LEAVE: "room:leave",
  ROOM_START: "room:start",
  ROOM_UPDATED: "room:updated",
  GAME_ACTION: "game:action",
  GAME_VIEW: "game:view",
};

export function normalizeRoomCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

