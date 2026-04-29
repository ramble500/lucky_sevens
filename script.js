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

const state = {
  players: [],
  board: {},
  turnIndex: 0,
  winnerIndex: null,
  started: false,
  busy: false,
  log: [],
  cpuTimer: null,
  gameId: 0,
};

const boardElement = document.getElementById("board");
const opponentsElement = document.getElementById("opponents");
const playerHandElement = document.getElementById("player-hand");
const logListElement = document.getElementById("log-list");
const turnPillElement = document.getElementById("turn-pill");
const phasePillElement = document.getElementById("phase-pill");
const handHintElement = document.getElementById("hand-hint");
const passButtonElement = document.getElementById("pass-button");
const restartButtonElement = document.getElementById("restart-button");

function createDeck() {
  const deck = [];
  for (const suit of suits) {
    for (let rank = 1; rank <= 13; rank += 1) {
      deck.push({
        suit: suit.key,
        rank,
      });
    }
  }
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

function rankLabel(rank) {
  return rankLabels[rank] || String(rank);
}

function suitMeta(suitKey) {
  return suits.find((suit) => suit.key === suitKey);
}

function cardLabel(card) {
  const suit = suitMeta(card.suit);
  return `${suit.symbol}${rankLabel(card.rank)}`;
}

function compareCards(a, b) {
  const suitOrder = ["S", "H", "D", "C"];
  const suitDiff = suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit);
  if (suitDiff !== 0) {
    return suitDiff;
  }
  return a.rank - b.rank;
}

function canPlay(card) {
  const lane = state.board[card.suit];
  return card.rank === lane.low - 1 || card.rank === lane.high + 1;
}

function getPlayableCards(player) {
  return player.hand.filter(canPlay);
}

function addLog(message) {
  state.log.unshift(message);
  state.log = state.log.slice(0, 10);
  renderLog();
}

