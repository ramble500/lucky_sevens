export const suits = [
  { key: "S", symbol: "♠", name: "スペード", className: "card-black" },
  { key: "H", symbol: "♥", name: "ハート", className: "card-red" },
  { key: "D", symbol: "♦", name: "ダイヤ", className: "card-orange" },
  { key: "C", symbol: "♣", name: "クラブ", className: "card-green" },
];

export const rankLabels = {
  1: "A",
  11: "J",
  12: "Q",
  13: "K",
};

export const suitOrder = ["S", "H", "D", "C"];
export const playerNames = ["あなた", "CPU 1", "CPU 2"];
export const defaultPlayerConfigs = playerNames.map((name, index) => ({
  name,
  isHuman: index === 0,
}));

export function createInitialState() {
  return {
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
    viewerPlayerId: 0,
    playMode: "local",
  };
}

function normalizePlayerConfig(config, index) {
  if (typeof config === "string") {
    return {
      name: config,
      isHuman: index === 0,
    };
  }

  return {
    name: config?.name || `Player ${index + 1}`,
    isHuman: config?.isHuman ?? index === 0,
  };
}

function resolvePlayerConfigs(playerConfigs) {
  const source = Array.isArray(playerConfigs) && playerConfigs.length > 0
    ? playerConfigs
    : defaultPlayerConfigs;

  return source.map((config, index) => normalizePlayerConfig(config, index));
}

export function rankLabel(rank) {
  return rankLabels[rank] || String(rank);
}

export function suitMeta(suitKey) {
  return suits.find((suit) => suit.key === suitKey);
}

function orderIndex(state, playerIndex) {
  return state.roundOrder.indexOf(playerIndex);
}

