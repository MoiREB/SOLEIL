"use strict";

const SHAPES = ["square", "circle", "triangle"];
const COLORS = ["green", "red", "blue"];
const PHASES = {
  LOBBY: "lobby",
  MATH: "math",
  PLAYING: "playing",
  REVEAL: "reveal",
  PASS_BALL: "pass_ball",
  ENDED: "ended",
};

const DEFAULTS = {
  maxPlayers: 6,
  maxErrors: 2,
  delayMs: 20000,
  historyVisible: false,
  fillBots: true,
  winMode: "survival",
};

function allCombos() {
  const out = [];
  for (const shape of SHAPES) {
    for (const color of COLORS) {
      out.push({ shape, color });
    }
  }
  return out;
}

function shuffle(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizeSettings(raw = {}) {
  const maxPlayers = clamp(Number(raw.maxPlayers) || DEFAULTS.maxPlayers, 2, 99);
  const maxErrors = clamp(Number(raw.maxErrors) || DEFAULTS.maxErrors, 1, 99);
  const delayMs = clamp(Number(raw.delayMs) || DEFAULTS.delayMs, 1000, 60000);
  const winMode = raw.winMode === "points" ? "points" : "survival";
  return {
    maxPlayers,
    maxErrors,
    unlimitedErrors: Boolean(raw.unlimitedErrors),
    delayMs,
    historyVisible: Boolean(raw.historyVisible),
    fillBots: raw.fillBots !== false,
    winMode,
  };
}

function makeMathQuestion() {
  const a = 11 + Math.floor(Math.random() * 89);
  const b = 11 + Math.floor(Math.random() * 89);
  const add = Math.random() < 0.6;
  if (add) {
    return { question: `${a} + ${b}`, answer: a + b };
  }
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return { question: `${hi} − ${lo}`, answer: hi - lo };
}

function livingPlayers(game) {
  return game.players.filter((p) => p.alive);
}

function playerById(game, id) {
  return game.players.find((p) => p.id === id) || null;
}

function createGame({ id, code, hostId, settings } = {}) {
  return {
    id: id || `g_${Date.now()}`,
    code: (code || "XXXX").toUpperCase(),
    hostId: hostId || null,
    settings: normalizeSettings(settings),
    phase: PHASES.LOBBY,
    players: [],
    ballHolderId: null,
    math: null,
    lastResult: null,
    history: [],
    winnerId: null,
    passChooserId: null,
    startedAt: null,
    endedAt: null,
  };
}

function addPlayer(game, { id, name, isBot = false }) {
  if (game.phase !== PHASES.LOBBY) {
    throw new Error("La partie a déjà commencé.");
  }
  if (game.players.length >= game.settings.maxPlayers) {
    throw new Error("Le salon est complet.");
  }
  const trimmed = String(name || "").trim().slice(0, 20);
  const player = {
    id,
    name: trimmed || (isBot ? "Bot" : "Joueur"),
    isBot: Boolean(isBot),
    shape: null,
    color: null,
    errors: 0,
    points: 0,
    alive: true,
    connected: true,
    clueShape: null,
    clueColor: null,
    found: false,
    avatar: null,
  };
  game.players.push(player);
  if (!game.hostId) game.hostId = player.id;
  return player;
}

function removePlayer(game, playerId) {
  if (game.phase !== PHASES.LOBBY) return false;
  const i = game.players.findIndex((p) => p.id === playerId);
  if (i < 0) return false;
  game.players.splice(i, 1);
  if (game.hostId === playerId) {
    game.hostId = game.players[0] ? game.players[0].id : null;
  }
  return true;
}

function updateSettings(game, partial) {
  if (game.phase !== PHASES.LOBBY) {
    throw new Error("Les paramètres ne peuvent plus être changés.");
  }
  game.settings = normalizeSettings({ ...game.settings, ...partial });
  while (game.players.length > game.settings.maxPlayers) {
    const lastBot = [...game.players].reverse().find((p) => p.isBot);
    if (!lastBot) break;
    removePlayer(game, lastBot.id);
  }
  return game.settings;
}

function fillWithBots(game, makeId) {
  let n = game.players.filter((p) => p.isBot).length + 1;
  while (game.players.length < game.settings.maxPlayers) {
    addPlayer(game, {
      id: makeId(),
      name: `Bot ${n}`,
      isBot: true,
    });
    n += 1;
  }
}

function startGame(game) {
  if (game.phase !== PHASES.LOBBY) {
    throw new Error("La partie a déjà commencé.");
  }
  if (game.players.length < 2) {
    throw new Error("Il faut au moins 2 joueurs.");
  }
  const combos = shuffle(allCombos());
  game.players.forEach((p, i) => {
    const combo = combos[i % combos.length];
    p.shape = combo.shape;
    p.color = combo.color;
    p.errors = 0;
    p.points = 0;
    p.alive = true;
    p.clueShape = null;
    p.clueColor = null;
    p.found = false;
  });
  game.math = { ...makeMathQuestion(), submissions: {}, times: {}, winnerId: null };
  game.phase = PHASES.MATH;
  game.startedAt = Date.now();
  game.winnerId = null;
  game.ballHolderId = null;
  game.lastResult = null;
  game.history = [];
  game.passChooserId = null;
  return game;
}

function submitMathAnswer(game, playerId, value) {
  if (game.phase !== PHASES.MATH) {
    throw new Error("Ce n'est plus le moment du calcul.");
  }
  const player = playerById(game, playerId);
  if (!player) throw new Error("Joueur introuvable.");
  const numeric = Number(value);
  if (value === "" || value === null || value === undefined || !Number.isFinite(numeric)) {
    throw new Error("Réponse invalide.");
  }
  // On peut retenter tant que personne n'a la bonne réponse et que tout le monde n'a pas répondu.
  game.math.submissions[playerId] = numeric;
  game.math.times[playerId] = Date.now();
  if (numeric === game.math.answer) {
    game.math.winnerId = playerId;
    resolveMath(game);
    return { correct: true, resolved: true };
  }
  const allAnswered = game.players.every((p) => game.math.submissions[p.id] !== undefined);
  if (allAnswered) {
    resolveMath(game);
  }
  return { correct: false, resolved: game.phase !== PHASES.MATH };
}

function resolveMath(game) {
  if (game.phase !== PHASES.MATH) return game;
  let holder = game.math.winnerId;
  if (!holder) {
    const ranked = game.players
      .filter((p) => game.math.submissions[p.id] !== undefined)
      .map((p) => ({
        id: p.id,
        dist: Math.abs(game.math.submissions[p.id] - game.math.answer),
        at: game.math.times[p.id] || Infinity,
      }))
      .sort((a, b) => a.dist - b.dist || a.at - b.at);
    holder = ranked.length ? ranked[0].id : game.players[0].id;
  }
  game.math.winnerId = holder;
  game.ballHolderId = holder;
  game.phase = PHASES.PLAYING;
  return game;
}

function clueFor(guessShape, guessColor, secret) {
  const shapeOk = guessShape === secret.shape;
  const colorOk = guessColor === secret.color;
  if (shapeOk && colorOk) return "hit";
  if (shapeOk) return "shape";
  if (colorOk) return "color";
  return "none";
}

function pointsMode(game) {
  return game.settings.winMode === "points";
}

function canGuess(game, player) {
  if (!player || !player.alive || player.found) return false;
  return game.players.some((p) => p.alive && !p.found && p.id !== player.id);
}

function finishByScore(game) {
  const ranked = game.players.slice().sort((a, b) => (b.points || 0) - (a.points || 0));
  const top = ranked[0] ? ranked[0].points || 0 : 0;
  const leaders = ranked.filter((p) => (p.points || 0) === top);
  game.winnerId = leaders.length === 1 ? leaders[0].id : null;
  game.phase = PHASES.ENDED;
  game.endedAt = Date.now();
  game.passChooserId = null;
  return true;
}

function maybeEnd(game) {
  if (pointsMode(game)) {
    if (game.players.some((p) => canGuess(game, p))) return false;
    return finishByScore(game);
  }
  const living = livingPlayers(game);
  if (living.length === 1) {
    game.winnerId = living[0].id;
    game.phase = PHASES.ENDED;
    game.endedAt = Date.now();
    game.passChooserId = null;
    return true;
  }
  if (living.length === 0) {
    game.winnerId = null;
    game.phase = PHASES.ENDED;
    game.endedAt = Date.now();
    return true;
  }
  return false;
}

function guess(game, guesserId, targetId, shape, color) {
  if (game.phase !== PHASES.PLAYING) {
    throw new Error("Ce n'est pas le moment de déduire.");
  }
  if (game.ballHolderId !== guesserId) {
    throw new Error("Ce n'est pas ton tour.");
  }
  if (!SHAPES.includes(shape) || !COLORS.includes(color)) {
    throw new Error("Combinaison invalide.");
  }
  const guesser = playerById(game, guesserId);
  const target = playerById(game, targetId);
  if (!guesser || !guesser.alive || guesser.found) throw new Error("Joueur hors jeu.");
  if (!target || !target.alive || target.found) throw new Error("Cible invalide.");
  if (guesserId === targetId) throw new Error("Tu ne peux pas te cibler.");

  const clue = clueFor(shape, color, target);
  const hit = clue === "hit";
  const gained = hit ? 1 : clue === "none" ? 0 : 0.5;
  let targetEliminated = false;
  let guesserEliminated = false;

  guesser.points = Math.round((guesser.points + gained) * 2) / 2;
  if (hit) {
    target.found = true;
    if (!pointsMode(game)) {
      target.alive = false;
      targetEliminated = true;
    }
  } else {
    if (clue === "shape") target.clueShape = shape;
    if (clue === "color") target.clueColor = color;
    guesser.errors += 1;
    if (!game.settings.unlimitedErrors && guesser.errors >= game.settings.maxErrors) {
      guesser.alive = false;
      guesserEliminated = true;
    }
  }

  const result = {
    guesserId,
    targetId,
    shape,
    color,
    clue,
    hit,
    points: gained,
    targetEliminated,
    guesserEliminated,
    at: Date.now(),
  };
  game.lastResult = result;
  game.history.push({ ...result });
  game.phase = PHASES.REVEAL;

  if (maybeEnd(game)) {
    game.phase = PHASES.REVEAL;
  }

  return result;
}

function handBallToSomeoneWhoCanPlay(game) {
  const holder = playerById(game, game.ballHolderId);
  if (canGuess(game, holder)) return false;
  const next = game.players.find((p) => canGuess(game, p));
  if (!next) return false;
  game.ballHolderId = next.id;
  game.passChooserId = null;
  game.phase = PHASES.PLAYING;
  return true;
}

function afterReveal(game) {
  if (game.phase !== PHASES.REVEAL) return game;
  if (pointsMode(game)) {
    if (maybeEnd(game)) return game;
    const resultNow = game.lastResult;
    const pointed = resultNow && playerById(game, resultNow.targetId);
    if (canGuess(game, pointed)) {
      game.ballHolderId = pointed.id;
    } else if (!canGuess(game, playerById(game, game.ballHolderId))) {
      const next = game.players.find((p) => canGuess(game, p));
      if (next) game.ballHolderId = next.id;
    }
    game.phase = PHASES.PLAYING;
    game.passChooserId = null;
    return game;
  } else if (livingPlayers(game).length <= 1) {
    maybeEnd(game);
    return game;
  }
  const result = game.lastResult;
  if (result && result.hit && result.targetEliminated) {
    const chooser = playerById(game, result.targetId);
    if (chooser) {
      game.passChooserId = chooser.id;
      game.phase = PHASES.PASS_BALL;
      return game;
    }
  }
  if (result) {
    const target = playerById(game, result.targetId);
    if (target && target.alive) {
      game.ballHolderId = target.id;
    } else {
      const living = livingPlayers(game);
      game.ballHolderId = living[0] ? living[0].id : game.ballHolderId;
    }
  }
  game.phase = PHASES.PLAYING;
  game.passChooserId = null;
  return game;
}

function passBall(game, chooserId, toId) {
  if (game.phase !== PHASES.PASS_BALL) {
    throw new Error("Ce n'est pas le moment de choisir qui joue.");
  }
  if (game.passChooserId !== chooserId) {
    throw new Error("Tu ne choisis pas le prochain détenteur.");
  }
  const target = playerById(game, toId);
  if (!target || !target.alive) {
    throw new Error("Le prochain détenteur doit être en vie.");
  }
  game.ballHolderId = toId;
  game.passChooserId = null;
  game.phase = PHASES.PLAYING;
  if (maybeEnd(game)) return game;
  return game;
}

function replaceWithBot(game, playerId, botName) {
  const player = playerById(game, playerId);
  if (!player) return null;
  player.isBot = true;
  player.connected = false;
  if (botName) player.name = botName;
  return player;
}

function safeAvatarName(name) {
  return (
    typeof name === "string" &&
    name &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.includes("..")
  );
}

function chooseAvatar(game, playerId, file, files) {
  if (game.phase !== PHASES.LOBBY) {
    throw new Error("Les avatars se choisissent dans le salon.");
  }
  const pool = (files || []).filter(safeAvatarName);
  if (!safeAvatarName(file) || !pool.includes(file)) {
    throw new Error("Cet avatar n'est pas disponible.");
  }
  const player = playerById(game, playerId);
  if (!player || player.isBot) {
    throw new Error("Tu ne peux pas changer cet avatar.");
  }
  player.avatar = file;
  return file;
}

function assignAvatars(game, files) {
  const pool = (files || []).filter(safeAvatarName);
  const used = new Set();
  for (const p of game.players) {
    if (p.avatar && pool.includes(p.avatar)) used.add(p.avatar);
    else p.avatar = null;
  }
  let cursor = 0;
  for (const p of game.players) {
    if (p.avatar) continue;
    if (!pool.length) break;
    let pick = null;
    for (let n = 0; n < pool.length; n++) {
      const candidate = pool[(cursor + n) % pool.length];
      if (!used.has(candidate)) {
        pick = candidate;
        cursor = (cursor + n + 1) % pool.length;
        break;
      }
    }
    if (!pick) {
      pick = pool[cursor % pool.length];
      cursor += 1;
    }
    p.avatar = pick;
    used.add(pick);
  }
  return game.players.map((p) => p.avatar);
}

function publicPlayer(p, viewerId, includeSecret) {
  const view = {
    id: p.id,
    name: p.name,
    isBot: p.isBot,
    alive: p.alive,
    errors: p.errors,
    points: p.points || 0,
    connected: p.connected,
    clueShape: p.clueShape,
    clueColor: p.clueColor,
    found: p.found,
    avatar: p.avatar || null,
  };
  if (includeSecret || p.found || p.id === viewerId) {
    view.shape = p.shape;
    view.color = p.color;
  }
  return view;
}

function serializeFor(game, viewerId) {
  const ended = game.phase === PHASES.ENDED;
  const showHistory = ended || game.settings.historyVisible;
  const showMathAnswer = ended || game.phase !== PHASES.MATH;
  return {
    id: game.id,
    code: game.code,
    hostId: game.hostId,
    settings: game.settings,
    phase: game.phase,
    ballHolderId: game.ballHolderId,
    passChooserId: game.passChooserId,
    winnerId: game.winnerId,
    math: game.math
      ? {
          question: game.math.question,
          answer: showMathAnswer ? game.math.answer : undefined,
          winnerId: game.math.winnerId,
          hasSubmitted: game.math.submissions[viewerId] !== undefined,
          mine: game.math.submissions[viewerId],
          answeredIds: Object.keys(game.math.submissions),
        }
      : null,
    lastResult: game.lastResult,
    attempts: game.history.length,
    history: showHistory ? game.history.slice() : [],
    players: game.players.map((p) => publicPlayer(p, viewerId, ended)),
    viewerId,
  };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function runSelfTests() {
  const g = createGame({ id: "t1", code: "TEST", settings: { maxPlayers: 3, maxErrors: 2 } });
  addPlayer(g, { id: "a", name: "A" });
  addPlayer(g, { id: "b", name: "B" });
  addPlayer(g, { id: "c", name: "C" });
  startGame(g);
  assert(g.phase === PHASES.MATH, "doit commencer par le calcul");
  const combos = g.players.map((p) => `${p.shape}-${p.color}`);
  assert(new Set(combos).size === 3, "combinaisons uniques");

  submitMathAnswer(g, "a", g.math.answer + 5);
  assert(g.phase === PHASES.MATH, "une erreur ne ferme pas le calcul");
  submitMathAnswer(g, "a", g.math.answer + 3);
  assert(g.math.submissions.a === g.math.answer + 3, "retenter remplace la réponse");
  submitMathAnswer(g, "b", g.math.answer + 1);
  submitMathAnswer(g, "c", g.math.answer - 9);
  assert(g.phase === PHASES.PLAYING && g.ballHolderId === "b", "le plus proche commence");

  const gm = createGame({ id: "tm", code: "TSTM", settings: { maxPlayers: 3 } });
  addPlayer(gm, { id: "a", name: "A" });
  addPlayer(gm, { id: "b", name: "B" });
  addPlayer(gm, { id: "c", name: "C" });
  startGame(gm);
  submitMathAnswer(gm, "a", gm.math.answer + 2);
  submitMathAnswer(gm, "c", gm.math.answer);
  assert(gm.phase === PHASES.PLAYING && gm.ballHolderId === "c", "bonne réponse : départ immédiat");
  assert(serializeFor(gm, "a").math.answer === gm.math.answer, "réponse visible après résolution");

  const holder = playerById(g, g.ballHolderId);
  const target = g.players.find((p) => p.id !== holder.id);
  const missShape = SHAPES.find((s) => s !== target.shape);
  const missColor = COLORS.find((c) => c !== target.color);

  guess(g, holder.id, target.id, missShape, missColor);
  assert(g.lastResult.clue === "none", "indice C");
  assert(holder.errors === 1, "1 erreur");
  afterReveal(g);
  assert(g.ballHolderId === target.id, "balle vers la cible");
  assert(g.phase === PHASES.PLAYING, "reprise du jeu");

  const g2 = createGame({ id: "t2", code: "TST2", settings: { maxPlayers: 3, maxErrors: 2 } });
  addPlayer(g2, { id: "a", name: "A" });
  addPlayer(g2, { id: "b", name: "B" });
  addPlayer(g2, { id: "c", name: "C" });
  startGame(g2);
  g2.players[0].shape = "square";
  g2.players[0].color = "green";
  g2.players[1].shape = "circle";
  g2.players[1].color = "red";
  g2.players[2].shape = "triangle";
  g2.players[2].color = "blue";
  g2.phase = PHASES.PLAYING;
  g2.ballHolderId = "a";
  guess(g2, "a", "b", "circle", "green");
  assert(g2.lastResult.clue === "shape", "indice A forme grise");
  assert(g2.lastResult.points === 0.5, "partielle vaut 0,5");
  assert(playerById(g2, "a").points === 0.5, "points du déducteur");
  assert(playerById(g2, "b").clueShape === "circle", "forme révélée en indice");
  afterReveal(g2);
  assert(g2.ballHolderId === "b", "balle à B");

  g2.phase = PHASES.PLAYING;
  guess(g2, "b", "c", "square", "blue");
  assert(g2.lastResult.clue === "color", "indice B couleur");
  assert(playerById(g2, "c").clueColor === "blue", "couleur révélée en indice");
  afterReveal(g2);

  g2.phase = PHASES.PLAYING;
  g2.ballHolderId = "a";
  g2.players.find((p) => p.id === "a").alive = true;
  g2.players.find((p) => p.id === "c").alive = true;
  guess(g2, "a", "c", "triangle", "blue");
  assert(g2.lastResult.hit, "élimination sur combinaison exacte");
  assert(g2.lastResult.points === 1, "bonne réponse vaut 1");
  assert(playerById(g2, "a").points === 1.5, "0,5 puis 1");
  assert(playerById(g2, "c").found, "forme trouvée");
  assert(!playerById(g2, "c").alive, "C éliminé");
  afterReveal(g2);
  assert(g2.phase === PHASES.PASS_BALL, "l'éliminé donne la balle");
  assert(g2.passChooserId === "c", "C choisit");
  passBall(g2, "c", "a");
  assert(g2.ballHolderId === "a", "balle à A");

  const g3 = createGame({ id: "t3", code: "TST3", settings: { maxPlayers: 2, maxErrors: 2 } });
  addPlayer(g3, { id: "a", name: "A" });
  addPlayer(g3, { id: "b", name: "B" });
  startGame(g3);
  g3.phase = PHASES.PLAYING;
  g3.ballHolderId = "a";
  g3.players[0].shape = "square";
  g3.players[0].color = "green";
  g3.players[1].shape = "circle";
  g3.players[1].color = "red";
  guess(g3, "a", "b", "square", "blue");
  afterReveal(g3);
  g3.phase = PHASES.PLAYING;
  g3.ballHolderId = "a";
  playerById(g3, "a").alive = true;
  playerById(g3, "b").alive = true;
  guess(g3, "a", "b", "triangle", "blue");
  assert(playerById(g3, "a").errors === 2, "2 erreurs");
  assert(!playerById(g3, "a").alive, "A éliminé à la 2e erreur");
  afterReveal(g3);
  assert(g3.phase === PHASES.ENDED, "victoire de B");
  assert(g3.winnerId === "b", "B gagnant");

  const g4 = createGame({
    id: "t4",
    code: "TST4",
    settings: { maxPlayers: 2, maxErrors: 1, unlimitedErrors: true },
  });
  addPlayer(g4, { id: "a", name: "A" });
  addPlayer(g4, { id: "b", name: "B" });
  startGame(g4);
  g4.phase = PHASES.PLAYING;
  g4.ballHolderId = "a";
  g4.players[0].shape = "square";
  g4.players[0].color = "green";
  g4.players[1].shape = "circle";
  g4.players[1].color = "red";
  guess(g4, "a", "b", "square", "blue");
  afterReveal(g4);
  g4.phase = PHASES.PLAYING;
  g4.ballHolderId = "a";
  guess(g4, "a", "b", "triangle", "green");
  assert(playerById(g4, "a").errors === 2, "les essais s'accumulent");
  assert(playerById(g4, "a").alive, "illimité : pas d'élimination par les essais");
  assert(g4.phase === PHASES.REVEAL, "la partie continue");

  const gp = createGame({ id: "tp", code: "PTS", settings: { maxPlayers: 2, winMode: "points" } });
  addPlayer(gp, { id: "a", name: "A" });
  addPlayer(gp, { id: "b", name: "B" });
  startGame(gp);
  gp.phase = PHASES.PLAYING;
  gp.ballHolderId = "a";
  gp.players[0].shape = "square";
  gp.players[0].color = "green";
  gp.players[1].shape = "circle";
  gp.players[1].color = "red";
  guess(gp, "a", "b", "circle", "blue");
  afterReveal(gp);
  assert(playerById(gp, "a").alive, "points : une erreur sous la limite n'arrête pas");
  gp.phase = PHASES.PLAYING;
  gp.ballHolderId = "a";
  guess(gp, "a", "b", "circle", "red");
  assert(playerById(gp, "b").found, "forme trouvée");
  assert(playerById(gp, "b").alive, "la cible n'est pas éliminée, ses points restent");
  assert((playerById(gp, "a").points || 0) > (playerById(gp, "b").points || 0), "le trouveur a plus de points");
  afterReveal(gp);
  assert(gp.phase === PHASES.ENDED, "plus personne ne peut jouer");
  assert(gp.winnerId === "a", "le meilleur score gagne");

  const gp3 = createGame({ id: "tp3", code: "PT3", settings: { maxPlayers: 3, winMode: "points" } });
  addPlayer(gp3, { id: "a", name: "A" });
  addPlayer(gp3, { id: "b", name: "B" });
  addPlayer(gp3, { id: "c", name: "C" });
  startGame(gp3);
  gp3.phase = PHASES.PLAYING;
  gp3.ballHolderId = "a";
  gp3.players[0].shape = "square";
  gp3.players[0].color = "green";
  gp3.players[1].shape = "circle";
  gp3.players[1].color = "red";
  gp3.players[2].shape = "triangle";
  gp3.players[2].color = "blue";
  guess(gp3, "a", "b", "circle", "red");
  afterReveal(gp3);
  assert(gp3.phase === PHASES.PLAYING, "il reste des formes à chercher");
  assert(gp3.ballHolderId !== "b", "une forme trouvée ne rejoue pas");
  assert(playerById(gp3, "b").points === 0, "le joueur trouvé garde ses points");

  const gpErr = createGame({
    id: "tpe",
    code: "PTE",
    settings: { maxPlayers: 2, maxErrors: 1, winMode: "points" },
  });
  addPlayer(gpErr, { id: "a", name: "A" });
  addPlayer(gpErr, { id: "b", name: "B" });
  startGame(gpErr);
  gpErr.phase = PHASES.PLAYING;
  gpErr.ballHolderId = "a";
  gpErr.players[0].shape = "square";
  gpErr.players[0].color = "green";
  gpErr.players[1].shape = "circle";
  gpErr.players[1].color = "red";
  gpErr.players[0].points = 2;
  guess(gpErr, "a", "b", "triangle", "blue");
  assert(!playerById(gpErr, "a").alive, "points : le nombre d'essais arrête le joueur");
  assert(playerById(gpErr, "a").points === 2, "ses points restent");

  const ga = createGame({ id: "ta", code: "AV", settings: { maxPlayers: 3 } });
  addPlayer(ga, { id: "a", name: "A" });
  addPlayer(ga, { id: "b", name: "B" });
  addPlayer(ga, { id: "c", name: "C" });
  assignAvatars(ga, ["soleil.png", "lune.jpg", "../secret.png"]);
  assert(playerById(ga, "a").avatar === "soleil.png", "premier avatar");
  assert(playerById(ga, "b").avatar === "lune.jpg", "deuxième avatar");
  assert(playerById(ga, "c").avatar === "soleil.png", "on réutilise s'il en manque");
  assignAvatars(ga, ["lune.jpg"]);
  assert(playerById(ga, "b").avatar === "lune.jpg", "un avatar encore présent est conservé");
  assert(playerById(ga, "a").avatar === "lune.jpg", "un fichier retiré est remplacé");

  const gb = createGame({ id: "tb", code: "AV2", settings: { maxPlayers: 2 } });
  addPlayer(gb, { id: "a", name: "A" });
  addPlayer(gb, { id: "b", name: "B" });
  chooseAvatar(gb, "a", "soleil.png", ["soleil.png", "lune.jpg"]);
  chooseAvatar(gb, "b", "soleil.png", ["soleil.png", "lune.jpg"]);
  assert(playerById(gb, "a").avatar === "soleil.png", "avatar choisi");
  assert(playerById(gb, "b").avatar === "soleil.png", "deux joueurs peuvent prendre le même avatar");

  const hidden = serializeFor(g2, "a");
  g2.settings.historyVisible = false;
  g2.phase = PHASES.PLAYING;
  const noHist = serializeFor(g2, "a");
  assert(noHist.history.length === 0, "historique masqué pendant la partie");
  g2.phase = PHASES.ENDED;
  const endHist = serializeFor(g2, "a");
  assert(endHist.history.length > 0, "historique visible en fin de partie");
  assert(hidden.players.find((p) => p.id === "a").shape, "secret visible pour soi");

  const secretB = serializeFor(g2, "a").players.find((p) => p.id === "b");
  g2.phase = PHASES.PLAYING;
  const during = serializeFor(g2, "a").players.find((p) => p.id === "b");
  assert(!during.shape, "secret des autres caché");

  void secretB;
  console.log("game.js tests OK");
}

module.exports = {
  SHAPES,
  COLORS,
  PHASES,
  DEFAULTS,
  allCombos,
  shuffle,
  createGame,
  addPlayer,
  removePlayer,
  updateSettings,
  fillWithBots,
  startGame,
  submitMathAnswer,
  resolveMath,
  guess,
  afterReveal,
  passBall,
  replaceWithBot,
  serializeFor,
  assignAvatars,
  chooseAvatar,
  livingPlayers,
  playerById,
  clueFor,
};

if (require.main === module) {
  runSelfTests();
}
