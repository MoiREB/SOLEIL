"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const gameLib = require("./game");
const bots = require("./bots");

const {
  PHASES,
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
} = gameLib;

const AVATAR_DIR = path.join(__dirname, "public", "avatars");
const AVATAR_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

function avatarFiles() {
  let entries = [];
  try {
    entries = fs.readdirSync(AVATAR_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && AVATAR_EXT.test(entry.name) && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "fr"));
}

const PORT = Number(process.env.PORT) || 3000;
const rooms = new Map();

function makeId(prefix) {
  return `${prefix}_${crypto.randomBytes(4).toString("hex")}`;
}

function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? makeCode() : code;
}

function getRoom(code) {
  return rooms.get(String(code || "").toUpperCase()) || null;
}

function createRoom(hostName, settings) {
  const code = makeCode();
  const hostId = makeId("p");
  const game = createGame({ id: makeId("g"), code, hostId, settings });
  addPlayer(game, { id: hostId, name: hostName, isBot: false });
  const room = {
    code,
    game,
    sockets: new Map(),
    timers: [],
    botTimers: [],
    revealEndsAt: null,
  };
  rooms.set(code, room);
  return { room, hostId };
}

function clearTimers(list) {
  for (const t of list) clearTimeout(t);
  list.length = 0;
}

function destroyRoom(code) {
  const room = getRoom(code);
  if (!room) return;
  clearTimers(room.timers);
  clearTimers(room.botTimers);
  bots.forgetGame(room.game.id);
  rooms.delete(room.code);
}

function attachSocket(room, playerId, socket) {
  room.sockets.set(playerId, socket.id);
  socket.data.playerId = playerId;
  socket.data.code = room.code;
  socket.join(room.code);
}

function emitError(socket, message) {
  socket.emit("errorMessage", { message });
}

function stateFor(room, playerId) {
  assignAvatars(room.game, avatarFiles());
  const data = serializeFor(room.game, playerId);
  data.revealEndsAt = room.revealEndsAt;
  data.youAreHost = room.game.hostId === playerId;
  data.avatars = avatarFiles();
  return data;
}

function broadcast(room) {
  for (const [playerId, socketId] of room.sockets) {
    const sock = io.sockets.sockets.get(socketId);
    if (sock) sock.emit("state", stateFor(room, playerId));
  }
}

function humansLeft(game) {
  return game.players.some((p) => !p.isBot && p.connected);
}

function schedule(room, fn, ms) {
  const t = setTimeout(fn, ms);
  room.timers.push(t);
  return t;
}

function runBot(room, botId) {
  const game = room.game;
  const action = bots.chooseAction(game, botId);
  if (!action) return;
  try {
    if (action.type === "math") {
      submitMathAnswer(game, botId, action.value);
      if (game.phase !== PHASES.MATH) {
        clearTimers(room.timers);
      }
    } else if (action.type === "guess") {
      applyGuess(room, botId, action.targetId, action.shape, action.color);
      return;
    } else if (action.type === "pass") {
      passBall(game, botId, action.toId);
    }
  } catch {
    return;
  }
  broadcast(room);
  scheduleBots(room);
}

function scheduleBots(room) {
  clearTimers(room.botTimers);
  const game = room.game;
  if (game.phase === PHASES.REVEAL || game.phase === PHASES.ENDED) return;
  for (const p of game.players) {
    if (!p.isBot) continue;
    const needsMath = game.phase === PHASES.MATH && game.math && game.math.submissions[p.id] === undefined;
    const needsGuess = game.phase === PHASES.PLAYING && game.ballHolderId === p.id && p.alive;
    const needsPass = game.phase === PHASES.PASS_BALL && game.passChooserId === p.id;
    if (!needsMath && !needsGuess && !needsPass) continue;
    const t = setTimeout(() => runBot(room, p.id), bots.botDelay(game.phase));
    room.botTimers.push(t);
  }
}

