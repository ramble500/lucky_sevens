window.SevensAI = (() => {
  const Rules = window.SevensRules;

  function chooseCpuPlay(state, player) {
    const options = [];

    player.hand.forEach((card) => {
      Rules.getPlacementsForCard(state, card).forEach((placement) => {
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

      const scoreDiff = Rules.cardScore(b.card) - Rules.cardScore(a.card);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      const distanceDiff = Math.abs(b.placement.rank - 7) - Math.abs(a.placement.rank - 7);
      if (distanceDiff !== 0) {
        return distanceDiff;
      }

      return Rules.suitOrder.indexOf(a.placement.suit) - Rules.suitOrder.indexOf(b.placement.suit);
    });

    return options[0];
  }

  function chooseCpuDiscard(player) {
    return [...player.hand].sort((a, b) => (
      Rules.cardScore(a) - Rules.cardScore(b) ||
      Rules.compareCards(a, b)
    ))[0];
  }

  return {
    chooseCpuPlay,
    chooseCpuDiscard,
  };
})();