function buildPlayingCard(card, compact = false) {
  const suit = suitMeta(card.suit);
  const wrapper = document.createElement("div");
  wrapper.className = `playing-card ${suit.className}`;

  const top = document.createElement("div");
  top.className = "card-top";
  top.textContent = `${suit.symbol}${rankLabel(card.rank)}`;

  const center = document.createElement("div");
  center.className = "card-center";
  center.textContent = compact ? rankLabel(card.rank) : suit.symbol;

  wrapper.append(top, center);
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
      const placed = state.board[suit.key].placed.has(rank);
      slot.className = `board-slot ${placed ? "" : "empty"}`.trim();

      if (placed) {
        slot.appendChild(buildPlayingCard({ suit: suit.key, rank }, true));
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
      const card = document.createElement("article");
      const active = state.turnIndex === index + 1 && state.winnerIndex === null;
      card.className = `opponent-card ${active ? "active" : ""}`.trim();

      const name = document.createElement("p");
      name.className = "opponent-name";
      name.textContent = player.name;

      const meta = document.createElement("p");
      meta.className = "opponent-meta";
      meta.textContent = `手札 ${player.hand.length} 枚`;

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

function renderLog() {
  logListElement.innerHTML = "";
  for (const item of state.log) {
    const li = document.createElement("li");
    li.textContent = item;
    logListElement.appendChild(li);
  }
}

function renderHand() {
  const human = state.players[0];
  const isPlayersTurn = state.turnIndex === 0 && state.winnerIndex === null && !state.busy;
  const playableRanks = new Set(getPlayableCards(human).map((card) => `${card.suit}-${card.rank}`));

  playerHandElement.innerHTML = "";

  human.hand.forEach((card) => {
    const button = document.createElement("button");
    const suit = suitMeta(card.suit);
    const playable = playableRanks.has(`${card.suit}-${card.rank}`) && isPlayersTurn;
    button.className = `hand-card ${suit.className} ${playable ? "playable" : ""}`.trim();
    button.type = "button";
    button.disabled = !playable;
    button.setAttribute("aria-label", `${suit.name}の${rankLabel(card.rank)}`);

    const top = document.createElement("div");
    top.className = "card-top";
    top.textContent = `${suit.symbol}${rankLabel(card.rank)}`;

    const center = document.createElement("div");
    center.className = "card-center";
    center.textContent = suit.symbol;

    button.append(top, center);
    button.addEventListener("click", () => {
      if (!button.disabled) {
        playTurn(0, card);
      }
    });

    playerHandElement.appendChild(button);
  });

  if (state.winnerIndex !== null) {
    const winner = state.players[state.winnerIndex];
    handHintElement.innerHTML = `<span class="winner-banner">${winner.name} の勝ち！</span>`;
  } else if (!state.started) {
    handHintElement.textContent = "配布しています...";
  } else if (state.turnIndex === 0) {
    handHintElement.textContent = playableRanks.size > 0
      ? "光っているカードから1枚選んでください。"
      : "出せるカードがありません。パスできます。";
  } else {
    handHintElement.textContent = "相手の手を待っています...";
  }
}

function renderStatus() {
  if (state.winnerIndex !== null) {
    turnPillElement.textContent = `${state.players[state.winnerIndex].name} が勝ちました`;
    phasePillElement.textContent = "もう一度遊ぶなら新しく配る";
    passButtonElement.disabled = true;
    return;
  }

  const currentPlayer = state.players[state.turnIndex];
  turnPillElement.textContent = `${currentPlayer.name} の番`;

  if (state.turnIndex === 0) {
    phasePillElement.textContent = "あなたがカードを出します";
  } else if (state.busy) {
    phasePillElement.textContent = "CPU が考えています";
  } else {
    phasePillElement.textContent = "CPU の手番です";
  }

  const humanHasMove = getPlayableCards(state.players[0]).length > 0;
  passButtonElement.disabled = !state.started || state.turnIndex !== 0 || state.busy || humanHasMove;
}

function renderAll() {
  renderBoard();
  renderOpponents();
  renderHand();
  renderStatus();
  renderLog();
}

function initializeBoard() {
  state.board = {};
  for (const suit of suits) {
    state.board[suit.key] = {
      low: 7,
      high: 7,
      placed: new Set([7]),
    };
  }
}

function setupGame() {
  if (state.cpuTimer !== null) {
    window.clearTimeout(state.cpuTimer);
    state.cpuTimer = null;
  }

  state.gameId += 1;
  initializeBoard();

  const deck = shuffle(createDeck());
  const players = [
    { name: "あなた", isHuman: true, hand: [] },
    { name: "CPU 1", isHuman: false, hand: [] },
    { name: "CPU 2", isHuman: false, hand: [] },
    { name: "CPU 3", isHuman: false, hand: [] },
  ];

  deck.forEach((card, index) => {
    players[index % 4].hand.push(card);
  });

  players.forEach((player) => {
    player.hand = player.hand
      .filter((card) => card.rank !== 7)
      .sort(compareCards);
  });

  state.players = players;
  state.turnIndex = Math.floor(Math.random() * state.players.length);
  state.winnerIndex = null;
  state.started = true;
  state.busy = false;
  state.log = [
    "4つの 7 が場に並びました。",
    `${state.players[state.turnIndex].name} からスタートします。`,
  ];

  renderAll();
  maybeRunCpuTurn();
}

function removeCardFromHand(playerIndex, targetCard) {
  const player = state.players[playerIndex];
  const cardIndex = player.hand.findIndex((card) => card.suit === targetCard.suit && card.rank === targetCard.rank);
  if (cardIndex >= 0) {
    player.hand.splice(cardIndex, 1);
  }
}

function placeCard(card) {
  const lane = state.board[card.suit];
  lane.placed.add(card.rank);
  if (card.rank < lane.low) {
    lane.low = card.rank;
  }
  if (card.rank > lane.high) {
    lane.high = card.rank;
  }
}

function advanceTurn() {
  state.turnIndex = (state.turnIndex + 1) % state.players.length;
}

function checkWinner(playerIndex) {
  if (state.players[playerIndex].hand.length === 0) {
    state.winnerIndex = playerIndex;
    addLog(`${state.players[playerIndex].name} が手札を出し切りました。`);
    return true;
  }
  return false;
}

function playTurn(playerIndex, card) {
  if (state.winnerIndex !== null || state.turnIndex !== playerIndex || !canPlay(card)) {
    return;
  }

  const player = state.players[playerIndex];
  removeCardFromHand(playerIndex, card);
  placeCard(card);
  addLog(`${player.name} が ${cardLabel(card)} を出しました。`);

  if (checkWinner(playerIndex)) {
    state.busy = false;
    renderAll();
    return;
  }

  advanceTurn();
  state.busy = false;
  renderAll();
  maybeRunCpuTurn();
}

function passTurn(playerIndex) {
  if (state.winnerIndex !== null || state.turnIndex !== playerIndex) {
    return;
  }

  const player = state.players[playerIndex];
  addLog(`${player.name} はパスしました。`);
  advanceTurn();
  state.busy = false;
  renderAll();
  maybeRunCpuTurn();
}

function chooseCpuCard(player) {
  const playable = getPlayableCards(player);
  if (playable.length === 0) {
    return null;
  }

  playable.sort((a, b) => {
    const aDistance = Math.abs(a.rank - 7);
    const bDistance = Math.abs(b.rank - 7);
    if (aDistance !== bDistance) {
      return bDistance - aDistance;
    }
    return compareCards(a, b);
  });

  return playable[0];
}

function maybeRunCpuTurn() {
  if (state.winnerIndex !== null || state.turnIndex === 0) {
    renderAll();
    return;
  }

  state.busy = true;
  renderAll();

  const playerIndex = state.turnIndex;
  const player = state.players[playerIndex];
  const currentGameId = state.gameId;

  state.cpuTimer = window.setTimeout(() => {
    state.cpuTimer = null;
    if (currentGameId !== state.gameId) {
      return;
    }

    const chosen = chooseCpuCard(player);
    if (chosen) {
      playTurn(playerIndex, chosen);
    } else {
      passTurn(playerIndex);
    }
  }, 850);
}

passButtonElement.addEventListener("click", () => {
  if (state.turnIndex !== 0 || state.busy) {
    return;
  }
  passTurn(0);
});

restartButtonElement.addEventListener("click", () => {
  setupGame();
});

setupGame();
