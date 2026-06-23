const $ = (id) => document.getElementById(id);
const SIZE = 512;

const resultCanvas = $("resultCanvas");
const tctx = $("targetCanvas").getContext("2d");
const rctx = resultCanvas.getContext("2d");

let currentPuzzle = null;

// --- Nickname (casual identity, localStorage, no login) ---
const NICK_KEY = "dp:nick";
const getNick = () => localStorage.getItem(NICK_KEY) || "";
const setNick = (n) => localStorage.setItem(NICK_KEY, n);

function showNickModal() {
  $("nickInput").value = getNick();
  $("nickModal").classList.add("show");
  $("nickInput").focus();
}
function saveNickFromModal() {
  const n = $("nickInput").value.trim().slice(0, 20);
  if (!n) return;
  setNick(n);
  $("whoName").textContent = n;
  $("nickModal").classList.remove("show");
}

// --- One-shot gate: one attempt per puzzle, saved locally, locks the input ---
const saveKey = (id) => `dp:v1:${id}`;
const getAttempt = (id) => {
  try {
    return JSON.parse(localStorage.getItem(saveKey(id)) || "null");
  } catch {
    return null;
  }
};
const saveAttempt = (id, a) =>
  localStorage.setItem(saveKey(id), JSON.stringify(a));

function drawSvg(ctx, svg) {
  return new Promise((resolve, reject) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, SIZE, SIZE);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      resolve();
    };
    img.onerror = () => reject(new Error("couldn't render that SVG"));
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });
}

function setLocked(locked, note) {
  $("prompt").disabled = locked;
  $("paint").disabled = locked;
  $("paint").textContent = locked ? "Played" : "Paint it";
  if (locked && note) $("prompt").placeholder = note;
}

function starsFor(score) {
  return score >= 95 ? "🟩🟩🟩🟩🟩"
    : score >= 90 ? "🟩🟩🟩🟩⬜"
    : score >= 80 ? "🟩🟩🟩⬜⬜"
    : score >= 65 ? "🟩🟩⬜⬜⬜"
    : score >= 50 ? "🟩⬜⬜⬜⬜"
    : "⬜⬜⬜⬜⬜";
}

async function showResult(svg, score, chars, name) {
  $("resultPh").style.display = "none";
  resultCanvas.style.display = "block";
  await drawSvg(rctx, svg);
  $("resultTag").textContent = `${chars} chars`;
  const p = score.toFixed(1);
  $("result").innerHTML = `
    <div class="score">
      <span class="big">${p}%</span>
      <span class="meta">match · ${chars} chars</span>
    </div>
    <div class="share">Daily Puzzle — ${name}\n${starsFor(score)}  ${p}%  ·  ${chars} chars</div>`;
}

function renderLeaderboard(top) {
  const me = getNick();
  const list = $("lbList");
  if (!top || !top.length) {
    list.innerHTML = `<li class="lb-empty">No scores yet. Be first.</li>`;
    return;
  }
  list.innerHTML = top
    .map((r, i) => {
      const mine = r.nickname === me ? " me" : "";
      const nick = r.nickname.replace(/[<>&]/g, "");
      return `<li class="${mine.trim()}">
        <span class="rank">${i + 1}</span>
        <span class="nick">${nick}</span>
        <span class="pct">${r.score.toFixed(1)}%</span>
        <span class="ch">${r.chars} ch</span>
      </li>`;
    })
    .join("");
}

async function loadLeaderboard(id) {
  try {
    const { top } = await (await fetch(`/api/leaderboard/${id}`)).json();
    renderLeaderboard(top);
  } catch {
    /* leave whatever's there */
  }
}

async function loadPuzzle(id) {
  currentPuzzle = id;
  const name = $("puzzle").selectedOptions[0]?.textContent || "";
  $("lbPuzzle").textContent = `· ${name}`;
  const svg = await (await fetch(`/api/target/${id}`)).text();
  await drawSvg(tctx, svg);
  loadLeaderboard(id);

  const prior = getAttempt(id);
  if (prior) {
    $("prompt").value = prior.prompt;
    $("chars").textContent = prior.chars;
    setLocked(true, "You've already played this one.");
    await showResult(prior.svg, prior.score, prior.chars, name);
  } else {
    $("prompt").value = "";
    $("prompt").placeholder = "e.g. a red circle in the middle on white";
    $("chars").textContent = "0";
    setLocked(false);
    resultCanvas.style.display = "none";
    $("resultPh").style.display = "flex";
    $("resultTag").textContent = "";
    $("result").innerHTML = "";
  }
}

async function paint() {
  if (getAttempt(currentPuzzle)) return;
  if (!getNick()) return showNickModal();
  const prompt = $("prompt").value.trim();
  if (!prompt) return;
  const btn = $("paint");
  btn.disabled = true;
  $("result").innerHTML = `<span class="spinner"></span> painting…`;
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, puzzleId: currentPuzzle }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `error ${res.status}`);

    const name = $("puzzle").selectedOptions[0]?.textContent || "";
    saveAttempt(currentPuzzle, {
      prompt,
      svg: data.svg,
      score: data.score,
      chars: data.chars,
    });
    setLocked(true, "You've already played this one.");
    await showResult(data.svg, data.score, data.chars, name);

    // Hand the server-issued token back with our nickname to claim a row.
    if (data.token) {
      const r = await fetch("/api/leaderboard/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: data.token, nickname: getNick() }),
      });
      if (r.ok) renderLeaderboard((await r.json()).top);
    }
  } catch (e) {
    $("result").innerHTML = `<span class="err">${e.message}</span>`;
    btn.disabled = false;
  }
}

async function init() {
  const list = await (await fetch("/api/puzzles")).json();
  const sel = $("puzzle");
  sel.innerHTML = list
    .map((p) => `<option value="${p.id}">${p.name}</option>`)
    .join("");
  sel.addEventListener("change", () => loadPuzzle(sel.value));

  const ta = $("prompt");
  ta.addEventListener("input", () => ($("chars").textContent = ta.value.trim().length));
  $("paint").addEventListener("click", paint);
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") paint();
  });

  $("whoName").textContent = getNick() || "guest";
  $("changeNick").addEventListener("click", (e) => {
    e.preventDefault();
    showNickModal();
  });
  $("nickSave").addEventListener("click", saveNickFromModal);
  $("nickInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") saveNickFromModal();
  });

  if (list.length) await loadPuzzle(list[0].id);
  if (!getNick()) showNickModal();
}

init();
