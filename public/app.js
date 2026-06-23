const $ = (id) => document.getElementById(id);
const SIZE = 512;

const targetCanvas = $("targetCanvas");
const resultCanvas = $("resultCanvas");
const tctx = targetCanvas.getContext("2d", { willReadFrequently: true });
const rctx = resultCanvas.getContext("2d", { willReadFrequently: true });

let targetData = null; // ImageData of current target, for diffing
let currentPuzzle = null;

// Render an SVG string onto a canvas over a white base, return the ImageData.
function drawSvg(ctx, svg) {
  return new Promise((resolve, reject) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, SIZE, SIZE);
    const img = new Image();
    const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    img.onload = () => {
      ctx.drawImage(img, 0, 0, SIZE, SIZE);
      resolve(ctx.getImageData(0, 0, SIZE, SIZE));
    };
    img.onerror = () => reject(new Error("couldn't render that SVG"));
    img.src = url;
  });
}

// Per-pixel color closeness, averaged. 100 = identical, 0 = maximally different.
function matchPct(a, b) {
  const maxDist = Math.sqrt(3 * 255 * 255);
  let sum = 0;
  const n = a.data.length / 4;
  for (let i = 0; i < a.data.length; i += 4) {
    const dr = a.data[i] - b.data[i];
    const dg = a.data[i + 1] - b.data[i + 1];
    const db = a.data[i + 2] - b.data[i + 2];
    sum += 1 - Math.sqrt(dr * dr + dg * dg + db * db) / maxDist;
  }
  return (sum / n) * 100;
}

async function loadPuzzle(id) {
  currentPuzzle = id;
  const svg = await (await fetch(`/api/target/${id}`)).text();
  targetData = await drawSvg(tctx, svg);
  // clear prior result
  resultCanvas.style.display = "none";
  $("resultPh").style.display = "flex";
  $("resultTag").textContent = "";
  $("result").innerHTML = "";
}

async function paint() {
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

    const resultData = await drawSvg(rctx, data.svg);
    $("resultPh").style.display = "none";
    resultCanvas.style.display = "block";

    const pct = matchPct(targetData, resultData);
    const chars = prompt.length;
    $("resultTag").textContent = `${chars} chars`;
    showScore(pct, chars);
  } catch (e) {
    $("result").innerHTML = `<span class="err">${e.message}</span>`;
  } finally {
    btn.disabled = false;
  }
}

function showScore(pct, chars) {
  const p = pct.toFixed(1);
  const name = $("puzzle").selectedOptions[0]?.textContent || "";
  const stars = pct >= 95 ? "🟩🟩🟩🟩🟩"
    : pct >= 90 ? "🟩🟩🟩🟩⬜"
    : pct >= 80 ? "🟩🟩🟩⬜⬜"
    : pct >= 65 ? "🟩🟩⬜⬜⬜"
    : pct >= 50 ? "🟩⬜⬜⬜⬜"
    : "⬜⬜⬜⬜⬜";
  $("result").innerHTML = `
    <div class="score">
      <span class="big">${p}%</span>
      <span class="meta">match · ${chars} chars</span>
    </div>
    <div class="share">Daily Puzzle — ${name}\n${stars}  ${p}%  ·  ${chars} chars</div>`;
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
  $("reset").addEventListener("click", () => {
    ta.value = "";
    $("chars").textContent = "0";
    loadPuzzle(currentPuzzle);
  });
  ta.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") paint();
  });

  if (list.length) await loadPuzzle(list[0].id);
}

init();
