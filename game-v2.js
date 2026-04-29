const suits = [
  { key: "S", symbol: "♠", name: "スペード", className: "card-black" },
  { key: "H", symbol: "♥", name: "ハート", className: "card-red" },
  { key: "D", symbol: "♦", name: "ダイヤ", className: "card-orange" },
  { key: "C", symbol: "♣", name: "クラブ", className: "card-green" },
];

const rankLabels = {
  1: "A",
  11: "J",
  12: "Q",
  13: "K",
};

const suitOrder = ["S", "H", "D", "C"];
const playerNames = ["あなた", "CPU 1", "CPU 2"];

const state = {
  players: [],
  board: {},
  turnIndex: 0,
  started: false,
  busy: false,
  log: [],
  cpuTimer: null,
  gameId: 0,
  pendingCardId: null,
  pendingMoves: [],
  roundOrder: [],
  result: null,
};

const boardElement = document.getElementById("board");
const opponentsElement = document.getElementById("opponents");
const playerHandElement = document.getElementById("player-hand");
const logListElement = document.getElementById("log-list");
const turnPillElement = document.getElementById("turn-pill");
const phasePillElement = document.getElementById("phase-pill");
const handHintElement = document.getElementById("hand-hint");
const restartButtonElement = document.getElementById("restart-button");
const actionPanelElement = document.getElementById("action-panel");
const actionTitleElement = document.getElementById("action-title");
const actionButtonsElement = document.getElementById("action-buttons");
const scoreListElement = document.getElementById("score-list");

function rankLabel(rank) {
  return rankLabels[rank] || String(rank);
}

function suitMeta(suitKey) {
  return suits.find((suit) => suit.key === suitKey);
}

function orderIndex(playerIndex) {
  return state.roundOrder.indexOf(playerIndex);
}

function compareByRoundOrder(aIndex, bIndex) {
  return orderIndex(aIndex) - orderIndex(bIndex);
}

function createStandardCard(suit, rank) {
  return {
    id: `${suit}-${rank}`,
    kind: "standard",
    suit,
    rank,
    score: rank,
  };
}

function createJokerCard(jokerSide) {
  return {
    id: jokerSide === "low" ? "J-LOW" : "J-HIGH",
    kind: "joker",
    jokerSide,
    score: jokerSide === "low" ? 14 : 15,
  };
}

function createDeck() {
  const deck = [];

  for (const suit of suits) {
    for (let rank = 1; rank <= 13; rank += 1) {
      deck.push(createStandardCard(suit.key, rank));
    }
  }

  deck.push(createJokerCard("low"));
  deck.push(createJokerCard("high"));
  return deck;
}

