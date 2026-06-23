(() => {
  const Rules = window.SevensRules;
  const AI = window.SevensAI;
  const UI = window.SevensUI;

  const restartButtonElement = document.getElementById("restart-button");

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

  function render() {
    UI.renderAll(state, {
      onCardClick,
      onPlacementSelect,
    });
  }

  function finishGame() {
    clearCpuTimer();
    state.busy = false;
    clearPendingAction();
    state.result = Rules.buildGameResult(state);
    addLog(`${state.result.winnerName} が ${state.result.winLabel} で勝ちました。`);
    render();
  }

  function completeTurn(playerIndex) {
    const finishedPlayer = Rules.markPlayerFinished(state, playerIndex);
    if (finishedPlayer) {
      addLog(`${finishedPlayer.name} の手札がなくなりました。`);
    }

    if (!Rules.hasCardsRemaining(state)) {
      finishGame();
      return;
    }

    Rules.advanceTurn(state);
    state.busy = false;
    clearPendingAction();
    render();
    maybeRunCpuTurn();
  }

  function playCardAndContinue(playerIndex, card, placement) {
    const outcome = Rules.playCard(state, playerIndex, card, placement);
    if (!outcome) {
      return false;
    }

    if (outcome.removedCard.kind === "joker") {
      addLog(`${outcome.player.name} が ${Rules.jokerName(outcome.removedCard)} を ${Rules.placementLabel(outcome.matchedPlacement)} として出しました。`);
    } else {
      addLog(`${outcome.player.name} が ${Rules.cardLabel(outcome.removedCard)} を場に出しました。`);
    }

    completeTurn(playerIndex);
    return true;
  }

  function discardCardAndContinue(playerIndex, card) {
    const outcome = Rules.discardCard(state, playerIndex, card);
    if (!outcome) {
      return false;
    }

    addLog(`${outcome.player.name} が裏向きで1枚捨てました。`);
    completeTurn(playerIndex);
    return true;
  }

  function handleHumanPlay(card) {
    const placements = Rules.getPlacementsForCard(state, card);
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

    playCardAndContinue(0, card, placements[0]);
  }

  function onCardClick(card, context) {
    if (context.mustDiscard) {
      discardCardAndContinue(0, card);
      return;
    }

    handleHumanPlay(card);
  }

  function onPlacementSelect(cardId, placement) {
    const human = Rules.getPlayerById(state, 0);
    const liveCard = human ? Rules.getCardById(human, cardId) : null;
    if (!liveCard) {
      return;
    }

    playCardAndContinue(0, liveCard, placement);
  }

  function maybeRunCpuTurn() {
    if (state.result !== null || state.turnIndex === 0) {
      render();
      return;
    }

    const currentPlayer = Rules.getPlayerById(state, state.turnIndex);
    if (!currentPlayer || currentPlayer.hand.length === 0) {
      Rules.advanceTurn(state);
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

        const player = Rules.getPlayerById(state, playerIndex);
        const action = AI.chooseCpuAction(state, player);

        if (!action) {
          state.busy = false;
          addLog("CPU の手番処理に失敗しました。新しくゲームを開始してください。");
          render();
          return;
        }

        const succeeded = action.type === "play"
          ? playCardAndContinue(playerIndex, action.card, action.placement)
          : discardCardAndContinue(playerIndex, action.card);

        if (!succeeded) {
          state.busy = false;
          addLog("CPU の手番処理に失敗しました。新しくゲームを開始してください。");
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

  function setupGame() {
    clearCpuTimer();

    state.gameId += 1;
    state.started = true;
    state.busy = false;
    state.result = null;
    state.log = [];
    clearPendingAction();

    const { starter, nextPlayer } = Rules.setupRound(state);
    state.log = [
      `${starter.name} が開始時に ♠7 を出しました。`,
      `${nextPlayer.name} から時計回りに進行します。`,
    ];

    render();
    maybeRunCpuTurn();
  }

  restartButtonElement.addEventListener("click", () => {
    setupGame();
  });

  setupGame();
})();