function compareByRoundOrder(state, aIndex, bIndex) {
  return orderIndex(state, aIndex) - orderIndex(state, bIndex);
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

export function compareCards(a, b) {
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

export function cardScore(card) {
  return card.score;
}

export function serializeCard(card) {
  if (!card) {
    return null;
  }

  return { ...card };
}

export function jokerName(card) {
  return card.jokerSide === "low" ? "小王" : "大王";
}

export function cardLabel(card) {
  if (card.kind === "joker") {
    return jokerName(card);
  }

  const suit = suitMeta(card.suit);
  return `${suit.symbol}${rankLabel(card.rank)}`;
}

export function placementLabel(placement) {
  const suit = suitMeta(placement.suit);
  return `${suit.symbol}${rankLabel(placement.rank)}`;
}

function initializeBoard(state) {
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

function startLaneWithSpadeSeven(state) {
  const lane = state.board.S;
  lane.started = true;
  lane.low = 7;
  lane.high = 7;
  lane.placed.set(7, { kind: "standard" });
}

export function getPlacementsForCard(state, card) {
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

export function getPlayableCards(state, player) {
  return player.hand.filter((card) => getPlacementsForCard(state, card).length > 0);
}

export function getPlayerById(state, playerIndex) {
  return state.players[playerIndex];
}

export function getCardById(player, cardId) {
  return player.hand.find((card) => card.id === cardId) || null;
}

export function pushGameLog(state, message, limit = 12) {
  state.log.unshift(message);
  state.log = state.log.slice(0, limit);
}

export function hasCardsRemaining(state) {
  return state.players.some((player) => player.hand.length > 0);
}

export function totalDiscardScore(player) {
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

function removeCardFromHand(state, playerIndex, targetCard) {
  const player = getPlayerById(state, playerIndex);
  const cardIndex = player.hand.findIndex((card) => card.id === targetCard.id);

  if (cardIndex < 0) {
    return null;
  }

  return player.hand.splice(cardIndex, 1)[0];
}

function placeCardOnBoard(state, card, placement) {
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

export function markPlayerFinished(state, playerIndex) {
  const player = getPlayerById(state, playerIndex);
  if (player.hand.length === 0 && !player.finished) {
    player.finished = true;
    return player;
  }

  return null;
}

export function advanceTurn(state) {
  if (!hasCardsRemaining(state)) {
    return false;
  }

  let nextIndex = state.turnIndex;
  do {
    nextIndex = (nextIndex + 1) % state.players.length;
  } while (state.players[nextIndex].hand.length === 0);

  state.turnIndex = nextIndex;
  return true;
}

function buildRankingRows(state, winnerIndex) {
  const rows = state.players.map((player) => ({
    playerIndex: player.id,
    name: player.name,
    discardScore: totalDiscardScore(player),
  }));

  const rest = rows
    .filter((row) => row.playerIndex !== winnerIndex)
    .sort((a, b) => (
      a.discardScore - b.discardScore ||
      compareByRoundOrder(state, a.playerIndex, b.playerIndex)
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

export function buildGameResult(state) {
  const specialWinners = state.players
    .filter((player) => player.playedCount === 0 && player.discards.length === player.initialHandCount)
    .sort((a, b) => compareByRoundOrder(state, a.id, b.id));

  let winner = null;

  if (specialWinners.length > 0) {
    winner = specialWinners[0];
  } else {
    winner = [...state.players].sort((a, b) => (
      totalDiscardScore(a) - totalDiscardScore(b) ||
      compareByRoundOrder(state, a.id, b.id)
    ))[0];
  }

  const rankingRows = buildRankingRows(state, winner.id);
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

  return {
    winnerIndex: winner.id,
    winnerName: winner.name,
    winnerScore: winnerRow.discardScore,
    winMultiplier: winInfo.multiplier,
    winLabel: winInfo.label,
    rows: rankingRows,
  };
}

export function serializeBoard(board) {
  const snapshot = {};

  suits.forEach((suit) => {
    const lane = board[suit.key];
    snapshot[suit.key] = {
      started: lane.started,
      low: lane.low,
      high: lane.high,
      placed: Array.from(lane.placed.entries()).map(([rank, entry]) => ({
        rank,
        entry: { ...entry },
      })),
    };
  });

  return snapshot;
}

export function hydrateBoard(snapshot = {}) {
  const board = {};

  suits.forEach((suit) => {
    const lane = snapshot[suit.key] || {};
    board[suit.key] = {
      started: Boolean(lane.started),
      low: lane.low ?? null,
      high: lane.high ?? null,
      placed: new Map(
        (lane.placed || []).map((item) => [
          item.rank,
          { ...item.entry },
        ]),
      ),
    };
  });

  return board;
}

function cloneResult(result) {
  if (!result) {
    return null;
  }

  return {
    ...result,
    rows: result.rows.map((row) => ({ ...row })),
  };
}

export function createPublicGameView(state, viewerPlayerId) {
  const revealAllHiddenCards = state.result !== null;

  return {
    viewerPlayerId,
    started: state.started,
    turnIndex: state.turnIndex,
    log: [...state.log],
    roundOrder: [...state.roundOrder],
    result: cloneResult(state.result),
    board: serializeBoard(state.board),
    players: state.players.map((player) => ({
      id: player.id,
      name: player.name,
      isHuman: player.isHuman,
      isSelf: player.id === viewerPlayerId,
      hand: revealAllHiddenCards || player.id === viewerPlayerId
        ? player.hand.map((card) => serializeCard(card))
        : [],
      handCount: player.hand.length,
      discards: revealAllHiddenCards || player.id === viewerPlayerId
        ? player.discards.map((card) => serializeCard(card))
        : [],
      discardCount: player.discards.length,
      playedCount: player.playedCount,
      initialHandCount: player.initialHandCount,
      finished: player.finished,
      lastAction: player.lastAction ? { ...player.lastAction } : null,
    })),
  };
}

export function hydratePublicGameView(view) {
  return {
    ...createInitialState(),
    started: Boolean(view?.started),
    turnIndex: view?.turnIndex ?? 0,
    log: [...(view?.log || [])],
    roundOrder: [...(view?.roundOrder || [])],
    result: cloneResult(view?.result || null),
    board: hydrateBoard(view?.board),
    viewerPlayerId: view?.viewerPlayerId ?? 0,
    playMode: "room",
    players: (view?.players || [])
      .map((player) => ({
        id: player.id,
        name: player.name,
        isHuman: Boolean(player.isHuman),
        isSelf: Boolean(player.isSelf),
        hand: (player.hand || []).map((card) => serializeCard(card)),
        handCount: player.handCount ?? (player.hand || []).length,
        discards: (player.discards || []).map((card) => serializeCard(card)),
        discardCount: player.discardCount ?? (player.discards || []).length,
        playedCount: player.playedCount ?? 0,
        initialHandCount: player.initialHandCount ?? 0,
        finished: Boolean(player.finished),
        lastAction: player.lastAction ? { ...player.lastAction } : null,
      }))
      .sort((a, b) => a.id - b.id),
  };
}

export function playCard(state, playerIndex, card, placement) {
  if (state.result !== null || state.turnIndex !== playerIndex) {
    return null;
  }

  const player = getPlayerById(state, playerIndex);
  const liveCard = getCardById(player, card.id);

  if (!liveCard) {
    return null;
  }

  const matchedPlacement = getPlacementsForCard(state, liveCard).find((candidate) => (
    candidate.suit === placement.suit &&
    candidate.rank === placement.rank &&
    candidate.side === placement.side
  ));

  if (!matchedPlacement) {
    return null;
  }

  const removedCard = removeCardFromHand(state, playerIndex, liveCard);
  if (!removedCard) {
    return null;
  }

  placeCardOnBoard(state, removedCard, matchedPlacement);
  player.playedCount += 1;
  player.lastAction = {
    type: "play",
    cardKind: removedCard.kind,
    rank: matchedPlacement.rank,
    suit: matchedPlacement.suit,
  };

  return {
    player,
    removedCard,
    matchedPlacement,
  };
}

export function discardCard(state, playerIndex, card) {
  if (state.result !== null || state.turnIndex !== playerIndex) {
    return null;
  }

  const player = getPlayerById(state, playerIndex);
  const liveCard = getCardById(player, card.id);

  if (!liveCard || getPlacementsForCard(state, liveCard).length > 0) {
    return null;
  }

  const removedCard = removeCardFromHand(state, playerIndex, liveCard);
  if (!removedCard) {
    return null;
  }

  player.discards.push(removedCard);
  player.lastAction = {
    type: "discard",
    cardKind: removedCard.kind,
  };

  return {
    player,
    removedCard,
  };
}

export function setupRound(state, playerConfigs) {
  initializeBoard(state);
  startLaneWithSpadeSeven(state);

  const deck = shuffle(createDeck());
  const resolvedConfigs = resolvePlayerConfigs(playerConfigs);
  const players = resolvedConfigs.map((config, index) => ({
    id: index,
    name: config.name,
    isHuman: config.isHuman,
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

  const starter = state.players.find((player) => player.hand.some((card) => (
    card.kind === "standard" && card.suit === "S" && card.rank === 7
  )));
  const openingCard = getCardById(starter, "S-7");
  removeCardFromHand(state, starter.id, openingCard);
  starter.playedCount += 1;
  starter.lastAction = {
    type: "play",
    cardKind: "standard",
    rank: 7,
    suit: "S",
  };

  state.roundOrder = [starter.id, (starter.id + 1) % players.length, (starter.id + 2) % players.length];
  state.turnIndex = state.roundOrder[1];

  return {
    starter,
    nextPlayer: getPlayerById(state, state.turnIndex),
  };
}
