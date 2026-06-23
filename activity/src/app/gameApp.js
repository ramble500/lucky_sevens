import {
  createInitialState,
  setupRound,
  getPlayerById,
  getCardById,
  getPlacementsForCard,
  cardLabel,
  jokerName,
  placementLabel,
  playCard,
  discardCard,
  markPlayerFinished,
  hasCardsRemaining,
  buildGameResult,
  advanceTurn,
  hydratePublicGameView,
} from "../shared/rules.js";
import { chooseCpuAction } from "../shared/ai.js";
import { createRenderer } from "../ui/render.js";
import { createRoomClient } from "../network/roomClient.js";
import { ROOM_CAPACITY, normalizeRoomCode } from "../shared/roomProtocol.js";

const PLAYER_NAME_STORAGE_KEY = "koun7-activity-player-name";

const ROOM_ERROR_LABELS = {
  "already-in-room": "すでに部屋へ参加しています。",
  "room-not-found": "その部屋コードは見つかりませんでした。",
  "game-already-started": "その部屋ではすでに対戦が始まっています。",
  "room-full": "その部屋は満席です。",
  "room-empty": "1人以上参加してから開始してください。",
  "not-in-room": "まだ部屋に参加していません。",
  "room-not-full": "3人そろうまでは通常開始できません。",
  "game-not-started": "まだ対戦が始まっていません。",
  "game-already-finished": "その対戦はすでに終了しています。",
  "only-owner-can-start": "部屋主だけが対戦を開始できます。",
  "not-your-turn": "いまはあなたの手番ではありません。",
  "player-not-found": "プレイヤー情報が見つかりませんでした。",
  "card-not-found": "そのカードは手札にありません。",
  "unsupported-action": "未対応の操作です。",
  "illegal-action": "その操作はルール上できません。",
};

function participantDisplayName(participant) {
  return participant.globalName || participant.username || "Discord User";
}

function getViewerPlayerId(state) {
  return state.viewerPlayerId ?? 0;
}

function sanitizePlayerName(value) {
  return String(value || "").trim().slice(0, 20) || "Player";
}

function roomErrorLabel(errorCode) {
  return ROOM_ERROR_LABELS[errorCode] || `room server エラー: ${errorCode}`;
}

function replaceState(target, source) {
  Object.keys(target).forEach((key) => {
    delete target[key];
  });

  Object.assign(target, source);
}

