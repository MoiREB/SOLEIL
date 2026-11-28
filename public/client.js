(() => {
  const SHAPE_LABEL = { square: "Carré", circle: "Cercle", triangle: "Triangle" };
  const COLOR_LABEL = { green: "Vert", red: "Rouge", blue: "Bleu" };
  const SHAPES = ["square", "circle", "triangle"];
  const COLORS = ["green", "red", "blue"];

  const $ = (id) => document.getElementById(id);
  const app = $("app");
  const layer = $("layer");
  const socket = io();
  const params = new URLSearchParams(location.search);

  let state = null;
  let errorMessage = "";
  let lastScreen = "";
  let lastHost = null;
  let lastLayer = "";
  const ui = {
    name: "",
    code: "",
    math: "",
    targetId: "",
    shape: "",
    color: "",
    alert: false,
    modal: false,
    revealClosed: false,
    notice: false,
    showSecret: false,
    turnKey: null,
    timer: null,
    sending: false,
  };

  const AVATAR =
    '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="14" r="7" fill="currentColor"/><path d="M6 36c1.2-8 6.6-12 14-12s12.8 4 14 12z" fill="currentColor"/></svg>';
  const RAYS = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return `<line x1="${(32 + 18 * c).toFixed(1)}" y1="${(32 + 18 * s).toFixed(1)}" x2="${(32 + 29 * c).toFixed(1)}" y2="${(32 + 29 * s).toFixed(1)}"/>`;
  }).join("");
  const SUN = `<svg class="sunicon" viewBox="0 0 64 64" aria-hidden="true"><g stroke="#ffcc33" stroke-width="4" stroke-linecap="round">${RAYS}</g><circle cx="32" cy="32" r="14" fill="#ffe566"/><circle cx="32" cy="32" r="8" fill="#fff4b0"/></svg>`;
  const SHARE_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a3.3 3.3 0 0 0 0-1.39l7.05-4.11A2.99 2.99 0 1 0 15 5c0 .17.02.34.05.5L8.04 9.62a3 3 0 1 0 0 4.76l7.01 4.11c-.03.16-.05.32-.05.51a3 3 0 1 0 3-3z"/></svg>`;

  socket.on("joined", ({ code }) => {
    const url = new URL(location.href);
    url.searchParams.set("room", code);
    history.replaceState({}, "", url);
  });

  socket.on("left", () => {
    state = null;
    errorMessage = "";
    lastScreen = "";
    lastHost = null;
    ui.showSecret = false;
    const url = new URL(location.href);
    url.searchParams.delete("room");
    history.replaceState({}, "", url.pathname + url.search);
    render();
  });

  socket.on("state", (next) => {
    const sameReveal =
      state && state.phase === "reveal" && next.phase === "reveal" && state.attempts === next.attempts;
    if (!sameReveal) ui.revealClosed = false;
    if (state && state.phase === "math" && next.phase !== "math") ui.showSecret = true;
    state = next;
    errorMessage = "";
    ui.sending = false;
    if (state.phase !== "playing") {
      ui.targetId = "";
      ui.shape = "";
      ui.color = "";
    }
    render();
  });

  socket.on("errorMessage", ({ message }) => {
    errorMessage = message;
    ui.sending = false;
    render();
  });

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  const me = () => state && state.players.find((p) => p.id === state.viewerId);
  const byId = (id) => (state ? state.players.find((p) => p.id === id) : null);
  const nameOf = (id) => (byId(id) ? byId(id).name : "Joueur");
  const myTurn = () => {
    const m = me();
    return Boolean(state && state.phase === "playing" && m && m.alive && !m.found && state.ballHolderId === state.viewerId);
  };

  function piece(shape, color) {
    const title = `${SHAPE_LABEL[shape] || ""} ${COLOR_LABEL[color] || ""}`.trim();
    return `<span class="piece ${color || "gray"}" title="${title}"><span class="${shape}"></span></span>`;
  }
  function avatar(who, small) {
    const p = typeof who === "string" ? byId(who) : who;
    const file = p && p.avatar ? String(p.avatar) : "";
    const safe = file && !file.includes("/") && !file.includes("\\") && !file.includes("..");
    const inner = safe ? `<img src="/avatars/${encodeURIComponent(file)}" alt="" />` : AVATAR;
    return `<span class="av${small ? " sm" : ""}">${inner}</span>`;
  }
  function who(id) {
    return `<span class="who">${avatar(id, true)}<span class="nm">${esc(nameOf(id))}</span></span>`;
  }
  function clueVisual(clue, shape, color) {
    if (clue === "hit") return piece(shape, color);
    if (clue === "shape") return piece(shape, "gray");
    if (clue === "color") return SHAPES.map((s) => piece(s, color)).join("");
    return "";
  }
  function header(right) {
    return `<header class="brand">${SUN}<h1>SOLEIL</h1><div class="brand-right">${right || ""}</div></header>`;
  }
  const toast = () => (errorMessage ? `<div class="toast">${esc(errorMessage)}</div>` : "");
  const remainingMs = () => (state && state.revealEndsAt ? Math.max(0, state.revealEndsAt - Date.now()) : 0);

  function homeView() {
    return `
      ${header(`<button type="button" class="secondary back" data-act="notice">Notice</button>`)}
      <p class="muted lead">Déduis la forme et la couleur. Élimine les autres. Reste le dernier en vie.</p>
      ${toast()}
      <div class="panel stack">
        <label>Pseudo
          <input id="name" maxlength="20" placeholder="Ton nom" value="${esc(ui.name)}" />
        </label>
        <label>Code du salon
          <input id="code" maxlength="6" placeholder="ABCD" value="${esc(ui.code || params.get("room") || "")}" />
        </label>
        <button class="${String(ui.code || params.get("room") || "").trim() ? "" : "secondary"}" data-act="join">Rejoindre</button>
        <button data-act="create">Créer une partie</button>
      </div>`;
  }

  function lobbyPlayers() {
    return state.players
      .map(
        (p) =>
          `<div class="lrow">${avatar(p, true)}<strong>${esc(p.name)}${p.id === state.viewerId ? " (toi)" : ""}</strong>${p.isBot ? '<span class="chip">bot</span>' : ""}${p.id === state.hostId ? '<span class="chip">créateur</span>' : ""}</div>`
      )
      .join("");
  }
  function winRadios(s, dis) {
    const mode = s.winMode === "points" ? "points" : "survival";
    return `
      <div class="choice">
        <span>Façon de gagner</span>
        <div class="radios">
          <label class="radio"><input type="radio" name="winMode" value="survival" ${mode === "survival" ? "checked" : ""} ${dis} /> Dernier en vie</label>
          <label class="radio"><input type="radio" name="winMode" value="points" ${mode === "points" ? "checked" : ""} ${dis} /> Points</label>
        </div>
      </div>`;
  }
  function errorFields(s, dis) {
    const unlimited = Boolean(s.unlimitedErrors);
    return `
      <div id="errorWrap" class="choice">
        <span>Essais avant élimination</span>
        <div class="radios">
          <label class="radio"><input type="radio" name="errorLimit" value="count" ${unlimited ? "" : "checked"} ${dis} /> Nombre</label>
          <label class="radio"><input type="radio" name="errorLimit" value="unlimited" ${unlimited ? "checked" : ""} ${dis} /> Illimité</label>
        </div>
        <label id="errorCountWrap"${unlimited ? " hidden" : ""}>Nombre d'essais
          <input type="number" min="1" max="99" id="errorCount" value="${s.maxErrors}" ${dis} />
        </label>
      </div>`;
  }
  function pointsMode() {
    return Boolean(state && state.settings && state.settings.winMode === "points");
  }
  function avatarPicker() {
    const files = state.avatars || [];
    const mine = me();
    if (!files.length) return "";
    const buttons = files
      .map((file) => {
        const picked = mine && mine.avatar === file;
        return `<button type="button" class="avbtn${picked ? " picked" : ""}" data-act="avatar" data-file="${esc(file)}" aria-label="${esc(file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "))}">${avatar({ avatar: file }, false)}</button>`;
      })
      .join("");
    return `
      <div class="avatar-pick">
        <h3>Ton avatar</h3>
        <div class="avatar-grid">${buttons}</div>
      </div>`;
  }
  function lobbyView() {
    const s = state.settings;
    const dis = state.youAreHost ? "" : "disabled";
    return `
      ${header(`<button type="button" class="secondary back" data-act="notice">Notice</button><button type="button" class="secondary back" data-act="leave">Retour</button>`)}
      <div id="toast">${toast()}</div>
      <div class="panel share-panel">
        <div class="share-top">
          <div>
            <p class="muted small">Code de la partie</p>
            <p class="code">${esc(state.code)}</p>
          </div>
          <button type="button" class="iconbtn" data-act="share" aria-label="Partager le lien">${SHARE_ICON}</button>
        </div>
        <p class="link" id="shareLink">${esc(location.href)}</p>
        <p class="muted small share-note" id="shareNote"></p>
      </div>
      <div class="panel">
        <h2>Joueurs (<span id="lobbyCount">${state.players.length}</span>/<span id="lobbyMax">${s.maxPlayers}</span>)</h2>
        <div id="lobbyPlayers" class="lrows">${lobbyPlayers()}</div>
        <div id="avatarPicker">${avatarPicker()}</div>
      </div>
      <div class="panel stack">
        <h2>Paramètres</h2>
        <label>Nombre de joueurs
          <input type="number" min="2" max="99" id="maxPlayers" value="${s.maxPlayers}" ${dis} />
        </label>
        ${winRadios(s, dis)}
        ${errorFields(s, dis)}
        <label>Délai après chaque tentative (secondes)
          <input type="number" min="1" max="60" id="delaySec" value="${Math.round(s.delayMs / 1000)}" ${dis} />
        </label>
        <label class="check"><input type="checkbox" id="historyVisible" ${s.historyVisible ? "checked" : ""} ${dis} /> Historique visible pendant la partie</label>
        <label class="check"><input type="checkbox" id="fillBots" ${s.fillBots ? "checked" : ""} ${dis} /> Remplir les places vides avec des bots</label>
        ${state.youAreHost ? `<button data-act="start">Lancer la partie</button>` : `<p class="muted">En attente du créateur…</p>`}
      </div>`;
  }
  function patchLobby() {
    const s = state.settings;
    $("toast").innerHTML = toast();
    $("lobbyPlayers").innerHTML = lobbyPlayers();
    $("lobbyCount").textContent = state.players.length;
    $("lobbyMax").textContent = s.maxPlayers;
    const vals = {
      maxPlayers: s.maxPlayers,
      delaySec: Math.round(s.delayMs / 1000),
    };
    for (const id in vals) {
      const el = $(id);
      if (el && document.activeElement !== el) el.value = vals[id];
    }
    $("historyVisible").checked = s.historyVisible;
    $("fillBots").checked = s.fillBots;
    document.querySelectorAll('input[name="winMode"]').forEach((el) => {
      if (document.activeElement !== el) el.checked = el.value === (s.winMode === "points" ? "points" : "survival");
      el.disabled = !state.youAreHost;
    });
    document.querySelectorAll('input[name="errorLimit"]').forEach((el) => {
      const value = s.unlimitedErrors ? "unlimited" : "count";
      if (document.activeElement !== el) el.checked = el.value === value;
      el.disabled = !state.youAreHost;
    });
    const count = $("errorCount");
    if (count && document.activeElement !== count) {
      count.value = s.maxErrors;
      count.disabled = !state.youAreHost;
    }
    const errorCountWrap = $("errorCountWrap");
    if (errorCountWrap) errorCountWrap.hidden = s.unlimitedErrors;
    const picker = $("avatarPicker");
    if (picker) picker.innerHTML = avatarPicker();
  }
  function readSettings() {
    const win = document.querySelector('input[name="winMode"]:checked');
    const limit = document.querySelector('input[name="errorLimit"]:checked');
    const winMode = win && win.value === "points" ? "points" : "survival";
    return {
      maxPlayers: Number($("maxPlayers").value),
      maxErrors: Number($("errorCount").value) || state.settings.maxErrors,
      unlimitedErrors: Boolean(limit && limit.value === "unlimited"),
      winMode,
      delayMs: Number($("delaySec").value) * 1000,
      historyVisible: $("historyVisible").checked,
      fillBots: $("fillBots").checked,
    };
  }

  function mathStatus() {
    const answered = (state.math && state.math.answeredIds) || [];
    return state.players
      .map(
        (p) =>
          `<span class="who ${answered.includes(p.id) ? "done" : ""}">${avatar(p, true)}<span class="nm">${esc(p.name)}</span><span class="st">${answered.includes(p.id) ? "a répondu" : "réfléchit…"}</span></span>`
      )
      .join("");
  }
  function mathMessage() {
    const m = state.math;
    if (errorMessage) return `<div class="toast">${esc(errorMessage)}</div>`;
    if (m && m.hasSubmitted) {
      return `<p class="wrong">Ce n'est pas la bonne réponse. Tu peux retenter tant que personne n'a trouvé et que tout le monde n'a pas répondu.</p>`;
    }
    return "";
  }
  function mathView() {
    return `
      ${header(`<span class="code">${esc(state.code)}</span>`)}
      <div class="panel stack center">
        <p class="muted">Une seule question pour savoir qui commence.<br />Le premier qui trouve joue en premier. Sinon, c'est la réponse la plus proche.</p>
        <h2 class="question">${esc(state.math ? state.math.question : "")} = ?</h2>
        <input id="math" inputmode="numeric" autocomplete="off" placeholder="Ta réponse" value="${esc(ui.math)}" />
        <button data-act="mathSend">Valider</button>
        <div id="mathMsg">${mathMessage()}</div>
        <div id="mathStatus" class="statusrow">${mathStatus()}</div>
      </div>`;
  }
  function patchMath() {
    $("mathMsg").innerHTML = mathMessage();
    $("mathStatus").innerHTML = mathStatus();
  }

  function formatPts(n) {
    const v = Math.round((Number(n) || 0) * 2) / 2;
    const text = (Number.isInteger(v) ? String(v) : v.toFixed(1)).replace(".", ",");
    return `${text} pt${v >= 2 ? "s" : ""}`;
  }
  function triesLabel(p) {
    if (state.settings.unlimitedErrors) return `Essais ${p.errors}`;
    return `Essais ${p.errors}/${state.settings.maxErrors}`;
  }
  function essaisText(p) {
    if (!pointsMode()) return triesLabel(p);
    if (state.settings.unlimitedErrors) return formatPts(p.points);
    return `${formatPts(p.points)} · ${triesLabel(p)}`;
  }
  function infoLine(p) {
    if (p.shape && p.color) return `<span class="lbl">Forme :</span>${piece(p.shape, p.color)}`;
    const bits = [];
    if (p.clueShape) bits.push(piece(p.clueShape, "gray"));
    if (p.clueColor) bits.push(SHAPES.map((s) => piece(s, p.clueColor)).join(""));
    if (!bits.length) return "";
    return `<span class="lbl">Indice :</span>${bits.join("")}`;
  }
  function pcard(p) {
    const turn = state.ballHolderId === p.id && p.alive && !p.found && state.phase !== "ended";
    const cls = !p.alive ? "dead" : turn ? "turn" : "idle";
    const info = infoLine(p);
    return `
      <div class="pcard ${cls}">
        <div class="pc-id">${avatar(p, false)}<span class="nm">${esc(p.name)}${p.id === state.viewerId ? " (toi)" : ""}</span></div>
        <div class="pc-info">
          <div class="scoreline">${pointsMode() ? `<span class="pts">${formatPts(p.points)}</span>` : `<span class="essais">${essaisText(p)}</span>`}</div>
          ${info ? `<div class="infoline">${info}</div>` : ""}
        </div>
      </div>`;
  }
  function histItem(h) {
    const gain = pointsMode() ? (h.clue === "hit" ? `<span class="gain">+1</span>` : h.clue === "none" ? "" : `<span class="gain">+0,5</span>`) : "";
    let verdict;
    if (h.clue === "hit") verdict = `<span class="v ok">Correct <b>✓</b> ${gain}</span>`;
    else if (h.clue === "none") verdict = `<span class="v ko" title="Incorrect"><b>✗</b></span>`;
    else verdict = `<span class="v part">Partielle ${gain}</span><span class="hint">${clueVisual(h.clue, h.shape, h.color)}</span>`;
    const elim = [];
    if (h.targetEliminated) elim.push(`${esc(nameOf(h.targetId))} éliminé`);
    if (h.guesserEliminated) {
      elim.push(
        pointsMode()
          ? `${esc(nameOf(h.guesserId))} n'a plus d'essais`
          : `${esc(nameOf(h.guesserId))} éliminé`
      );
    }
    return `
      <li class="hitem">
        <div class="hrow">
          ${who(h.guesserId)}<span class="arrow">→</span>${who(h.targetId)}
          <span class="hguess">${piece(h.shape, h.color)}</span>
          <span class="hres">${verdict}</span>
        </div>
        ${elim.length ? `<div class="helim">${elim.join(" · ")}</div>` : ""}
      </li>`;
  }
  function historyOn() {
    return Boolean(state.settings.historyVisible);
  }
  function historyList(idAttr) {
    if (!historyOn()) return "";
    const list = state.history || [];
    if (!list.length) return `<p class="muted">Aucune tentative pour l'instant.</p>`;
    return `<ul class="history scroll" ${idAttr || ""}>${list.slice().reverse().map(histItem).join("")}</ul>`;
  }
  function tableView() {
    const m = me();
    const right =
      state.phase === "ended"
        ? "Fin de partie"
        : `Au tour de <strong>${esc(nameOf(state.ballHolderId))}</strong>`;
    const spectator =
      m && state.phase !== "ended" && (!m.alive || (pointsMode() && m.found))
        ? `<p class="note">${pointsMode() ? "Tu ne joues plus. Tes points restent." : "Tu es éliminé. Tu regardes la suite de la partie."}</p>`
        : "";
    const finish = finishBtn();
    const hist = historyOn()
      ? `<section class="panel col"><h2>Historique</h2>${historyList()}</section>`
      : "";
    return `
      ${header(right)}
      ${toast()}
      ${spectator}
      ${finish}
      <div class="board${historyOn() ? "" : " solo"}">
        <section class="panel col"><h2>Joueurs</h2><div class="plist">${state.players.map(pcard).join("")}</div></section>
        ${hist}
      </div>`;
  }

  function alertHtml() {
    return `<div class="alert"><b>À VOUS DE JOUER</b></div>`;
  }
  function guessTargets() {
    return state.players.filter((p) => p.alive && !p.found && p.id !== state.viewerId);
  }
  function modalHtml() {
    const targets = guessTargets();
    if (targets.length === 1) ui.targetId = targets[0].id;
    const targetButtons = targets
      .map((p) => {
        const info = infoLine(p);
        return `
        <button class="trow ${ui.targetId === p.id ? "picked" : ""}" data-act="target" data-id="${esc(p.id)}">
          ${avatar(p, true)}<span class="nm">${esc(p.name)}</span>${info ? `<span class="tclue">${info}</span>` : ""}<span class="ess">${essaisText(p)}</span>
        </button>`;
      })
      .join("");
    const shapes = SHAPES.map(
      (s) =>
        `<button type="button" class="sbtn${ui.shape === s ? " picked" : ""}" data-act="shape" data-shape="${s}">${piece(s, "gray")}<span>${SHAPE_LABEL[s]}</span></button>`
    ).join("");
    const colors = COLORS.map(
      (c) =>
        `<button type="button" class="cbtn ${c}${ui.color === c ? " picked" : ""}" data-act="color" data-color="${c}"><span>${COLOR_LABEL[c]}</span></button>`
    ).join("");
    const needTarget = !ui.targetId;
    const needShape = Boolean(ui.targetId) && !ui.shape;
    const needColor = Boolean(ui.targetId && ui.shape) && !ui.color;
    const ready = ui.targetId && ui.shape && ui.color && !ui.sending;
    const preview =
      ui.shape && ui.color
        ? piece(ui.shape, ui.color)
        : `<span class="none">Forme + couleur</span>`;
    const hist = historyOn()
      ? `<details class="hist-fold" open><summary>Historique</summary>${historyList('id="mh"')}</details>`
      : "";
    return `
      <div class="overlay">
        <div class="panel modal">
          <h2 class="mtitle">Ta déduction</h2>
          ${toast()}
          <div class="mgrid">
            <div class="mleft${needTarget ? " need" : ""}"><h3>Cible</h3><div class="tlist">${targetButtons}</div></div>
            <div class="mright">
              <div class="pick-block${needShape ? " need" : ""}">
                <h3>Forme</h3>
                <div class="choices">${shapes}</div>
              </div>
              <div class="pick-block${needColor ? " need" : ""}">
                <h3>Couleur</h3>
                <div class="choices">${colors}</div>
              </div>
              <div class="combo">${preview}</div>
              <button class="go" data-act="guess" ${ready ? "" : "disabled"}>Valider la déduction</button>
            </div>
          </div>
          ${hist}
        </div>
      </div>`;
  }
  function resultOverlay() {
    const r = state.lastResult;
    if (!r) return "";
    let title;
    let cls;
    if (r.clue === "hit") {
      title = "Correct ✓";
      cls = "ok";
    } else if (r.clue === "none") {
      title = "✗";
      cls = "ko";
    } else {
      title = "Partielle";
      cls = "part";
    }
    const sub = (
      pointsMode()
        ? {
            hit: "Combinaison exacte. +1 pt",
            shape: "Bonne forme, mauvaise couleur. +0,5 pt",
            color: "Bonne couleur, mauvaise forme. +0,5 pt",
            none: "Ni la forme ni la couleur.",
          }
        : {
            hit: "Combinaison exacte.",
            shape: "Bonne forme, mauvaise couleur.",
            color: "Bonne couleur, mauvaise forme.",
            none: "Ni la forme ni la couleur.",
          }
    )[r.clue];
    const notes = [];
    if (r.targetEliminated) notes.push(`${esc(nameOf(r.targetId))} est éliminé.`);
    if (r.guesserEliminated) notes.push(`${esc(nameOf(r.guesserId))} a fait sa dernière erreur et est éliminé.`);
    const visual = clueVisual(r.clue, r.shape, r.color);
    const total = state.settings.delayMs;
    const ms = remainingMs();
    const elapsed = Math.max(0, total - ms);
    const ARROW = `<svg viewBox="0 0 72 28" aria-hidden="true"><path d="M2 14h54M42 4l18 10L42 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `
      <div class="overlay">
        <div class="panel result">
          <div class="cd"><span data-cd>${Math.ceil(ms / 1000)}</span></div>
          <div class="bar"><i style="animation-duration:${total}ms;animation-delay:-${elapsed}ms"></i></div>
          <div class="duel">${who(r.guesserId)}<span class="guess-arrow"><span class="hguess">${piece(r.shape, r.color)}</span><span class="arrow big">${ARROW}</span></span>${who(r.targetId)}</div>
          <div class="vbig ${cls}">${title}</div>
          <p class="muted">${sub}</p>
          ${visual ? `<div class="clue-box">${visual}</div>` : ""}
          ${notes.length ? `<p class="notes">${notes.join(" ")}</p>` : ""}
          <p class="muted small">Le jeu reprend à la fin du délai.</p>
          ${finishBtn()}
          <button type="button" data-act="continue">Continuer</button>
        </div>
      </div>`;
  }
  function passOverlay() {
    const chooser = state.passChooserId === state.viewerId;
    const living = state.players.filter((p) => p.alive);
    return `
      <div class="overlay">
        <div class="panel stack">
          <h2>Qui joue ensuite ?</h2>
          <p class="muted">${esc(nameOf(state.passChooserId))} choisit qui joue ensuite.</p>
          ${
            chooser
              ? living
                  .map((p) => `<button class="trow" data-act="pass" data-id="${esc(p.id)}">${avatar(p, true)}<span class="nm">${esc(p.name)}</span></button>`)
                  .join("")
              : `<p class="muted">En attente du choix…</p>`
          }
          ${finishBtn()}
        </div>
      </div>`;
  }
  function endOverlay() {
    const winner = byId(state.winnerId);
    const list = (state.history || []).slice().reverse();
    return `
      <div class="overlay">
        <div class="panel stack end-panel">
          <div class="end-body">
            <h2>Fin de la partie</h2>
            <p class="winner">${winner ? `${avatar(winner, false)}<span>${esc(winner.name)} a gagné !</span>` : "Égalité"}</p>
            <ol class="scores">${state.players
              .slice()
              .sort((a, b) => (pointsMode() ? (b.points || 0) - (a.points || 0) : Number(b.alive) - Number(a.alive)))
              .map((p) => {
                const mark = pointsMode() ? formatPts(p.points) : p.alive ? "En vie" : "Éliminé";
                let known = "";
                if (p.found && p.shape && p.color) known = piece(p.shape, p.color);
                else if (p.clueColor) known = SHAPES.map((s) => piece(s, p.clueColor)).join("");
                else if (p.clueShape) known = piece(p.clueShape, "gray");
                else known = `<span class="miss" title="Rien trouvé">✗</span>`;
                const secret = p.shape && p.color && !(p.found && p.shape && p.color) ? piece(p.shape, p.color) : "";
                return `<li><span class="score-who">${avatar(p, true)}<span>${esc(p.name)}</span></span><span class="score-facts">${known}${secret}</span><b>${mark}</b></li>`;
              })
              .join("")}</ol>
            ${
              historyOn()
                ? `<details class="hist-fold end-hist"><summary>Historique</summary><ul class="history scroll end-scroll">${list.map(histItem).join("")}</ul></details>`
                : ""
            }
          </div>
          <button data-act="again">Nouvelle partie</button>
        </div>
      </div>`;
  }
  function noticeOverlay() {
    return `
      <div class="overlay">
        <div class="panel stack notice">
          <h2>Notice</h2>
          <div class="notice-body">
            <section>
              <h3>Le secret</h3>
              <p>Chaque joueur reçoit une forme cachée : carré, cercle ou triangle.</p>
              <p>Et une couleur cachée : vert, rouge ou bleu.</p>
              <p>Personne ne voit la forme des autres.</p>
            </section>
            <section>
              <h3>Les joueurs</h3>
              <p>On joue à partir de 2 joueurs.</p>
              <p>Le créateur choisit le nombre de places.</p>
              <p>Au-delà de 9 joueurs, deux personnes peuvent avoir la même forme.</p>
              <p>Les places vides peuvent être remplies par des bots.</p>
            </section>
            <section>
              <h3>Qui commence</h3>
              <p>Un calcul décide qui joue en premier.</p>
              <p>La première bonne réponse commence.</p>
              <p>Sinon, c'est la réponse la plus proche.</p>
              <p>Cette personne propose une forme et une couleur pour quelqu'un d'autre.</p>
            </section>
            <section>
              <h3>La déduction</h3>
              <p>Forme et couleur justes : la forme est trouvée.</p>
              <p>Seule la forme est juste : elle s'affiche en gris.</p>
              <p>Seule la couleur est juste : les trois formes s'affichent dans cette couleur.</p>
              <p>Rien n'est juste : aucun indice.</p>
            </section>
            <section>
              <h3>Dernier en vie</h3>
              <p>Si ta forme est trouvée, tu es éliminé.</p>
              <p>Chaque essai raté compte. Au nombre choisi, tu es éliminé.</p>
              <p>En illimité, seule une forme trouvée élimine.</p>
              <p>Le dernier encore en jeu gagne.</p>
              <p>Si ta forme est trouvée, tu choisis qui joue ensuite. Sinon, c'est la personne visée qui joue.</p>
            </section>
            <section>
              <h3>Points</h3>
              <p>Une forme exacte vaut 1 point.</p>
              <p>Un indice vaut 0,5 point.</p>
              <p>Le nombre d'essais compte aussi. Au maximum choisi, tu ne joues plus.</p>
              <p>En illimité, tu t'arrêtes seulement si ta forme est trouvée.</p>
              <p>Tes points restent. Tu peux encore gagner si tu as le meilleur score.</p>
              <p>La partie se termine quand plus personne ne peut jouer.</p>
            </section>
            <section>
              <h3>Entre deux tours</h3>
              <p>Après chaque essai, un délai s'affiche.</p>
              <p>Continuer ferme cette fenêtre. Si tout le monde continue, la partie reprend tout de suite.</p>
              <p>S'il ne reste que des bots, Finir la partie montre le résultat tout de suite.</p>
            </section>
          </div>
          <button type="button" data-act="closeNotice">Fermer</button>
        </div>
      </div>`;
  }
  function secretOverlay() {
    const m = me();
    if (!m || !m.shape || !m.color) return "";
    const label = `${SHAPE_LABEL[m.shape] || ""} ${COLOR_LABEL[m.color] || ""}`.trim();
    return `
      <div class="overlay">
        <div class="panel stack center secret">
          <h2>Votre forme</h2>
          <p class="muted">Vous avez comme forme</p>
          <div class="secret-piece">${piece(m.shape, m.color)}</div>
          <p class="secret-name">${esc(label)}</p>
          <button type="button" data-act="seenSecret">Continuer</button>
        </div>
      </div>`;
  }
  function onlyBotsLeft() {
    if (!state || state.phase === "ended" || state.phase === "lobby" || state.phase === "math") return false;
    const active = state.players.filter(
      (p) => p.alive && !p.found && state.players.some((o) => o.alive && !o.found && o.id !== p.id)
    );
    if (!active.length || active.some((p) => !p.isBot)) return false;
    if (state.phase === "pass_ball") {
      const chooser = byId(state.passChooserId);
      if (chooser && !chooser.isBot) return false;
    }
    return true;
  }
  function finishBtn() {
    if (!onlyBotsLeft()) return "";
    return `<button type="button" class="finish-now" data-act="finishBots">Finir la partie</button>`;
  }
  function layerHtml() {
    if (state.phase === "ended") return endOverlay();
    if (ui.showSecret && secretOverlay()) return secretOverlay();
    if (state.phase === "pass_ball") return passOverlay();
    if (state.phase === "reveal") return ui.revealClosed ? "" : resultOverlay();
    if (ui.alert && myTurn()) return alertHtml();
    if (ui.modal && myTurn()) return modalHtml();
    return "";
  }
  function setLayer(html) {
    if (html === lastLayer) return;
    const mh = layer.querySelector("#mh");
    const keep = mh ? mh.scrollTop : 0;
    const open = layer.querySelector(".hist-fold");
    const hadFold = Boolean(open);
    const wasOpen = open ? open.open : false;
    layer.innerHTML = html;
    lastLayer = html;
    const next = layer.querySelector("#mh");
    if (next) next.scrollTop = keep;
    const fold = layer.querySelector(".hist-fold");
    if (fold && hadFold) fold.open = wasOpen;
  }

  function checkTurn() {
    if (!myTurn()) {
      ui.alert = false;
      ui.modal = false;
      return;
    }
    if (ui.turnKey !== state.attempts) {
      ui.turnKey = state.attempts;
      ui.alert = true;
      ui.modal = false;
      ui.targetId = "";
      ui.shape = "";
      ui.color = "";
      clearTimeout(ui.timer);
      ui.timer = setTimeout(() => {
        ui.alert = false;
        if (myTurn()) ui.modal = true;
        render();
      }, 1500);
    }
  }

  function render() {
    const screen = !state ? "home" : state.phase === "lobby" ? "lobby" : state.phase === "math" ? "math" : "table";
    if (screen === "lobby" && lastScreen === "lobby" && lastHost === state.youAreHost) {
      patchLobby();
    } else if (screen === "math" && lastScreen === "math") {
      patchMath();
    } else {
      const views = { home: homeView, lobby: lobbyView, math: mathView, table: tableView };
      app.innerHTML = views[screen]();
      lastScreen = screen;
      lastHost = state ? state.youAreHost : null;
    }
    if (screen === "table") {
      ui.notice = false;
      checkTurn();
      setLayer(layerHtml());
    } else if (ui.notice) {
      setLayer(noticeOverlay());
    } else {
      setLayer("");
    }
  }

  function sendMath() {
    const input = $("math");
    if (!input || input.value.trim() === "") return;
    ui.math = input.value;
    socket.emit("mathAnswer", { value: Number(input.value.replace(",", ".")) });
  }

  document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const act = el.getAttribute("data-act");
    if (act === "create" || act === "join") {
      ui.name = $("name").value.trim();
      ui.code = $("code").value.trim();
      if (act === "create") socket.emit("createRoom", { name: ui.name || "Joueur" });
      else socket.emit("joinRoom", { name: ui.name || "Joueur", code: ui.code });
    } else if (act === "seenSecret") {
      ui.showSecret = false;
      render();
    } else if (act === "notice") {
      ui.notice = true;
      render();
    } else if (act === "closeNotice") {
      ui.notice = false;
      render();
    } else if (act === "leave") {
      socket.emit("leaveRoom");
    } else if (act === "continue") {
      ui.revealClosed = true;
      socket.emit("continueReveal");
      render();
    } else if (act === "start") {
      socket.emit("startGame", readSettings());
    } else if (act === "mathSend") {
      sendMath();
    } else if (act === "target") {
      ui.targetId = el.getAttribute("data-id");
      render();
    } else if (act === "shape") {
      ui.shape = el.getAttribute("data-shape");
      render();
    } else if (act === "color") {
      ui.color = el.getAttribute("data-color");
      render();
    } else if (act === "guess") {
      if (!(ui.targetId && ui.shape && ui.color) || ui.sending) return;
      ui.sending = true;
      socket.emit("guess", { targetId: ui.targetId, shape: ui.shape, color: ui.color });
      render();
    } else if (act === "pass") {
      socket.emit("passBall", { toId: el.getAttribute("data-id") });
    } else if (act === "avatar") {
      socket.emit("chooseAvatar", { file: el.getAttribute("data-file") });
    } else if (act === "share") {
      shareLink();
    } else if (act === "finishBots") {
      socket.emit("finishBots");
    } else if (act === "again") {
      location.href = location.pathname;
    }
  });

  function copyText(value) {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.top = "0";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    input.remove();
    return ok;
  }
  async function shareLink() {
    const url = location.href;
    const note = $("shareNote");
    const mobile = window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 900;
    const payload = {
      title: "SOLEIL",
      text: state ? `Rejoins ma partie SOLEIL. Code : ${state.code}` : "Rejoins ma partie SOLEIL",
      url,
    };
    const mark = (text) => {
      if (note) note.textContent = text;
    };
    try {
      if (mobile && navigator.share) {
        await navigator.share(payload);
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
    }
    if (copyText(url)) {
      mark("Lien copié");
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
        mark("Lien copié");
        return;
      }
    } catch {
      /* le presse-papiers est bloqué */
    }
    const link = $("shareLink");
    if (link) {
      const range = document.createRange();
      range.selectNodeContents(link);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }
    mark("Lien sélectionné");
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target && event.target.id === "math") sendMath();
  });

  const settingIds = ["maxPlayers", "errorCount", "delaySec", "historyVisible", "fillBots"];
  const onSetting = (event) => {
    if (!state || state.phase !== "lobby" || !state.youAreHost) return;
    const el = event.target;
    if (!el) return;
    const named = el.name === "winMode" || el.name === "errorLimit";
    if (el.name === "errorLimit") {
      const wrap = $("errorCountWrap");
      if (wrap) wrap.hidden = el.value === "unlimited";
    }
    if (settingIds.includes(el.id) || named) socket.emit("updateSettings", readSettings());
  };
  document.addEventListener("change", onSetting);
  document.addEventListener("input", (event) => {
    if (event.target && event.target.id === "name") ui.name = event.target.value;
    if (event.target && event.target.id === "code") {
      ui.code = event.target.value;
      const join = document.querySelector("[data-act='join']");
      if (join) join.classList.toggle("secondary", !ui.code.trim());
    }
    if (event.target && event.target.id === "math") ui.math = event.target.value;
    onSetting(event);
  });

  setInterval(() => {
    if (!state || state.phase !== "reveal") return;
    const ms = remainingMs();
    const cd = layer.querySelector("[data-cd]");
    if (cd) cd.textContent = Math.ceil(ms / 1000);
  }, 200);

  render();
})();
