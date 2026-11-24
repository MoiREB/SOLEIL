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

  socket.on("state", (next) => {
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
    return Boolean(state && state.phase === "playing" && m && m.alive && state.ballHolderId === state.viewerId);
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
      ${header("")}
      <p class="muted lead">Déduis la forme et la couleur. Élimine les autres. Reste le dernier en vie.</p>
      ${toast()}
      <div class="panel stack">
        <label>Pseudo
          <input id="name" maxlength="20" placeholder="Ton nom" value="${esc(ui.name)}" />
        </label>
        <button data-act="create">Créer une partie</button>
        <label>Code du salon
          <input id="code" maxlength="6" placeholder="ABCD" value="${esc(ui.code || params.get("room") || "")}" />
        </label>
        <button class="secondary" data-act="join">Rejoindre</button>
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
  function errorOptions(s) {
    return [1, 2, 3, 4, 5, 6, 7, 8, 9]
      .map((n) => `<option value="${n}"${s.maxErrors === n ? " selected" : ""}>${n}</option>`)
      .join("");
  }
  function pointsMode() {
    return Boolean(state && state.settings && state.settings.winMode === "points");
  }
  function avatarPicker() {
    const files = state.avatars || [];
    const mine = me();
    if (!files.length) return "";
    const taken = new Set(state.players.filter((p) => p.id !== state.viewerId && p.avatar).map((p) => p.avatar));
    const buttons = files
      .map((file) => {
        const picked = mine && mine.avatar === file;
        const busy = taken.has(file) && !picked;
        return `<button type="button" class="avbtn${picked ? " picked" : ""}" data-act="avatar" data-file="${esc(file)}" ${busy ? "disabled" : ""} aria-label="${esc(file.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "))}">${avatar({ avatar: file }, false)}</button>`;
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
      ${header(`<span class="code">${esc(state.code)}</span>`)}
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
      <div class="panel stack">
        <h2>Paramètres</h2>
        <label>Joueurs (2 à 9)
          <input type="number" min="2" max="9" id="maxPlayers" value="${s.maxPlayers}" ${dis} />
        </label>
        <label>Façon de gagner
          <select id="winMode" ${dis}>
            <option value="survival"${s.winMode === "points" ? "" : " selected"}>Dernier en vie</option>
            <option value="points"${s.winMode === "points" ? " selected" : ""}>Points</option>
          </select>
        </label>
        <label id="errorWrap"${s.winMode === "points" ? " hidden" : ""}>Essais avant élimination
          <select id="errorMode" ${dis}>${errorOptions(s)}</select>
        </label>
        <p id="pointsHint" class="muted small"${s.winMode === "points" ? "" : " hidden"}>Personne n'est éliminé. On marque des points, et le meilleur score gagne quand toutes les formes sont trouvées.</p>
        <label>Délai après chaque tentative (secondes)
          <input type="number" min="1" max="60" id="delaySec" value="${Math.round(s.delayMs / 1000)}" ${dis} />
        </label>
        <label class="check"><input type="checkbox" id="historyVisible" ${s.historyVisible ? "checked" : ""} ${dis} /> Historique visible pendant la partie</label>
        <label class="check"><input type="checkbox" id="fillBots" ${s.fillBots ? "checked" : ""} ${dis} /> Remplir les places vides avec des bots</label>
        ${state.youAreHost ? `<button data-act="start">Lancer la partie</button>` : `<p class="muted">En attente du créateur…</p>`}
      </div>
      <div class="panel">
        <h2>Joueurs (<span id="lobbyCount">${state.players.length}</span>/<span id="lobbyMax">${s.maxPlayers}</span>)</h2>
        <div id="lobbyPlayers" class="lrows">${lobbyPlayers()}</div>
        <div id="avatarPicker">${avatarPicker()}</div>
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
    const win = $("winMode");
    if (win && document.activeElement !== win) {
      win.value = s.winMode === "points" ? "points" : "survival";
      win.disabled = !state.youAreHost;
    }
    const mode = $("errorMode");
    if (mode && document.activeElement !== mode) {
      mode.value = String(s.maxErrors);
      mode.disabled = !state.youAreHost;
    }
    const points = s.winMode === "points";
    const errorWrap = $("errorWrap");
    const pointsHint = $("pointsHint");
    if (errorWrap) errorWrap.hidden = points;
    if (pointsHint) pointsHint.hidden = !points;
    const picker = $("avatarPicker");
    if (picker) picker.innerHTML = avatarPicker();
  }
  function readSettings() {
    const winMode = $("winMode").value === "points" ? "points" : "survival";
    return {
      maxPlayers: Number($("maxPlayers").value),
      maxErrors: Number($("errorMode").value) || state.settings.maxErrors,
      unlimitedErrors: false,
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
        <p class="muted">Une seule question pour savoir qui reçoit la balle.<br />Le premier qui trouve commence. Sinon, la réponse la plus proche.</p>
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
  function essaisText(p) {
    if (pointsMode()) return formatPts(p.points);
    return `Essais ${p.errors}/${state.settings.maxErrors}`;
  }
  function infoLine(p) {
    if (p.shape && p.color) return `<span class="lbl">Forme :</span>${piece(p.shape, p.color)}`;
    let v = "";
    if (p.clueShape && p.clueColor) v = piece(p.clueShape, p.clueColor);
    else if (p.clueShape) v = piece(p.clueShape, "gray");
    else if (p.clueColor) v = SHAPES.map((s) => piece(s, p.clueColor)).join("");
    return `<span class="lbl">Indice :</span>${v || '<span class="none">—</span>'}`;
  }
  function pcard(p) {
    const turn = state.ballHolderId === p.id && p.alive && state.phase !== "ended";
    const cls = !p.alive ? "dead" : turn ? "turn" : "idle";
    return `
      <div class="pcard ${cls}">
        <div class="pc-id">${avatar(p, false)}<span class="nm">${esc(p.name)}${p.id === state.viewerId ? " (toi)" : ""}</span></div>
        <div class="pc-info">
          <div class="scoreline">${pointsMode() ? `<span class="pts">${formatPts(p.points)}</span>` : `<span class="essais">${essaisText(p)}</span>`}</div>
          <div class="infoline">${infoLine(p)}</div>
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
    if (h.guesserEliminated) elim.push(`${esc(nameOf(h.guesserId))} éliminé`);
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
        : `Balle : <strong>${esc(nameOf(state.ballHolderId))}</strong>`;
    const spectator =
      m && !m.alive && state.phase !== "ended"
        ? `<p class="note">Tu es éliminé. Tu regardes la suite de la partie.</p>`
        : "";
    const hist = historyOn()
      ? `<section class="panel col"><h2>Historique</h2>${historyList()}</section>`
      : "";
    return `
      ${header(right)}
      ${toast()}
      ${spectator}
      <div class="board${historyOn() ? "" : " solo"}">
        <section class="panel col"><h2>Joueurs</h2><div class="plist">${state.players.map(pcard).join("")}</div></section>
        ${hist}
      </div>`;
  }

  function alertHtml() {
    return `<div class="alert"><b>À VOUS DE JOUER</b></div>`;
  }
  function modalHtml() {
    const targets = state.players
      .filter((p) => p.alive && !p.found && p.id !== state.viewerId)
      .map(
        (p) => `
        <button class="trow ${ui.targetId === p.id ? "picked" : ""}" data-act="target" data-id="${esc(p.id)}">
          ${avatar(p, true)}<span class="nm">${esc(p.name)}</span><span class="tclue">${infoLine(p)}</span><span class="ess">${essaisText(p)}</span>
        </button>`
      )
      .join("");
    const shapes = SHAPES.map(
      (s) =>
        `<button type="button" class="sbtn${ui.shape === s ? " picked" : ""}" data-act="shape" data-shape="${s}">${piece(s, "gray")}<span>${SHAPE_LABEL[s]}</span></button>`
    ).join("");
    const colors = COLORS.map(
      (c) =>
        `<button type="button" class="cbtn ${c}${ui.color === c ? " picked" : ""}" data-act="color" data-color="${c}"><span class="swatch"></span><span>${COLOR_LABEL[c]}</span></button>`
    ).join("");
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
            <div class="mleft"><h3>Cible</h3><div class="tlist">${targets}</div></div>
            <div class="mright">
              <div class="pick-block">
                <h3>Forme</h3>
                <div class="choices">${shapes}</div>
              </div>
              <div class="pick-block">
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
    const total = state.settings.delayMs;
    const ms = remainingMs();
    const elapsed = Math.max(0, total - ms);
    const ARROW = `<svg viewBox="0 0 72 28" aria-hidden="true"><path d="M2 14h54M42 4l18 10L42 24" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    return `
      <div class="overlay">
        <div class="panel result">
          <div class="cd"><span data-cd>${Math.ceil(ms / 1000)}</span></div>
          <div class="bar"><i style="animation-duration:${total}ms;animation-delay:-${elapsed}ms"></i></div>
          <div class="duel">${who(r.guesserId)}<span class="arrow big">${ARROW}</span>${who(r.targetId)}<span class="hguess">${piece(r.shape, r.color)}</span></div>
          <div class="vbig ${cls}">${title}</div>
          <p class="muted">${sub}</p>
          <div class="clue-box">${clueVisual(r.clue, r.shape, r.color)}</div>
          ${notes.length ? `<p class="notes">${notes.join(" ")}</p>` : ""}
          <p class="muted small">Le jeu reprend à la fin du délai.</p>
        </div>
      </div>`;
  }
  function passOverlay() {
    const chooser = state.passChooserId === state.viewerId;
    const living = state.players.filter((p) => p.alive);
    return `
      <div class="overlay">
        <div class="panel stack">
          <h2>La balle change de main</h2>
          <p class="muted">${esc(nameOf(state.passChooserId))} choisit le prochain détenteur.</p>
          ${
            chooser
              ? living
                  .map((p) => `<button class="trow" data-act="pass" data-id="${esc(p.id)}">${avatar(p, true)}<span class="nm">Donner à ${esc(p.name)}</span></button>`)
                  .join("")
              : `<p class="muted">En attente du choix…</p>`
          }
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
                return `<li><span class="score-who">${avatar(p, true)}<span>${esc(p.name)}</span></span><b>${mark}</b></li>`;
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
  function layerHtml() {
    if (state.phase === "ended") return endOverlay();
    if (state.phase === "pass_ball") return passOverlay();
    if (state.phase === "reveal") return resultOverlay();
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
      checkTurn();
      setLayer(layerHtml());
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

  const settingIds = ["maxPlayers", "errorMode", "winMode", "delaySec", "historyVisible", "fillBots"];
  const onSetting = (event) => {
    if (!state || state.phase !== "lobby" || !state.youAreHost) return;
    if (event.target && settingIds.includes(event.target.id)) socket.emit("updateSettings", readSettings());
  };
  document.addEventListener("change", onSetting);
  document.addEventListener("input", (event) => {
    if (event.target && event.target.id === "name") ui.name = event.target.value;
    if (event.target && event.target.id === "code") ui.code = event.target.value;
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