export function startGameApp({ discord } = {}) {
  const restartButtonElement = document.getElementById("restart-button");
  const runtimeLabelElement = document.getElementById("runtime-label");
  const runtimeNoteElement = document.getElementById("runtime-note");
  const participantSummaryElement = document.getElementById("participant-summary");
  const participantListElement = document.getElementById("participant-list");
  const inviteButtonElement = document.getElementById("invite-button");
  const roomPlayerNameElement = document.getElementById("room-player-name");
  const roomCodeInputElement = document.getElementById("room-code-input");
  const roomCreateButtonElement = document.getElementById("room-create-button");
  const roomJoinButtonElement = document.getElementById("room-join-button");
  const roomStartButtonElement = document.getElementById("room-start-button");
  const roomStartCpuButtonElement = document.getElementById("room-start-cpu-button");
  const roomLeaveButtonElement = document.getElementById("room-leave-button");
  const roomStatusElement = document.getElementById("room-status");
  const roomSeatListElement = document.getElementById("room-seat-list");

  const state = createInitialState();
  const roomClient = createRoomClient();
  const roomSession = {
    connected: false,
    currentRoom: null,
    inFlight: false,
    connectionError: "",
    returningToLobby: false,
  };

  const SCREEN_STATES = {
    HOME: "home",
    ROOM_LOBBY: "room-lobby",
    LOCAL_GAME: "local-game",
    ROOM_GAME: "room-game",
    LOCAL_RESULT: "local-result",
    ROOM_RESULT: "room-result",
  };

  let unsubscribeDiscord = null;

  function addLog(message) {
    state.log.unshift(message);
    state.log = state.log.slice(0, 12);
  }

  function clearPendingAction() {
    state.pendingCardId = null;
    state.pendingMoves = [];
  }

  function clearCpuTimer() {
    if (state.cpuTimer !== null) {
      window.clearTimeout(state.cpuTimer);
      state.cpuTimer = null;
    }
  }

  function buildFreshState(playMode = "local") {
    const nextState = createInitialState();
    nextState.gameId = (state.gameId || 0) + 1;
    nextState.playMode = playMode;
    return nextState;
  }

  function resetToHomeState() {
    clearCpuTimer();
    replaceState(state, buildFreshState("local"));
    clearPendingAction();
  }

  function resetToJoinedRoomState() {
    clearCpuTimer();
    replaceState(state, buildFreshState("room"));
    clearPendingAction();
  }

  function getCurrentScreen() {
    if (state.result !== null) {
      return state.playMode === "room"
        ? SCREEN_STATES.ROOM_RESULT
        : SCREEN_STATES.LOCAL_RESULT;
    }

    if (state.started) {
      return state.playMode === "room"
        ? SCREEN_STATES.ROOM_GAME
        : SCREEN_STATES.LOCAL_GAME;
    }

    if (roomSession.currentRoom) {
      return SCREEN_STATES.ROOM_LOBBY;
    }

    return SCREEN_STATES.HOME;
  }

  function getScreenGroup(screen = getCurrentScreen()) {
    if (screen === SCREEN_STATES.LOCAL_GAME || screen === SCREEN_STATES.ROOM_GAME) {
      return "game";
    }

    if (screen === SCREEN_STATES.LOCAL_RESULT || screen === SCREEN_STATES.ROOM_RESULT) {
      return "result";
    }

    return "lobby";
  }

  function syncViewDatasets() {
    const screen = getCurrentScreen();
    const screenGroup = getScreenGroup(screen);
    const roomStage = !roomSession.currentRoom
      ? "idle"
      : screen === SCREEN_STATES.ROOM_GAME
        ? "game"
        : screen === SCREEN_STATES.ROOM_RESULT
          ? "finished"
          : "joined";
    const gameStage = screenGroup === "game"
      ? "game"
      : screenGroup === "result"
        ? "result"
        : "idle";

    document.body.dataset.screen = screen;
    document.body.dataset.screenGroup = screenGroup;
    document.body.dataset.roomStage = roomStage;
    document.body.dataset.gameStage = gameStage;

    return {
      screen,
      screenGroup,
      roomStage,
      gameStage,
    };
  }

  async function returnToHomeScreen({ leaveRoom = false } = {}) {
    if (roomSession.returningToLobby) {
      return;
    }

    roomSession.returningToLobby = true;
    resetToHomeState();
    render();

    if (leaveRoom && roomSession.currentRoom) {
      roomSession.inFlight = true;
      renderRoomPanel();

      let leaveSucceeded = false;

      try {
        const result = await roomClient.leaveRoom();
        leaveSucceeded = Boolean(result?.ok || result?.error === "not-in-room");

        if (!leaveSucceeded) {
          addLog(roomErrorLabel(result?.error || "unknown"));
        }
      } catch (error) {
        addLog(`room server 縺ｨ縺ｮ騾壻ｿ｡縺ｫ螟ｱ謨励＠縺ｾ縺励◆: ${error.message}`);
      } finally {
        if (leaveSucceeded) {
          roomSession.currentRoom = null;
          roomCodeInputElement.value = "";
        }

        roomSession.inFlight = false;
      }
    }

    roomSession.returningToLobby = false;
    render();
  }

  function currentPlayerName() {
    const nextName = sanitizePlayerName(roomPlayerNameElement.value);
    roomPlayerNameElement.value = nextName;
    window.localStorage.setItem(PLAYER_NAME_STORAGE_KEY, nextName);
    return nextName;
  }

  function renderParticipantList(participants, emptyLabel) {
    participantListElement.innerHTML = "";

    if (participants.length === 0) {
      const chip = document.createElement("span");
      chip.className = "participant-chip participant-chip-empty";
      chip.textContent = emptyLabel;
      participantListElement.appendChild(chip);
      return;
    }

    participants.forEach((participant) => {
      const chip = document.createElement("span");
      chip.className = "participant-chip";
      chip.textContent = participantDisplayName(participant);
      participantListElement.appendChild(chip);
    });
  }

  function renderDiscordStatus(snapshot = { mode: "browser", participants: [] }) {
    const participants = snapshot.participants || [];

    if (snapshot.mode === "discord") {
      runtimeLabelElement.textContent = "Discord Activity 接続中";
      runtimeNoteElement.textContent = "同じ Activity インスタンスにいる参加者を表示しています。";
      participantSummaryElement.textContent = `参加者 ${participants.length} / ${ROOM_CAPACITY}`;
      inviteButtonElement.hidden = false;
      inviteButtonElement.disabled = false;
      renderParticipantList(participants, "まだ参加者がいません");
      return;
    }

    runtimeLabelElement.textContent = "ローカルブラウザ確認";

    if (snapshot.reason === "client-id-missing") {
      runtimeNoteElement.textContent = ".env の VITE_DISCORD_CLIENT_ID を設定すると Discord 起動を試せます。";
    } else if (snapshot.reason === "sdk-ready-timeout") {
      runtimeNoteElement.textContent = "Discord SDK の応答が遅かったため、通常ブラウザ表示に切り替えています。";
    } else if (snapshot.reason === "sdk-ready-failed") {
      runtimeNoteElement.textContent = "Discord SDK への接続に失敗したため、通常ブラウザ表示で続行しています。";
    } else {
      runtimeNoteElement.textContent = "Discord 外でも画面とルールの確認ができます。";
    }

    participantSummaryElement.textContent = "参加者表示は Discord 接続時に有効になります。";
    inviteButtonElement.hidden = true;
    inviteButtonElement.disabled = true;
    renderParticipantList([], "Discord 上で起動すると参加者が表示されます");
  }

  function renderRoomSeats(room) {
    roomSeatListElement.innerHTML = "";

    const seats = room?.seats || Array.from({ length: ROOM_CAPACITY }, (_, seat) => ({
      seat,
      empty: true,
    }));

    seats.forEach((seatInfo) => {
      const seat = document.createElement("div");
      seat.className = `room-seat ${seatInfo.empty ? "room-seat-empty" : ""} ${seatInfo.isYou ? "room-seat-you" : ""}`.trim();

      const title = document.createElement("p");
      title.className = "room-seat-title";
      title.textContent = `席 ${seatInfo.seat + 1}`;

      const name = document.createElement("p");
      name.className = "room-seat-name";

      if (seatInfo.empty) {
        name.textContent = "空席";
      } else {
        const suffixes = [];
        if (seatInfo.isYou) {
          suffixes.push("あなた");
        }
        if (seatInfo.isOwner) {
          suffixes.push("部屋主");
        }
        if (seatInfo.isCpu) {
          suffixes.push("CPU");
        }

        name.textContent = `${seatInfo.name}${suffixes.length > 0 ? ` (${suffixes.join(" / ")})` : ""}`;
      }

      seat.append(title, name);
      roomSeatListElement.appendChild(seat);
    });
  }

  function renderRoomPanel() {
    const joinedRoom = roomSession.currentRoom;
    const joined = Boolean(joinedRoom);
    const normalizedRoomCode = normalizeRoomCode(roomCodeInputElement.value);
    const canJoinWithCode = normalizedRoomCode.length === 4;
    const { screen } = syncViewDatasets();

    roomPlayerNameElement.disabled = joined || roomSession.inFlight;
    roomCodeInputElement.disabled = joined || roomSession.inFlight;
    roomCreateButtonElement.disabled = !roomSession.connected || joined || roomSession.inFlight;
    roomJoinButtonElement.disabled = !roomSession.connected || joined || roomSession.inFlight || !canJoinWithCode;
    roomStartButtonElement.disabled = !joinedRoom?.canStart || roomSession.inFlight;
    roomStartCpuButtonElement.disabled = !joinedRoom?.canStartWithCpu || roomSession.inFlight;
    roomLeaveButtonElement.disabled = !joined || roomSession.inFlight;

    restartButtonElement.disabled =
      screen === SCREEN_STATES.ROOM_LOBBY ||
      screen === SCREEN_STATES.ROOM_GAME ||
      screen === SCREEN_STATES.ROOM_RESULT ||
      roomSession.inFlight ||
      roomSession.returningToLobby;
    restartButtonElement.textContent = screen === SCREEN_STATES.LOCAL_RESULT
      ? "ロビーに戻る"
      : "ローカル練習を始める";

    if (joinedRoom) {
      roomCodeInputElement.value = joinedRoom.code;

      if (screen === SCREEN_STATES.ROOM_GAME || joinedRoom.status === "in-game") {
        roomStatusElement.textContent = `部屋 ${joinedRoom.code} で対戦中です。対戦が終わるまで部屋は維持されます。`;
        renderRoomSeats(joinedRoom);
        return;
      }

      if (screen === SCREEN_STATES.ROOM_RESULT || joinedRoom.status === "finished") {
        roomStatusElement.textContent = joinedRoom.isOwner
          ? `部屋 ${joinedRoom.code} の結果を表示中です。開始で再戦、退出で部屋を出られます。`
          : `部屋 ${joinedRoom.code} の結果を表示中です。再戦する場合は部屋主の開始を待ってください。`;
        renderRoomSeats(joinedRoom);
        return;
      }

      let startHint = `${joinedRoom.playerCount} / ${joinedRoom.capacity} 人が参加中です。`;

      if (joinedRoom.canStart) {
        startHint = joinedRoom.isOwner
          ? "3人そろいました。部屋主が開始できます。"
          : "3人そろいました。部屋主の開始を待ってください。";
      } else if (joinedRoom.canStartWithCpu) {
        startHint = joinedRoom.isOwner
          ? "部屋主なら CPU で埋めて開始できます。"
          : "人数が足りません。部屋主が CPU で埋めることもできます。";
      } else if (joinedRoom.isOwner) {
        startHint = "参加者がそろうまで待っています。";
      } else {
        startHint = "部屋主の開始を待っています。";
      }

      roomStatusElement.textContent = `部屋 ${joinedRoom.code} に参加中です。${startHint}`;
      renderRoomSeats(joinedRoom);
      return;
    }

    renderRoomSeats(null);

    if (!roomSession.connected) {
      roomStatusElement.textContent = roomSession.connectionError || "room server に接続しています...";
      return;
    }

    roomStatusElement.textContent = "room server に接続済みです。部屋を作るか、部屋コードで参加してください。";
  }

  async function handleInviteClick() {
    if (!discord?.openInviteDialog) {
      return;
    }

    inviteButtonElement.disabled = true;
    const opened = await discord.openInviteDialog();
    inviteButtonElement.disabled = false;

    addLog(opened
      ? "Discord の招待ダイアログを開きました。"
      : "Discord の招待ダイアログを開けませんでした。");
    render();
  }

  function initializeDiscordPanel() {
    const snapshot = discord?.getSnapshot?.() || {
      mode: "browser",
      participants: [],
    };

    renderDiscordStatus(snapshot);
    inviteButtonElement.addEventListener("click", handleInviteClick);

    if (discord?.onChange) {
      unsubscribeDiscord = discord.onChange((nextSnapshot) => {
        renderDiscordStatus(nextSnapshot);
      });
    }
  }

  const renderer = createRenderer({
    getPlacements: (card) => getPlacementsForCard(state, card),
    onCardClick,
    onPlacementSelect,
  });

  function render() {
    renderer.renderAll(state);
    renderRoomPanel();
  }

  function finishGame() {
    clearCpuTimer();
    state.busy = false;
    clearPendingAction();
    state.result = buildGameResult(state);
    addLog(`${state.result.winnerName} が ${state.result.winLabel} で勝ちました。`);
    render();
  }

  function completeTurn(playerIndex) {
    const finishedPlayer = markPlayerFinished(state, playerIndex);
    if (finishedPlayer) {
      addLog(`${finishedPlayer.name} の手札がなくなりました。`);
    }

    if (!hasCardsRemaining(state)) {
      finishGame();
      return;
    }

    advanceTurn(state);
    state.busy = false;
    clearPendingAction();
    render();
    maybeRunCpuTurn();
  }

  function playCardAndContinue(playerIndex, card, placement) {
    const outcome = playCard(state, playerIndex, card, placement);
    if (!outcome) {
      return false;
    }

    if (outcome.removedCard.kind === "joker") {
      addLog(`${outcome.player.name} が ${jokerName(outcome.removedCard)} を ${placementLabel(outcome.matchedPlacement)} として出しました。`);
    } else {
      addLog(`${outcome.player.name} が ${cardLabel(outcome.removedCard)} を場に出しました。`);
    }

    completeTurn(playerIndex);
    return true;
  }

  function discardCardAndContinue(playerIndex, card) {
    const outcome = discardCard(state, playerIndex, card);
    if (!outcome) {
      return false;
    }

    addLog(`${outcome.player.name} は手札を1枚捨てました。`);
    completeTurn(playerIndex);
    return true;
  }

  async function sendRoomAction(payload) {
    state.busy = true;
    render();

    try {
      const result = await roomClient.sendGameAction(payload);
      if (!result?.ok) {
        state.busy = false;
        clearPendingAction();
        addLog(roomErrorLabel(result?.error || "unknown"));
        render();
      }
    } catch (error) {
      state.busy = false;
      clearPendingAction();
      addLog(`room server との通信に失敗しました: ${error.message}`);
      render();
    }
  }

  function handleCardPlay(card) {
    const placements = getPlacementsForCard(state, card);
    if (placements.length === 0) {
      return;
    }

    if (placements.length > 1) {
      if (state.pendingCardId === card.id) {
        clearPendingAction();
        render();
        return;
      }

      state.pendingCardId = card.id;
      state.pendingMoves = placements;
      render();
      return;
    }

    if (state.playMode === "room") {
      clearPendingAction();
      void sendRoomAction({
        type: "play",
        cardId: card.id,
        placement: placements[0],
      });
      return;
    }

    playCardAndContinue(getViewerPlayerId(state), card, placements[0]);
  }

  function onCardClick(card, context) {
    if (context.mustDiscard) {
      if (state.playMode === "room") {
        clearPendingAction();
        void sendRoomAction({
          type: "discard",
          cardId: card.id,
        });
        return;
      }

      discardCardAndContinue(getViewerPlayerId(state), card);
      return;
    }

    handleCardPlay(card);
  }

  function onPlacementSelect(cardId, placement) {
    const viewerPlayerId = getViewerPlayerId(state);
    const human = getPlayerById(state, viewerPlayerId);
    const liveCard = human ? getCardById(human, cardId) : null;
    if (!liveCard) {
      return;
    }

    if (state.playMode === "room") {
      clearPendingAction();
      void sendRoomAction({
        type: "play",
        cardId,
        placement,
      });
      return;
    }

    playCardAndContinue(viewerPlayerId, liveCard, placement);
  }

  function maybeRunCpuTurn() {
    if (state.playMode === "room") {
      render();
      return;
    }

    if (state.result !== null || state.turnIndex === getViewerPlayerId(state)) {
      render();
      return;
    }

    const currentPlayer = getPlayerById(state, state.turnIndex);
    if (!currentPlayer || currentPlayer.hand.length === 0) {
      advanceTurn(state);
      maybeRunCpuTurn();
      return;
    }

    state.busy = true;
    render();

    const playerIndex = state.turnIndex;
    const currentGameId = state.gameId;

    state.cpuTimer = window.setTimeout(() => {
      state.cpuTimer = null;

      try {
        if (currentGameId !== state.gameId || state.result !== null) {
          return;
        }

        if (state.turnIndex !== playerIndex) {
          state.busy = false;
          render();
          return;
        }

        const player = getPlayerById(state, playerIndex);
        const action = chooseCpuAction(state, player);

        if (!action) {
          state.busy = false;
          addLog("CPU の手番処理に失敗しました。ローカル練習をやり直してください。");
          render();
          return;
        }

        const succeeded = action.type === "play"
          ? playCardAndContinue(playerIndex, action.card, action.placement)
          : discardCardAndContinue(playerIndex, action.card);

        if (!succeeded) {
          state.busy = false;
          addLog("CPU の手番処理に失敗しました。ローカル練習をやり直してください。");
          render();
        }
      } catch (error) {
        console.error("Failed to resolve local CPU turn.", error);
        state.busy = false;
        addLog(`CPU の手番処理でエラーが発生しました: ${error.message}`);
        render();
      }
    }, 700);
  }

  function setupPracticeGame() {
    clearCpuTimer();

    const nextState = createInitialState();
    nextState.gameId = (state.gameId || 0) + 1;
    nextState.started = true;
    nextState.playMode = "local";
    nextState.viewerPlayerId = 0;
    replaceState(state, nextState);
    clearPendingAction();

    const { starter, nextPlayer } = setupRound(state);
    state.log = [
      `${starter.name} が開始時に ♠7 を出しました。`,
      `${nextPlayer.name} から時計回りに進行します。`,
    ];

    render();
    maybeRunCpuTurn();
  }

  function applyRemoteGameView(gameView) {
    clearCpuTimer();
    const nextState = hydratePublicGameView(gameView);

    nextState.gameId = (state.gameId || 0) + 1;
    nextState.busy = false;
    nextState.pendingCardId = null;
    nextState.pendingMoves = [];
    replaceState(state, nextState);
    render();
  }

  async function withRoomRequest(task) {
    roomSession.inFlight = true;
    renderRoomPanel();

    try {
      await task();
    } catch (error) {
      addLog(`room server との通信に失敗しました: ${error.message}`);
      render();
    } finally {
      roomSession.inFlight = false;
      renderRoomPanel();
    }
  }

  async function handleCreateRoom() {
    await withRoomRequest(async () => {
      const result = await roomClient.createRoom({
        playerName: currentPlayerName(),
      });

      if (!result?.ok) {
        addLog(roomErrorLabel(result?.error || "unknown"));
        return;
      }

      roomSession.currentRoom = result.room;
      roomCodeInputElement.value = result.roomCode;
      resetToJoinedRoomState();
      addLog(`部屋 ${result.roomCode} を作成しました。あと ${ROOM_CAPACITY - 1} 人まで参加できます。`);
      render();
    });
  }

  async function handleJoinRoom() {
    await withRoomRequest(async () => {
      const roomCode = normalizeRoomCode(roomCodeInputElement.value);
      roomCodeInputElement.value = roomCode;

      const result = await roomClient.joinRoom({
        roomCode,
        playerName: currentPlayerName(),
      });

      if (!result?.ok) {
        addLog(roomErrorLabel(result?.error || "unknown"));
        return;
      }

      roomSession.currentRoom = result.room;
      resetToJoinedRoomState();
      addLog(`部屋 ${result.roomCode} に参加しました。`);
      render();
    });
  }

  async function handleStartRoom(fillWithCpu = false) {
    await withRoomRequest(async () => {
      const result = await roomClient.startRoomGame({ fillWithCpu });
      if (!result?.ok) {
        addLog(roomErrorLabel(result?.error || "unknown"));
        return;
      }

      roomSession.currentRoom = result.room;
      resetToJoinedRoomState();
      addLog(fillWithCpu
        ? "CPU で空席を埋めて対戦を開始しました。"
        : "部屋対戦を開始しました。");
      render();
    });
  }

  async function handleLeaveRoom() {
    await withRoomRequest(async () => {
      const joinedCode = roomSession.currentRoom?.code || "";
      const result = await roomClient.leaveRoom();
      if (!result?.ok) {
        addLog(roomErrorLabel(result?.error || "unknown"));
        return;
      }

      roomSession.currentRoom = null;
      roomCodeInputElement.value = "";

      resetToHomeState();
      render();

      addLog(joinedCode ? `部屋 ${joinedCode} から退出しました。` : "部屋から退出しました。");
      render();
    });
  }

  function connectRoomClient() {
    roomClient.onReady(() => {
      roomSession.connected = true;
      roomSession.connectionError = "";
      render();
    });

    roomClient.onRoomUpdate((room) => {
      const wasShowingRoomRound = state.playMode === "room" && (state.started || state.result !== null);
      roomSession.currentRoom = room;

      if (wasShowingRoomRound && room.status !== "in-game" && room.status !== "finished") {
        const wasCanceledMidGame = state.result === null;
        resetToJoinedRoomState();
        if (wasCanceledMidGame) {
          addLog("対戦状態が終了したため、部屋の待機画面に戻りました。");
        }
        render();
        return;
      }

      render();
    });

    roomClient.onGameView((payload) => {
      roomSession.currentRoom = payload.room;
      applyRemoteGameView(payload.game);
    });

    roomClient.onError((payload) => {
      addLog(payload.message || "room server でエラーが発生しました。");
      render();
    });

    roomClient.connect().catch((error) => {
      roomSession.connected = false;
      roomSession.connectionError = `room server に接続できませんでした: ${error.message}`;
      render();
    });
  }

  restartButtonElement.addEventListener("click", () => {
    if (roomSession.currentRoom) {
      return;
    }

    if (state.result !== null) {
      void returnToHomeScreen();
      return;
    }

    setupPracticeGame();
  });

  roomPlayerNameElement.value = window.localStorage.getItem(PLAYER_NAME_STORAGE_KEY) || "Player";
  roomPlayerNameElement.addEventListener("change", () => {
    currentPlayerName();
    renderRoomPanel();
  });
  roomCodeInputElement.addEventListener("input", () => {
    roomCodeInputElement.value = normalizeRoomCode(roomCodeInputElement.value);
    renderRoomPanel();
  });
  roomCreateButtonElement.addEventListener("click", () => {
    void handleCreateRoom();
  });
  roomJoinButtonElement.addEventListener("click", () => {
    void handleJoinRoom();
  });
  roomStartButtonElement.addEventListener("click", () => {
    void handleStartRoom(false);
  });
  roomStartCpuButtonElement.addEventListener("click", () => {
    void handleStartRoom(true);
  });
  roomLeaveButtonElement.addEventListener("click", () => {
    void handleLeaveRoom();
  });

  window.addEventListener("beforeunload", () => {
    unsubscribeDiscord?.();
    roomClient.disconnect();
  });

  initializeDiscordPanel();
  connectRoomClient();
  resetToHomeState();
  render();
}