function beginReveal(room) {
  const delay = room.game.settings.delayMs;
  room.revealEndsAt = Date.now() + delay;
  broadcast(room);
  schedule(room, () => {
    room.revealEndsAt = null;
    afterReveal(room.game);
    broadcast(room);
    scheduleBots(room);
    if (room.game.phase === PHASES.ENDED) {
      schedule(room, () => {
        if (!humansLeft(room.game)) destroyRoom(room.code);
      }, 120000);
    }
  }, delay);
}

function applyGuess(room, guesserId, targetId, shape, color) {
  const result = guess(room.game, guesserId, targetId, shape, color);
  bots.observeResult(room.game, result);
  clearTimers(room.timers);
  clearTimers(room.botTimers);
  beginReveal(room);
}

function beginMath(room) {
  schedule(room, () => {
    if (room.game.phase === PHASES.MATH) {
      resolveMath(room.game);
      broadcast(room);
      scheduleBots(room);
    }
  }, 20000);
  scheduleBots(room);
}

let io;

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const server = http.createServer(app);
io = new Server(server);

io.on("connection", (socket) => {
  socket.on("createRoom", ({ name, settings } = {}) => {
    try {
      const { room, hostId } = createRoom(name, settings);
      attachSocket(room, hostId, socket);
      socket.emit("joined", { playerId: hostId, code: room.code });
      broadcast(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("joinRoom", ({ code, name } = {}) => {
    try {
      const room = getRoom(code);
      if (!room) throw new Error("Salon introuvable.");
      if (room.game.phase !== PHASES.LOBBY) throw new Error("La partie a déjà commencé.");
      const player = addPlayer(room.game, { id: makeId("p"), name, isBot: false });
      attachSocket(room, player.id, socket);
      socket.emit("joined", { playerId: player.id, code: room.code });
      broadcast(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("chooseAvatar", ({ file } = {}) => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    try {
      chooseAvatar(room.game, socket.data.playerId, file, avatarFiles());
      broadcast(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("updateSettings", (partial = {}) => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    if (socket.data.playerId !== room.game.hostId) {
      return emitError(socket, "Seul le créateur peut changer les paramètres.");
    }
    try {
      updateSettings(room.game, partial);
      broadcast(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("startGame", (partial = {}) => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    if (socket.data.playerId !== room.game.hostId) {
      return emitError(socket, "Seul le créateur peut lancer la partie.");
    }
    try {
      if (partial && typeof partial === "object") {
        updateSettings(room.game, partial);
      }
      if (room.game.settings.fillBots) {
        fillWithBots(room.game, () => makeId("bot"));
      }
      startGame(room.game);
      bots.initMemory(room.game);
      broadcast(room);
      beginMath(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("mathAnswer", ({ value } = {}) => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    try {
      submitMathAnswer(room.game, socket.data.playerId, value);
      broadcast(room);
      if (room.game.phase !== PHASES.MATH) {
        clearTimers(room.timers);
        scheduleBots(room);
      }
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("guess", ({ targetId, shape, color } = {}) => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    try {
      applyGuess(room, socket.data.playerId, targetId, shape, color);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("passBall", ({ toId } = {}) => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    try {
      passBall(room.game, socket.data.playerId, toId);
      broadcast(room);
      scheduleBots(room);
    } catch (err) {
      emitError(socket, err.message);
    }
  });

  socket.on("disconnect", () => {
    const room = getRoom(socket.data.code);
    if (!room) return;
    const playerId = socket.data.playerId;
    if (!playerId) return;
    if (room.sockets.get(playerId) === socket.id) {
      room.sockets.delete(playerId);
    }
    const game = room.game;
    if (game.phase === PHASES.LOBBY) {
      removePlayer(game, playerId);
      if (!game.players.some((p) => !p.isBot)) {
        destroyRoom(game.code);
        return;
      }
      broadcast(room);
      return;
    }
    const player = game.players.find((p) => p.id === playerId);
    if (player && !player.isBot) {
      replaceWithBot(game, playerId);
      bots.ensureBotMemory(game, playerId);
      broadcast(room);
      scheduleBots(room);
    }
    if (!humansLeft(game) && game.phase === PHASES.ENDED) {
      destroyRoom(game.code);
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SOLEIL prêt sur http://localhost:${PORT}`);
});
