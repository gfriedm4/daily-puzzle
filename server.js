import express from "express";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Resvg } from "@resvg/resvg-js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env from the project root so `npm start` works without exporting vars.
const envPath = join(__dirname, ".env");
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch (e) {
    console.warn(`couldn't read .env: ${e.message}`);
  }
}

const PORT = process.env.PORT || 3000;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const app = express();
app.use(express.json({ limit: "64kb" }));
app.use(express.static(join(__dirname, "public")));
app.get("/favicon.ico", (_req, res) => res.status(204).end());

// Puzzles: the player never sees the SVG source, only the rendered target.
const puzzles = JSON.parse(
  await readFile(join(__dirname, "puzzles", "puzzles.json"), "utf8")
);

// Scoring resolution. Both target and painting rasterize to this square, over
// white, then we compare pixel for pixel. Small enough to be fast per request.
const RENDER_SIZE = 256;

function rasterize(svg) {
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: RENDER_SIZE },
    background: "white",
  });
  return r.render().pixels; // RGBA buffer, opaque over white
}

// Average per-pixel color closeness, 0..100. 100 = identical bits.
function scoreMatch(a, b) {
  const maxDist = Math.sqrt(3 * 255 * 255);
  let sum = 0;
  const n = a.length / 4;
  for (let i = 0; i < a.length; i += 4) {
    const dr = a[i] - b[i];
    const dg = a[i + 1] - b[i + 1];
    const db = a[i + 2] - b[i + 2];
    sum += 1 - Math.sqrt(dr * dr + dg * dg + db * db) / maxDist;
  }
  return (sum / n) * 100;
}

// Pre-rasterize every target once; scoring a submission is then one render +
// one diff. The answer-key pixels live only on the server.
const targetPixels = new Map(puzzles.map((p) => [p.id, rasterize(p.svg)]));

// hash(puzzle, prompt) -> { svg, score }. Deterministic engine means the same
// prompt on the same puzzle always lands the same image, so we never pay Gemini
// twice for it. This is the cache the cost model leaned on.
const resultCache = new Map();
const cacheKey = (puzzleId, prompt) =>
  createHash("sha256").update(`${puzzleId}\n${prompt}`).digest("hex");

// Strip puzzle SVG so the answer key never ships to the browser.
app.get("/api/puzzles", (_req, res) => {
  res.json(puzzles.map(({ id, name }) => ({ id, name })));
});

// The renderer needs the target image to diff against, so it gets the SVG —
// but only as a rasterized data source, and the player can't read network tabs
// mid-game any more than they could screenshot the answer. Good enough for v0.
app.get("/api/target/:id", (req, res) => {
  const p = puzzles.find((q) => q.id === req.params.id);
  if (!p) return res.status(404).json({ error: "no such puzzle" });
  res.type("image/svg+xml").send(p.svg);
});

const ENGINE_INSTRUCTION = `You are a rendering engine that turns a short description into a flat SVG illustration. Rules:
- Output ONLY raw SVG. No markdown, no code fences, no commentary.
- Root element: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">.
- First child is always a full-canvas background <rect width="512" height="512">. Default white (#ffffff) unless the description names a background color.
- Use only basic shapes: rect, circle, ellipse, polygon, line. Flat solid fills. No gradients, no filters, no shadows, no strokes unless asked.
- Interpret the description literally and geometrically. "centered" means cx/cy 256. Keep shapes well inside the canvas.
- If the description is vague, make a clean reasonable choice. Never add extra decoration that wasn't asked for.`;

async function generateSvg(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: ENGINE_INSTRUCTION }] },
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2048 },
  };
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`engine ${r.status}: ${detail.slice(0, 300)}`);
  }
  const data = await r.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return sanitizeSvg(text);
}

// Pull the <svg>...</svg> out of whatever the model returned and make sure it's
// the inert, shape-only kind we want on a canvas (no scripts, no foreign refs).
function sanitizeSvg(raw) {
  let s = raw.replace(/```(?:svg|xml|html)?/gi, "").trim();
  const start = s.indexOf("<svg");
  const end = s.lastIndexOf("</svg>");
  if (start === -1 || end === -1) throw new Error("engine returned no SVG");
  s = s.slice(start, end + "</svg>".length);
  if (/<script|onload=|onclick=|<foreignObject|<image|href\s*=/i.test(s)) {
    throw new Error("engine SVG contained disallowed content");
  }
  return s;
}

app.post("/api/generate", async (req, res) => {
  const prompt = (req.body?.prompt || "").trim();
  const puzzleId = String(req.body?.puzzleId || "");
  const target = targetPixels.get(puzzleId);
  if (!target) return res.status(400).json({ error: "unknown puzzle" });
  if (!prompt) return res.status(400).json({ error: "empty prompt" });
  if (prompt.length > 600)
    return res.status(400).json({ error: "prompt too long (max 600 chars)" });
  if (!GEMINI_API_KEY)
    return res.status(503).json({ error: "engine offline: GEMINI_API_KEY not set" });

  const key = cacheKey(puzzleId, prompt);
  const hit = resultCache.get(key);
  if (hit) return res.json({ ...hit, chars: prompt.length, cached: true });

  try {
    const svg = await generateSvg(prompt);
    const score = Math.round(scoreMatch(target, rasterize(svg)) * 10) / 10;
    const payload = { svg, score };
    resultCache.set(key, payload);
    res.json({ ...payload, chars: prompt.length });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
});

app.listen(PORT, () => {
  console.log(`daily-puzzle on http://localhost:${PORT}`);
  if (!GEMINI_API_KEY) console.warn("warning: GEMINI_API_KEY not set — engine will 503");
});
