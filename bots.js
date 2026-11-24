"use strict";

const { SHAPES, COLORS, PHASES, allCombos, playerById, livingPlayers } = require("./game");

const memory = new Map();

function key(game) {
  return game.id;
}

function comboKey(c) {
  return `${c.shape}:${c.color}`;
}

function sameCombo(a, b) {
  return a && b && a.shape === b.shape && a.color === b.color;
}

function initMemory(game) {
  const store = {};
  const combos = allCombos();
  for (const bot of game.players.filter((p) => p.isBot)) {
    store[bot.id] = {};
    for (const p of game.players) {
      if (p.id === bot.id) {
        store[bot.id][p.id] = [{ shape: p.shape, color: p.color }];
      } else {
        store[bot.id][p.id] = combos.filter(
          (c) => !(c.shape === bot.shape && c.color === bot.color)
        );
      }
    }
  }
  memory.set(key(game), store);
}

function ensureBotMemory(game, botId) {
  let store = memory.get(key(game));
  if (!store) {
    initMemory(game);
    store = memory.get(key(game));
  }
  if (store[botId]) return store[botId];
  const bot = playerById(game, botId);
  const combos = allCombos();
  store[botId] = {};
  for (const p of game.players) {
    if (p.id === botId) {
      store[botId][p.id] = bot ? [{ shape: bot.shape, color: bot.color }] : combos.slice();
    } else {
      store[botId][p.id] = combos.slice();
    }
  }
  applyHistory(game, botId);
  return store[botId];
}

function applyClue(possibles, result) {
  if (!result) return possibles;
  const { shape, color, clue } = result;
  if (clue === "hit") {
    return possibles.filter((c) => c.shape === shape && c.color === color);
  }
  if (clue === "shape") {
    return possibles.filter((c) => c.shape === shape && c.color !== color);
  }
  if (clue === "color") {
    return possibles.filter((c) => c.color === color && c.shape !== shape);
  }
  return possibles.filter((c) => c.shape !== shape && c.color !== color);
}

function observeResult(game, result) {
  if (!result) return;
  let store = memory.get(key(game));
  if (!store) {
    initMemory(game);
    store = memory.get(key(game));
  }
  for (const bot of game.players.filter((p) => p.isBot)) {
    const mem = ensureBotMemory(game, bot.id);
    if (!mem[result.targetId]) mem[result.targetId] = allCombos();
    mem[result.targetId] = applyClue(mem[result.targetId], result);
    if (result.hit) {
      mem[result.targetId] = [{ shape: result.shape, color: result.color }];
    }
  }
}

function applyHistory(game, botId) {
  const mem = ensureBotMemory(game, botId);
  for (const entry of game.history) {
    if (!mem[entry.targetId]) mem[entry.targetId] = allCombos();
    mem[entry.targetId] = applyClue(mem[entry.targetId], entry);
  }
}

function pickGuess(game, botId) {
  const bot = playerById(game, botId);
  if (!bot || !bot.alive) return null;
  const mem = ensureBotMemory(game, botId);
  const targets = livingPlayers(game).filter((p) => p.id !== botId && !p.found);
  if (!targets.length) return null;

  const ranked = targets
    .map((p) => {
      const opts = mem[p.id] && mem[p.id].length ? mem[p.id] : allCombos();
      return { player: p, opts };
    })
    .sort((a, b) => a.opts.length - b.opts.length);

  const bestLen = ranked[0].opts.length;
  const pool = ranked.filter((r) => r.opts.length === bestLen);
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const combo =
    chosen.opts[Math.floor(Math.random() * chosen.opts.length)] ||
    allCombos()[Math.floor(Math.random() * 9)];
  return {
    type: "guess",
    targetId: chosen.player.id,
    shape: combo.shape,
    color: combo.color,
  };
}

function pickPass(game, botId) {
  const living = livingPlayers(game).filter((p) => p.id !== botId);
  if (!living.length) return null;
  const pick = living[Math.floor(Math.random() * living.length)];
  return { type: "pass", toId: pick.id };
}

function pickMathAnswer(game, botId) {
  const correct = game.math && game.math.answer;
  const smart = Math.random() < 0.35;
  const slip = (Math.random() < 0.5 ? 1 : -1) * (1 + Math.floor(Math.random() * 9));
  const value = smart && Number.isFinite(correct) ? correct : (correct || 50) + slip;
  return { type: "math", playerId: botId, value };
}

function chooseAction(game, botId) {
  if (game.phase === PHASES.MATH) return pickMathAnswer(game, botId);
  if (game.phase === PHASES.PASS_BALL && game.passChooserId === botId) {
    return pickPass(game, botId);
  }
  if (game.phase === PHASES.PLAYING && game.ballHolderId === botId) {
    return pickGuess(game, botId);
  }
  return null;
}

function botDelay(phase) {
  if (phase === PHASES.MATH) return 4500 + Math.floor(Math.random() * 3500);
  if (phase === PHASES.PASS_BALL) return 600 + Math.floor(Math.random() * 1400);
  return 900 + Math.floor(Math.random() * 1600);
}

function forgetGame(gameId) {
  memory.delete(gameId);
}

module.exports = {
  initMemory,
  observeResult,
  ensureBotMemory,
  chooseAction,
  botDelay,
  forgetGame,
  comboKey,
  sameCombo,
  SHAPES,
  COLORS,
};
