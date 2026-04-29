import { cardScore, compareCards, getPlacementsForCard, suitOrder } from "./rules.js";

export function chooseCpuPlay(state, player) {
  const options = [];

  player.hand.forEach((card) => {
    getPlacementsForCard(state, card).forEach((placement) => {
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

export function chooseCpuDiscard(player) {
  return [...player.hand].sort((a, b) => (
    cardScore(a) - cardScore(b) ||
    compareCards(a, b)
  ))[0];
}
