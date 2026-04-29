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
  ranking: null,
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
      if (rank !== 7) {
        deck.push(createStandardCard(suit.key, rank));
      }
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

  if (a.kind === "joker" && b.kind === "joker") {
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
  return card.jokerSide === "low" ? "ジョーカー（小）" : "ジョーカー（大）";
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
      low: 7,
      high: 7,
      placed: new Map([
        [7, { kind: "starter" }],
      ]),
    };
  }
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
    const nextRank = card.jokerSide === "low" ? lane.low - 1 : lane.high + 1;

    if (nextRank >= 1 && nextRank <= 13) {
      placements.push({
        suit: suit.key,
        rank: nextRank,
        side: card.jokerSide,
      });
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

function buildBoardCard(suitKey, rank, entry) {
  const suit = suitMeta(suitKey);
  const wrapper = document.createElement("div");
  wrapper.className = `playing-card ${suit.className}`;

  const top = document.createElement("div");
  top.className = "card-top";

  const center = document.createElement("div");
  center.className = "card-center";
  center.textContent = rankLabel(rank);

  const note = document.createElement("div");
  note.className = "card-note";

  if (entry.kind === "joker") {
    top.textContent = entry.jokerSide === "low" ? "J小" : "J大";
    note.textContent = "代用札";
  } else {
    top.textContent = `${suit.symbol}${rankLabel(rank)}`;
    note.textContent = suit.name;
  }

  wrapper.append(top, center, note);
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
    .forEach((player, index) => {
      const playerIndex = index + 1;
      const card = document.createElement("article");
      const active = state.turnIndex === playerIndex && state.ranking === null;
      card.className = `opponent-card ${active ? "active" : ""}`.trim();

      const name = document.createElement("p");
      name.className = "opponent-name";
      name.textContent = player.name;

      const meta = document.createElement("p");
      meta.className = "opponent-meta";

      if (state.ranking) {
        meta.textContent = `捨て札 ${player.discards.length} 枚 / ${totalDiscardScore(player)} 点`;
      } else if (player.hand.length === 0) {
        meta.textContent = `終了 / 捨て札 ${player.discards.length} 枚`;
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
  const top = document.createElement("div");
  top.className = "card-top";

  const center = document.createElement("div");
  center.className = "card-center";

  const note = document.createElement("div");
  note.className = "card-note";

  if (card.kind === "joker") {
    top.textContent = "JOKER";
    center.textContent = card.jokerSide === "low" ? "小" : "大";
    note.textContent = card.jokerSide === "low" ? "7より小さい側専用 / 14点" : "7より大きい側専用 / 15点";
  } else {
    const suit = suitMeta(card.suit);
    top.textContent = `${suit.symbol}${rankLabel(card.rank)}`;
    center.textContent = suit.symbol;
    note.textContent = `${suit.name} / ${card.rank}点`;
  }

  button.append(top, center, note);
}

function renderHand() {
  const human = getPlayerById(0);
  const isPlayersTurn = state.turnIndex === 0 && state.ranking === null && !state.busy;
  const playableCards = getPlayableCards(human);
  const mustDiscard = isPlayersTurn && playableCards.length === 0 && human.hand.length > 0;

  playerHandElement.innerHTML = "";

  if (human.hand.length === 0) {
    const placeholder = document.createElement("div");
    placeholder.className = "hand-placeholder";
    placeholder.textContent = state.ranking ? "ゲーム終了です。" : "あなたの手札はなくなりました。結果を待っています。";
    playerHandElement.appendChild(placeholder);
  }

  human.hand.forEach((card) => {
    const placements = getPlacementsForCard(card);
    const canPlay = placements.length > 0;
    const canDiscard = mustDiscard;
    const isSelectable = isPlayersTurn && (canPlay || canDiscard);
    const button = document.createElement("button");

    if (card.kind === "joker") {
      button.className = "hand-card";
    } else {
      button.className = `hand-card ${suitMeta(card.suit).className}`;
    }

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

  if (state.ranking) {
    const winners = state.ranking.filter((entry) => entry.score === state.ranking[0].score);
    handHintElement.textContent = winners.length === 1
      ? `${winners[0].name} が ${winners[0].score} 点で勝ちです。`
      : `${winners.map((entry) => entry.name).join(" / ")} が同点トップです。`;
  } else if (!state.started) {
    handHintElement.textContent = "配布しています...";
  } else if (human.hand.length === 0) {
    handHintElement.textContent = "あなたは終了しました。ほかのプレイヤーの結果を待っています。";
  } else if (state.turnIndex === 0) {
    handHintElement.textContent = playableCards.length > 0
      ? "出せるカードを1枚選んでください。ジョーカーは置き先を選べます。"
      : "出せるカードがないため、1枚を裏向きで捨ててください。";
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
    state.ranking !== null ||
    state.turnIndex !== 0 ||
    state.busy ||
    !pendingCard ||
    state.pendingMoves.length === 0
  ) {
    actionPanelElement.hidden = true;
    return;
  }

  actionPanelElement.hidden = false;
  actionTitleElement.textContent = `${cardLabel(pendingCard)} をどこに置くか選んでください。`;

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

  if (!state.ranking) {
    state.players.forEach((player) => {
      const item = document.createElement("li");
      item.textContent = `${player.name}: 手札 ${player.hand.length} 枚 / 捨て札 ${player.discards.length} 枚`;
      scoreListElement.appendChild(item);
    });
    return;
  }

  let displayRank = 0;
  let previousScore = null;

  state.ranking.forEach((entry, index) => {
    if (entry.score !== previousScore) {
      displayRank = index + 1;
      previousScore = entry.score;
    }

    const item = document.createElement("li");
    item.innerHTML = `<span class="score-item-strong">${displayRank}位 ${entry.name}</span> - ${entry.score} 点 / 捨て札 ${entry.discardCount} 枚`;
    scoreListElement.appendChild(item);
  });
}

function renderStatus() {
  if (state.ranking) {
    const topScore = state.ranking[0].score;
    const winners = state.ranking.filter((entry) => entry.score === topScore);

    turnPillElement.textContent = winners.length === 1
      ? `${winners[0].name} が勝ちました`
      : `${winners.length} 人が同点トップです`;
    phasePillElement.textContent = "捨て札の合計点が少ない順で順位を表示しています";
    return;
  }

  const currentPlayer = getPlayerById(state.turnIndex);
  turnPillElement.textContent = `${currentPlayer.name} の番`;

  if (state.turnIndex === 0) {
    const human = getPlayerById(0);
    phasePillElement.textContent = getPlayableCards(human).length > 0
      ? "あなたは場に1枚出します"
      : "あなたは1枚を裏向きで捨てます";
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

function setupGame() {
  if (state.cpuTimer !== null) {
    window.clearTimeout(state.cpuTimer);
    state.cpuTimer = null;
  }

  state.gameId += 1;
  clearPendingAction();
  initializeBoard();

  const deck = shuffle(createDeck());
  const players = [
    { name: "あなた", isHuman: true, hand: [], discards: [], finished: false },
    { name: "CPU 1", isHuman: false, hand: [], discards: [], finished: false },
    { name: "CPU 2", isHuman: false, hand: [], discards: [], finished: false },
    { name: "CPU 3", isHuman: false, hand: [], discards: [], finished: false },
  ];

  deck.forEach((card, index) => {
    players[index % 4].hand.push(card);
  });

  players.forEach((player) => {
    player.hand.sort(compareCards);
  });

  state.players = players;
  state.turnIndex = Math.floor(Math.random() * state.players.length);
  state.started = true;
  state.busy = false;
  state.ranking = null;
  state.log = [
    "4つの 7 が最初から場に並んでいます。",
    "出せるカードがない場合は、必ず1枚を裏向きで捨てます。",
    `${state.players[state.turnIndex].name} からスタートします。`,
  ];

  renderAll();
  maybeRunCpuTurn();
}

function removeCardFromHand(playerIndex, targetCard) {
  const player = getPlayerById(playerIndex);
  const cardIndex = player.hand.findIndex((card) => card.id === targetCard.id);

  if (cardIndex >= 0) {
    return player.hand.splice(cardIndex, 1)[0];
  }

  return null;
}

function placeCardOnBoard(card, placement) {
  const lane = state.board[placement.suit];
  lane.placed.set(placement.rank, card.kind === "joker"
    ? { kind: "joker", jokerSide: card.jokerSide }
    : { kind: "standard" });

  if (placement.rank < lane.low) {
    lane.low = placement.rank;
  }

  if (placement.rank > lane.high) {
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

function finishGame() {
  if (state.cpuTimer !== null) {
    window.clearTimeout(state.cpuTimer);
    state.cpuTimer = null;
  }

  state.busy = false;
  clearPendingAction();

  state.ranking = state.players
    .map((player, index) => ({
      playerIndex: index,
      name: player.name,
      score: totalDiscardScore(player),
      discardCount: player.discards.length,
    }))
    .sort((a, b) => a.score - b.score || a.discardCount - b.discardCount || a.playerIndex - b.playerIndex);

  const topScore = state.ranking[0].score;
  const winners = state.ranking.filter((entry) => entry.score === topScore);

  if (winners.length === 1) {
    addLog(`${winners[0].name} が最少 ${winners[0].score} 点で勝ちです。`);
  } else {
    addLog(`${winners.map((entry) => entry.name).join(" / ")} が ${topScore} 点で同点トップです。`);
  }

  renderAll();
}

function completeTurn(playerIndex) {
  markPlayerFinished(playerIndex);

  if (!hasCardsRemaining()) {
    finishGame();
    return;
  }

  advanceTurn();
  state.busy = false;
  clearPendingAction();
  renderAll();
  maybeRunCpuTurn();
}

function playCard(playerIndex, card, placement) {
  if (state.ranking !== null || state.turnIndex !== playerIndex) {
    return;
  }

  const liveCard = getCardById(getPlayerById(playerIndex), card.id);
  if (!liveCard) {
    return;
  }

  const placements = getPlacementsForCard(liveCard);
  const matchedPlacement = placements.find((candidate) => (
    candidate.suit === placement.suit &&
    candidate.rank === placement.rank &&
    candidate.side === placement.side
  ));

  if (!matchedPlacement) {
    return;
  }

  const removedCard = removeCardFromHand(playerIndex, liveCard);
  if (!removedCard) {
    return;
  }

  placeCardOnBoard(removedCard, matchedPlacement);

  if (removedCard.kind === "joker") {
    addLog(`${getPlayerById(playerIndex).name} が ${jokerName(removedCard)} を ${placementLabel(matchedPlacement)} として出しました。`);
  } else {
    addLog(`${getPlayerById(playerIndex).name} が ${cardLabel(removedCard)} を場に出しました。`);
  }

  completeTurn(playerIndex);
}

function discardCard(playerIndex, card) {
  if (state.ranking !== null || state.turnIndex !== playerIndex) {
    return;
  }

  const player = getPlayerById(playerIndex);

  if (getPlacementsForCard(card).length > 0) {
    return;
  }

  const removedCard = removeCardFromHand(playerIndex, card);
  if (!removedCard) {
    return;
  }

  player.discards.push(removedCard);
  addLog(`${player.name} が裏向きで1枚捨てました。`);
  completeTurn(playerIndex);
}

function handleHumanPlay(card) {
  const placements = getPlacementsForCard(card);
  if (placements.length === 0) {
    return;
  }

  if (card.kind === "joker" && placements.length > 1) {
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
    const placements = getPlacementsForCard(card);
    placements.forEach((placement) => {
      options.push({ card, placement });
    });
  });

  if (options.length === 0) {
    return null;
  }

  options.sort((a, b) => {
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
  const candidates = [...player.hand];

  candidates.sort((a, b) => {
    const scoreDiff = cardScore(a) - cardScore(b);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }

    return compareCards(a, b);
  });

  return candidates[0];
}

function maybeRunCpuTurn() {
  if (state.ranking !== null || state.turnIndex === 0) {
    renderAll();
    return;
  }

  const currentPlayer = getPlayerById(state.turnIndex);
  if (currentPlayer.hand.length === 0) {
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

    if (currentGameId !== state.gameId || state.ranking !== null) {
      return;
    }

    const livePlayer = getPlayerById(playerIndex);
    const chosenPlay = chooseCpuPlay(livePlayer);

    if (chosenPlay) {
      playCard(playerIndex, chosenPlay.card, chosenPlay.placement);
      return;
    }

    const discard = chooseCpuDiscard(livePlayer);
    if (discard) {
      discardCard(playerIndex, discard);
    }
  }, 850);
}

restartButtonElement.addEventListener("click", () => {
  setupGame();
});

setupGame();
