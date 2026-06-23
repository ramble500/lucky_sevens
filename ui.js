window.SevensUI = (() => {
  const Rules = window.SevensRules;

  const boardElement = document.getElementById("board");
  const opponentsElement = document.getElementById("opponents");
  const playerHandElement = document.getElementById("player-hand");
  const logListElement = document.getElementById("log-list");
  const turnPillElement = document.getElementById("turn-pill");
  const phasePillElement = document.getElementById("phase-pill");
  const handHintElement = document.getElementById("hand-hint");
  const actionPanelElement = document.getElementById("action-panel");
  const actionTitleElement = document.getElementById("action-title");
  const actionButtonsElement = document.getElementById("action-buttons");
  const scoreListElement = document.getElementById("score-list");

  function buildBoardCard(suitKey, rank, entry) {
    const suit = Rules.suitMeta(suitKey);
    const wrapper = document.createElement("div");
    wrapper.className = `playing-card ${suit.className}`;

    const center = document.createElement("div");
    center.className = "card-center";
    center.textContent = entry.kind === "joker"
      ? (entry.jokerSide === "low" ? "小王" : "大王")
      : `${suit.symbol}${Rules.rankLabel(rank)}`;

    const note = document.createElement("div");
    note.className = "card-note";
    note.textContent = entry.kind === "joker"
      ? `${suit.name} / ${Rules.rankLabel(rank)}`
      : suit.name;

    wrapper.append(center, note);
    return wrapper;
  }

  function renderBoard(state) {
    boardElement.innerHTML = "";

    for (const suit of Rules.suits) {
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
          slot.textContent = Rules.rankLabel(rank);
        }

        row.appendChild(slot);
      }

      boardElement.appendChild(row);
    }
  }

  function renderOpponents(state) {
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
      const suit = Rules.suitMeta(card.suit);
      center.textContent = `${suit.symbol}${Rules.rankLabel(card.rank)}`;
      note.textContent = `${suit.name} / ${card.rank}点`;
    }

    button.append(center, note);
  }

  function renderHand(state, handlers) {
    const human = Rules.getPlayerById(state, 0);
    const isPlayersTurn = state.turnIndex === 0 && state.result === null && !state.busy;
    const playableCards = human ? Rules.getPlayableCards(state, human) : [];
    const mustDiscard = isPlayersTurn && playableCards.length === 0 && human && human.hand.length > 0;

    playerHandElement.innerHTML = "";

    if (!human || human.hand.length === 0) {
      const placeholder = document.createElement("div");
      placeholder.className = "hand-placeholder";
      placeholder.textContent = state.result ? "精算結果が表示されています。" : "あなたの手札はなくなりました。";
      playerHandElement.appendChild(placeholder);
    }

    if (!human) {
      handHintElement.textContent = "配布しています...";
      return;
    }

    human.hand.forEach((card) => {
      const placements = Rules.getPlacementsForCard(state, card);
      const button = document.createElement("button");
      const canPlay = placements.length > 0;
      const canDiscard = mustDiscard;
      const isSelectable = isPlayersTurn && (canPlay || canDiscard);

      button.className = card.kind === "joker"
        ? "hand-card"
        : `hand-card ${Rules.suitMeta(card.suit).className}`;

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
      button.setAttribute("aria-label", Rules.cardLabel(card));

      createHandCardBody(button, card);

      button.addEventListener("click", () => {
        if (button.disabled) {
          return;
        }

        handlers.onCardClick(card, { mustDiscard });
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

  function renderLog(state) {
    logListElement.innerHTML = "";
    for (const item of state.log) {
      const li = document.createElement("li");
      li.textContent = item;
      logListElement.appendChild(li);
    }
  }

  function renderActionPanel(state, handlers) {
    actionButtonsElement.innerHTML = "";

    const human = Rules.getPlayerById(state, 0);
    const pendingCard = human ? Rules.getCardById(human, state.pendingCardId) : null;

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
    actionTitleElement.textContent = `${Rules.cardLabel(pendingCard)} の置き先を選んでください。`;

    state.pendingMoves.forEach((placement) => {
      const button = document.createElement("button");
      const suit = Rules.suitMeta(placement.suit);
      button.type = "button";
      button.className = `secondary-button choice-button ${suit.className}`;
      button.textContent = `${Rules.placementLabel(placement)} として出す`;
      button.addEventListener("click", () => {
        handlers.onPlacementSelect(pendingCard.id, placement);
      });
      actionButtonsElement.appendChild(button);
    });
  }

  function renderScores(state) {
    scoreListElement.innerHTML = "";

    if (!state.result) {
      state.players.forEach((player) => {
        const item = document.createElement("li");
        item.textContent = `${player.name}: 手札 ${player.hand.length} 枚 / 捨て札 ${player.discards.length} 枚 / 捨て札点 ${Rules.totalDiscardScore(player)}`;
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

  function renderStatus(state) {
    if (state.result) {
      turnPillElement.textContent = `${state.result.winnerName} が勝ちました`;
      phasePillElement.textContent = `${state.result.winLabel} x${state.result.winMultiplier} で精算しています`;
      return;
    }

    const currentPlayer = Rules.getPlayerById(state, state.turnIndex);
    if (!currentPlayer) {
      turnPillElement.textContent = "配布中...";
      phasePillElement.textContent = "ゲーム準備中";
      return;
    }

    turnPillElement.textContent = `${currentPlayer.name} の番`;

    if (state.turnIndex === 0) {
      const human = Rules.getPlayerById(state, 0);
      phasePillElement.textContent = Rules.getPlayableCards(state, human).length > 0
        ? "あなたは場に1枚出します"
        : "あなたは1枚を捨てます";
    } else if (state.busy) {
      phasePillElement.textContent = "CPU が手を選んでいます";
    } else {
      phasePillElement.textContent = "CPU の手番です";
    }
  }

  function renderAll(state, handlers) {
    renderBoard(state);
    renderOpponents(state);
    renderHand(state, handlers);
    renderActionPanel(state, handlers);
    renderStatus(state);
    renderScores(state);
    renderLog(state);
  }

  return {
    renderAll,
  };
})();
