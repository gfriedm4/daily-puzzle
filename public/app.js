const $ = (id) => document.getElementById(id);
const SIZE = 512;

const resultCanvas = $("resultCanvas");
const tctx = $("targetCanvas").getContext("2d");
const rctx = resultCanvas.getContext("2d");

let currentPuzzle = null;

// One-shot gate: once you've played a puzzle, your attempt is saved here and the
// input locks. It's the Wordle model — clearable in devtools, but honest players
// get one try. Real anti-cheat waits for accounts + a leaderboard.
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

// Paint an SVG string onto a canvas over white (display only — scoring is the
// server's job now).
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

async function showResult(svg, score, chars, name) {
  $("resultPh").style.display = "none";
  resultCanvas.style.display = "block";
  await drawSvg(rctx, svg);
  $("resultTag").textContent = `${chars} chars`;
  const p = score.toFixed(1);
  const stars =
    score >= 95 ? "🟩🟩🟩🟩🟩"
    : score >= 90 ? "🟩🟩🟩🟩⬜"
    : score >= 80 ? "🟩🟩🟩⬜⬜"
    : score >= 65 ? "🟩🟩⬜⬜⬜"
    : score >= 50 ? "🟩⬜⬜⬜⬜"
    : "⬜⬜⬜⬜⬜";
  $("result").innerHTML = `
    <div class="score">
      <span class="big">${p}%</span>
      <span class="meta">match · ${chars} chars</span>
    </div>
    <div class="share">Daily Puzzle — ${name}\n${stars}  ${p}%  ·  ${chars} chars</div>`;
}

async function loadPuzzle(id) {
  currentPuzzle = id;
  const name = $("puzzle").selectedOptions[0]?.textContent || "";
  const svg = await (await fetch(`/api/target/${id}`)).text();
  await drawSvg(tctx, svg);

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
  if (getAttempt(currentPuzzle)) return; // already played
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
    const attempt = { prompt, svg: data.svg, score: data.score, chars: data.chars };
    saveAttempt(currentPuzzle, attempt);
    setLocked(true, "You've already played this one.");
    await showResult(data.svg, data.score, data.chars, name);
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

  if (list.length) await loadPuzzle(list[0].id);
}

init();