function shuffle(deck) {
  const cards = [...deck];
  for (let i = cards.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

function compareCards(a, b) {
  if (a.kind !== b.kind) {
    return a.kind === "standard" ? -1 : 1;
  }

  if (a.kind === "joker") {
    return a.jokerSide.localeCompare(b.jokerSide);
  }

  const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
  if (suitDiff !== 0) {
    return suitDiff;
  }

  return a.rank - b.rank;
}

function cardScore(card) {
  return card.score;
}

function jokerName(card) {
  return card.jokerSide === "low" ? "小王" : "大王";
}

function cardLabel(card) {
  if (card.kind === "joker") {
    return jokerName(card);
  }

  const suit = suitMeta(card.suit);
  return `${suit.symbol}${rankLabel(card.rank)}`;
}

function placementLabel(placement) {
  const suit = suitMeta(placement.suit);
  return `${suit.symbol}${rankLabel(placement.rank)}`;
}

function addLog(message) {
  state.log.unshift(message);
  state.log = state.log.slice(0, 12);
  renderLog();
}

function clearPendingAction() {
  state.pendingCardId = null;
  state.pendingMoves = [];
}

function initializeBoard() {
  state.board = {};

  for (const suit of suits) {
    state.board[suit.key] = {
      started: false,
      low: null,
      high: null,
      placed: new Map(),
    };
  }
}

function startLaneWithSpadeSeven() {
  const lane = state.board.S;
  lane.started = true;
  lane.low = 7;
  lane.high = 7;
  lane.placed.set(7, { kind: "standard" });
}

function getPlacementsForCard(card) {
  if (!card) {
    return [];
  }

  if (card.kind === "standard") {
    const lane = state.board[card.suit];

    if (lane.placed.has(card.rank)) {
      return [];
    }

    if (!lane.started) {
      return card.rank === 7 ? [{ suit: card.suit, rank: 7, side: "start" }] : [];
    }

    if (card.rank === lane.low - 1) {
      return [{ suit: card.suit, rank: card.rank, side: "low" }];
    }

    if (card.rank === lane.high + 1) {
      return [{ suit: card.suit, rank: card.rank, side: "high" }];
    }

    return [];
  }

  const placements = [];

  for (const suit of suits) {
    const lane = state.board[suit.key];
    if (!lane.started) {
      continue;
    }

    if (card.jokerSide === "low" && lane.low > 1) {
      placements.push({ suit: suit.key, rank: lane.low - 1, side: "low" });
    }

    if (card.jokerSide === "high" && lane.high < 13) {
      placements.push({ suit: suit.key, rank: lane.high + 1, side: "high" });
    }
  }

  return placements;
}

function getPlayableCards(player) {
  return player.hand.filter((card) => getPlacementsForCard(card).length > 0);
}

function getPlayerById(playerIndex) {
  return state.players[playerIndex];
}

function getCardById(player, cardId) {
  return player.hand.find((card) => card.id === cardId) || null;
}

function hasCardsRemaining() {
  return state.players.some((player) => player.hand.length > 0);
}

function totalDiscardScore(player) {
  return player.discards.reduce((sum, card) => sum + cardScore(card), 0);
}

function penaltyMultiplier(score) {
  if (score >= 80) {
    return 8;
  }

  if (score >= 60) {
    return 4;
  }

  if (score >= 40) {
    return 2;
  }

  return 1;
}

function determineWinnerMultiplier(player, rankingWinner) {
  if (player.playedCount === 0 && player.discards.length === player.initialHandCount) {
    return { multiplier: 8, label: "捨て切り上がり" };
  }

  if (rankingWinner.lastAction && rankingWinner.lastAction.type === "play" && rankingWinner.lastAction.rank === 7) {
    return { multiplier: 8, label: "7上がり" };
  }

  if (rankingWinner.lastAction && rankingWinner.lastAction.type === "play" && rankingWinner.lastAction.cardKind === "joker") {
    return { multiplier: 4, label: "小王・大王上がり" };
  }

  if (player.discards.length === 0) {
    return { multiplier: 2, label: "ノー捨て上がり" };
  }

  return { multiplier: 1, label: "通常上がり" };
}

function buildBoardCard(suitKey, rank, entry) {
  const suit = suitMeta(suitKey);
  const wrapper = document.createElement("div");
  wrapper.className = `playing-card ${suit.className}`;

  const center = document.createElement("div");
  center.className = "card-center";
  center.textContent = `${suit.symbol}${rankLabel(rank)}`;

  const note = document.createElement("div");
  note.className = "card-note";

  if (entry.kind === "joker") {
    note.textContent = entry.jokerSide === "low" ? "小王" : "大王";
  } else {
    note.textContent = suit.name;
  }

  wrapper.append(center, note);
  return wrapper;
}

function renderBoard() {
  boardElement.innerHTML = "";

  for (const suit of suits) {
    const row = document.createElement("div");
    row.className = "board-row";

    const label = document.createElement("div");
    label.className = `suit-label ${suit.className}`;
    label.textContent = suit.symbol;
    row.appendChild(label);

    for (let rank = 1; rank <= 13; rank += 1) {
      const slot = document.createElement("div");
      const entry = state.board[suit.key].placed.get(rank);
      slot.className = `board-slot ${entry ? "" : "empty"}`.trim();

      if (entry) {
        slot.appendChild(buildBoardCard(suit.key, rank, entry));
      } else {
        slot.textContent = rankLabel(rank);
      }

      row.appendChild(slot);
    }

    boardElement.appendChild(row);
  }
}

function renderOpponents() {
  opponentsElement.innerHTML = "";

  state.players
    .filter((player) => !player.isHuman)
    .forEach((player) => {
      const card = document.createElement("article");
      const active = state.turnIndex === player.id && state.result === null;
      card.className = `opponent-card ${active ? "active" : ""}`.trim();

      const name = document.createElement("p");
      name.className = "opponent-name";
      name.textContent = player.name;

      const meta = document.createElement("p");
      meta.className = "opponent-meta";

      if (state.result) {
        const resultRow = state.result.rows.find((row) => row.playerIndex === player.id);
        meta.textContent = `${resultRow.rank}位 / ${resultRow.discardScore}点 / ${resultRow.net > 0 ? "+" : ""}${resultRow.net}`;
      } else {
        meta.textContent = `手札 ${player.hand.length} 枚 / 捨て札 ${player.discards.length} 枚`;
      }

      const miniCards = document.createElement("div");
      miniCards.className = "mini-cards";

      for (let i = 0; i < Math.min(player.hand.length, 12); i += 1) {
        const miniCard = document.createElement("div");
        miniCard.className = "mini-card";
        miniCards.appendChild(miniCard);
      }

      card.append(name, meta, miniCards);
      opponentsElement.appendChild(card);
    });
}

function createHandCardBody(button, card) {
  const center = document.createElement("div");
  center.className = "card-center";

  const note = document.createElement("div");
  note.className = "card-note";

  if (card.kind === "joker") {
    center.textContent = card.jokerSide === "low" ? "小王" : "大王";
    note.textContent = card.jokerSide === "low" ? "7より小さい側 / 14点" : "7より大きい側 / 15点";
  } else {
    const suit = suitMeta(card.suit);
    center.textContent = `${suit.symbol}${rankLabel(card.rank)}`;
    note.textContent = `${suit.name} / ${card.rank}点`;
  }

  button.append(center, note);
}

function renderHand() {
  const human = getPlayerById(0);
  const isPlayersTurn = state.turnIndex === 0 && state.result === null && !state.busy;
  const playableCards = getPlayableCards(human);
  const mustDiscard = isPlayersTurn && playableCards.length === 0 && human.hand.length > 0;

  playerHandElement.innerHTML = "";

  if (human.hand.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "hand-placeholder";
    placeholder.textContent = state.result ? "精算結果が表示されています。" : "あなたの手札はなくなりました。";
    playerHandElement.appendChild(placeholder);
  }

  human.hand.forEach((card) => {
    const placements = getPlacementsForCard(card);
    const button = document.createElement("button");
    const canPlay = placements.length > 0;
    const canDiscard = mustDiscard;
    const isSelectable = isPlayersTurn && (canPlay || canDiscard);

    button.className = card.kind === "joker"
      ? "hand-card"
      : `hand-card ${suitMeta(card.suit).className}`;

    if (isPlayersTurn && canPlay) {
      button.classList.add("playable");
    }

    if (canDiscard) {
      button.classList.add("discardable");
    }

    if (state.pendingCardId === card.id) {
      button.classList.add("selected");
    }

    button.type = "button";
    button.disabled = !isSelectable;
    button.setAttribute("aria-label", cardLabel(card));

    createHandCardBody(button, card);

    button.addEventListener("click", () => {
      if (button.disabled) {
        return;
      }

      if (mustDiscard) {
        discardCard(0, card);
        return;
      }

      handleHumanPlay(card);
    });

    playerHandElement.appendChild(button);
  });

  if (state.result) {
    const row = state.result.rows.find((entry) => entry.playerIndex === 0);
    handHintElement.textContent = `${row.rank}位 / 捨て札 ${row.discardScore} 点 / ${row.net > 0 ? "+" : ""}${row.net}`;
  } else if (!state.started) {
    handHintElement.textContent = "配布しています...";
  } else if (human.hand.length === 0) {
    handHintElement.textContent = "あなたは手札を使い切りました。";
  } else if (state.turnIndex === 0) {
    handHintElement.textContent = playableCards.length > 0
      ? "出せるカードを1枚選んでください。小王・大王は置き先を選べます。"
      : "出せるカードがないので、手札を1枚捨ててください。";
  } else {
    handHintElement.textContent = "相手の手を待っています...";
  }
}

function renderLog() {
  logListElement.innerHTML = "";
  for (const item of state.log) {
    const li = document.createElement("li");
    li.textContent = item;
    logListElement.appendChild(li);
  }
}

function renderActionPanel() {
  actionButtonsElement.innerHTML = "";

  const human = getPlayerById(0);
  const pendingCard = getCardById(human, state.pendingCardId);

  if (
    state.result !== null ||
    state.turnIndex !== 0 ||
    state.busy ||
    !pendingCard ||
    state.pendingMoves.length === 0
  ) {
    actionPanelElement.hidden = true;
    return;
  }

  actionPanelElement.hidden = false;
  actionTitleElement.textContent = `${cardLabel(pendingCard)} の置き先を選んでください。`;

  state.pendingMoves.forEach((placement) => {
    const button = document.createElement("button");
    const suit = suitMeta(placement.suit);
    button.type = "button";
    button.className = `secondary-button choice-button ${suit.className}`;
    button.textContent = `${placementLabel(placement)} として出す`;
    button.addEventListener("click", () => {
      const liveCard = getCardById(getPlayerById(0), pendingCard.id);
      if (liveCard) {
        playCard(0, liveCard, placement);
      }
    });
    actionButtonsElement.appendChild(button);
  });
}

function renderScores() {
  scoreListElement.innerHTML = "";

  if (!state.result) {
    state.players.forEach((player) => {
      const item = document.createElement("li");
      item.textContent = `${player.name}: 手札 ${player.hand.length} 枚 / 捨て札 ${player.discards.length} 枚 / 捨て札点 ${totalDiscardScore(player)}`;
      scoreListElement.appendChild(item);
    });
    return;
  }

  const summary = document.createElement("li");
  summary.innerHTML = `<span class="score-item-strong">${state.result.winnerName} の勝ち</span> - ${state.result.winLabel} x${state.result.winMultiplier}`;
  scoreListElement.appendChild(summary);

  state.result.rows.forEach((row) => {
    const item = document.createElement("li");
    const sign = row.net > 0 ? "+" : "";
    item.innerHTML = `<span class="score-item-strong">${row.rank}位 ${row.name}</span> - 捨て札 ${row.discardScore}点 / 精算 ${sign}${row.net}`;
    scoreListElement.appendChild(item);
  });
}

function renderStatus() {
  if (state.result) {
    turnPillElement.textContent = `${state.result.winnerName} が勝ちました`;
    phasePillElement.textContent = `${state.result.winLabel} x${state.result.winMultiplier} で精算しています`;
    return;
  }

  const currentPlayer = getPlayerById(state.turnIndex);
  turnPillElement.textContent = `${currentPlayer.name} の番`;

  if (state.turnIndex === 0) {
    const human = getPlayerById(0);
    phasePillElement.textContent = getPlayableCards(human).length > 0
      ? "あなたは場に1枚出します"
      : "あなたは1枚を捨てます";
  } else if (state.busy) {
    phasePillElement.textContent = "CPU が手を選んでいます";
  } else {
    phasePillElement.textContent = "CPU の手番です";
  }
}

function renderAll() {
  renderBoard();
  renderOpponents();
  renderHand();
  renderActionPanel();
  renderStatus();
  renderScores();
  renderLog();
}

function removeCardFromHand(playerIndex, targetCard) {
  const player = getPlayerById(playerIndex);
  const cardIndex = player.hand.findIndex((card) => card.id === targetCard.id);

  if (cardIndex < 0) {
    return null;
  }

  return player.hand.splice(cardIndex, 1)[0];
}

function placeCardOnBoard(card, placement) {
  const lane = state.board[placement.suit];

  if (!lane.started) {
    lane.started = true;
    lane.low = 7;
    lane.high = 7;
  }

  lane.placed.set(placement.rank, card.kind === "joker"
    ? { kind: "joker", jokerSide: card.jokerSide }
    : { kind: "standard" });

  if (lane.low === null || placement.rank < lane.low) {
    lane.low = placement.rank;
  }

  if (lane.high === null || placement.rank > lane.high) {
    lane.high = placement.rank;
  }
}

function markPlayerFinished(playerIndex) {
  const player = getPlayerById(playerIndex);
  if (player.hand.length === 0 && !player.finished) {
    player.finished = true;
    addLog(`${player.name} の手札がなくなりました。`);
  }
}

function advanceTurn() {
  if (!hasCardsRemaining()) {
    return false;
  }

  let nextIndex = state.turnIndex;
  do {
    nextIndex = (nextIndex + 1) % state.players.length;
  } while (state.players[nextIndex].hand.length === 0);

  state.turnIndex = nextIndex;
  return true;
}

function buildRankingRows(winnerIndex) {
  const rows = state.players.map((player) => ({
    playerIndex: player.id,
    name: player.name,
    discardScore: totalDiscardScore(player),
  }));

  const rest = rows
    .filter((row) => row.playerIndex !== winnerIndex)
    .sort((a, b) => (
      a.discardScore - b.discardScore ||
      compareByRoundOrder(a.playerIndex, b.playerIndex)
    ));

  return [
    rows.find((row) => row.playerIndex === winnerIndex),
    ...rest,
  ].map((row, index) => ({
    ...row,
    rank: index + 1,
    basePayment: index === 1 ? 1 : index === 2 ? 2 : 0,
  }));
}

function settleGame() {
  if (state.cpuTimer !== null) {
    window.clearTimeout(state.cpuTimer);
    state.cpuTimer = null;
  }

  const specialWinners = state.players
    .filter((player) => player.playedCount === 0 && player.discards.length === player.initialHandCount)
    .sort((a, b) => compareByRoundOrder(a.id, b.id));

  let winner = null;

  if (specialWinners.length > 0) {
    winner = specialWinners[0];
  } else {
    winner = [...state.players].sort((a, b) => (
      totalDiscardScore(a) - totalDiscardScore(b) ||
      compareByRoundOrder(a.id, b.id)
    ))[0];
  }

  const rankingRows = buildRankingRows(winner.id);
  const winnerRow = rankingRows[0];
  const winInfo = determineWinnerMultiplier(winner, winner);
  let winnerGain = 0;

  rankingRows.forEach((row) => {
    row.net = 0;
    row.penaltyMultiplier = 1;
  });

  rankingRows.slice(1).forEach((row) => {
    row.penaltyMultiplier = penaltyMultiplier(row.discardScore);
    row.net = -(row.basePayment * winInfo.multiplier * row.penaltyMultiplier);
    winnerGain += -row.net;
  });

  winnerRow.net = winnerGain;

  state.result = {
    winnerIndex: winner.id,
    winnerName: winner.name,
    winnerScore: winnerRow.discardScore,
    winMultiplier: winInfo.multiplier,
    winLabel: winInfo.label,
    rows: rankingRows,
  };

  addLog(`${winner.name} が ${winInfo.label} で勝ちました。`);
  renderAll();
}

function completeTurn(playerIndex) {
  markPlayerFinished(playerIndex);

  if (!hasCardsRemaining()) {
    settleGame();
    return;
  }

  advanceTurn();
  state.busy = false;
  clearPendingAction();
  renderAll();
  maybeRunCpuTurn();
}

function playCard(playerIndex, card, placement) {
  if (state.result !== null || state.turnIndex !== playerIndex) {
    return;
  }

  const player = getPlayerById(playerIndex);
  const liveCard = getCardById(player, card.id);

  if (!liveCard) {
    return;
  }

  const matched = getPlacementsForCard(liveCard).find((candidate) => (
    candidate.suit === placement.suit &&
    candidate.rank === placement.rank &&
    candidate.side === placement.side
  ));

  if (!matched) {
    return;
  }

  const removedCard = removeCardFromHand(playerIndex, liveCard);
  if (!removedCard) {
    return;
  }

  placeCardOnBoard(removedCard, matched);
  player.playedCount += 1;
  player.lastAction = {
    type: "play",
    cardKind: removedCard.kind,
    rank: matched.rank,
    suit: matched.suit,
  };

  if (removedCard.kind === "joker") {
    addLog(`${player.name} が ${jokerName(removedCard)} を ${placementLabel(matched)} として出しました。`);
  } else {
    addLog(`${player.name} が ${cardLabel(removedCard)} を場に出しました。`);
  }

  completeTurn(playerIndex);
}

function discardCard(playerIndex, card) {
  if (state.result !== null || state.turnIndex !== playerIndex) {
    return;
  }

  const player = getPlayerById(playerIndex);
  const liveCard = getCardById(player, card.id);

  if (!liveCard || getPlacementsForCard(liveCard).length > 0) {
    return;
  }

  const removedCard = removeCardFromHand(playerIndex, liveCard);
  if (!removedCard) {
    return;
  }

  player.discards.push(removedCard);
  player.lastAction = {
    type: "discard",
    cardKind: removedCard.kind,
  };

  addLog(`${player.name} が裏向きで1枚捨てました。`);
  completeTurn(playerIndex);
}

function handleHumanPlay(card) {
  const placements = getPlacementsForCard(card);
  if (placements.length === 0) {
    return;
  }

  if (placements.length > 1) {
    if (state.pendingCardId === card.id) {
      clearPendingAction();
      renderAll();
      return;
    }

    state.pendingCardId = card.id;
    state.pendingMoves = placements;
    renderAll();
    return;
  }

  playCard(0, card, placements[0]);
}

function chooseCpuPlay(player) {
  const options = [];

  player.hand.forEach((card) => {
    getPlacementsForCard(card).forEach((placement) => {
      options.push({ card, placement });
    });
  });

  if (options.length === 0) {
    return null;
  }

  options.sort((a, b) => {
    if (a.placement.rank === 7 || b.placement.rank === 7) {
      return a.placement.rank === 7 ? -1 : 1;
    }

    const scoreDiff = cardScore(b.card) - cardScore(a.card);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    const distanceDiff = Math.abs(b.placement.rank - 7) - Math.abs(a.placement.rank - 7);
    if (distanceDiff !== 0) {
      return distanceDiff;
    }

    return suitOrder.indexOf(a.placement.suit) - suitOrder.indexOf(b.placement.suit);
  });

  return options[0];
}

function chooseCpuDiscard(player) {
  return [...player.hand].sort((a, b) => (
    cardScore(a) - cardScore(b) ||
    compareCards(a, b)
  ))[0];
}

function maybeRunCpuTurn() {
  if (state.result !== null || state.turnIndex === 0) {
    renderAll();
    return;
  }

  const currentPlayer = getPlayerById(state.turnIndex);
  if (!currentPlayer || currentPlayer.hand.length === 0) {
    advanceTurn();
    maybeRunCpuTurn();
    return;
  }

  state.busy = true;
  renderAll();

  const playerIndex = state.turnIndex;
  const currentGameId = state.gameId;

  state.cpuTimer = window.setTimeout(() => {
    state.cpuTimer = null;

    if (currentGameId !== state.gameId || state.result !== null) {
      return;
    }

    const player = getPlayerById(playerIndex);
    const chosenPlay = chooseCpuPlay(player);

    if (chosenPlay) {
      playCard(playerIndex, chosenPlay.card, chosenPlay.placement);
      return;
    }

    const discard = chooseCpuDiscard(player);
    if (discard) {
      discardCard(playerIndex, discard);
    }
  }, 700);
}

function setupGame() {
  if (state.cpuTimer !== null) {
    window.clearTimeout(state.cpuTimer);
    state.cpuTimer = null;
  }

  state.gameId += 1;
  clearPendingAction();
  initializeBoard();
  startLaneWithSpadeSeven();

  const deck = shuffle(createDeck());
  const players = playerNames.map((name, index) => ({
    id: index,
    name,
    isHuman: index === 0,
    hand: [],
    discards: [],
    playedCount: 0,
    initialHandCount: 0,
    finished: false,
    lastAction: null,
  }));

  deck.forEach((card, index) => {
    players[index % players.length].hand.push(card);
  });

  players.forEach((player) => {
    player.hand.sort(compareCards);
    player.initialHandCount = player.hand.length;
  });

  state.players = players;

  const starter = state.players.find((player) => player.hand.some((card) => card.kind === "standard" && card.suit === "S" && card.rank === 7));
  const openingCard = getCardById(starter, "S-7");
  removeCardFromHand(starter.id, openingCard);
  starter.playedCount += 1;
  starter.lastAction = {
    type: "play",
    cardKind: "standard",
    rank: 7,
    suit: "S",
  };

  state.roundOrder = [starter.id, (starter.id + 1) % players.length, (starter.id + 2) % players.length];
  state.turnIndex = state.roundOrder[1];
  state.started = true;
  state.busy = false;
  state.result = null;
  state.log = [
    `${starter.name} が開始時に ♠7 を出しました。`,
    `${getPlayerById(state.turnIndex).name} から時計回りに進行します。`,
  ];

  renderAll();
  maybeRunCpuTurn();
}

restartButtonElement.addEventListener("click", () => {
  setupGame();
});

setupGame();
