/**
 * node scripts/gen-components-map.mjs
 * Draws the swimlane Components Map (actors x stages) as SVG and PNG:
 *   docs/components-map.svg, docs/components-map.png, public/components-map.png
 * Content mirrors docs/02_ARCHITECTURE_AND_COMPONENTS_MAP.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";

const COLS = ["Trigger", "Input", "Context", "Processing", "AI", "Output"];
const ROWS = [
  { name: "Vikram", sub: "(you)", bg: "#e8f3f1" },
  { name: "Scheduler", sub: "(starts the scan)", bg: "#eef0fb" },
  { name: "Source Collector", sub: "(finds news and posts)", bg: "#fdf3e1" },
  { name: "Gemini Flash", sub: "(AI reader)", bg: "#f1eafc" },
  { name: "Rules Engine", sub: "(scores and decides)", bg: "#fdeee3" },
  { name: "Database", sub: "(stores everything safely)", bg: "#e3f1f6" },
  { name: "Delivery", sub: "(email and website)", bg: "#f6efe4" },
];
const STYLE = {
  Trigger: { fill: "#FEF3C7", stroke: "#D97706" },
  Input: { fill: "#DBEAFE", stroke: "#2563EB" },
  Context: { fill: "#CCEFEA", stroke: "#0F766E" },
  Processing: { fill: "#E0E7FF", stroke: "#4F46E5" },
  AI: { fill: "#EDE4FD", stroke: "#7C3AED" },
  Output: { fill: "#FFE5D1", stroke: "#EA580C" },
};

// id, row, col, text
const BOX = [
  ["v1", 0, 0, "Opens RaiseRoute or presses Run now"],
  ["v2", 0, 1, "Updates notes, contact status, company and the scoring table"],
  ["v3", 0, 5, "Sees who to contact today, and why, with sources"],
  ["s1", 1, 0, "Every Monday and Thursday morning, or Run now"],
  ["s2", 1, 1, "Starts one scan with one small job per investor"],
  ["c1", 2, 1, "Investor names and the people we track"],
  ["c2", 2, 2, "Investor blogs, Google News, trade-press feeds, your company profile"],
  ["c3", 2, 3, "Opens each article, finds the real date, checks the right investor"],
  ["a1", 3, 4, "Reads the article and notes what happened, with an exact quote. Never scores"],
  ["r1", 4, 1, "Checked facts: quote is on the page, date is within 30 days"],
  ["r2", 4, 2, "Your scoring table, your contact history, the 30-day window"],
  ["r3", 4, 3, "Gives a score from 0 to 100 and picks one action"],
  ["r4", 4, 5, "Score, action and reason saved for each investor"],
  ["d1", 5, 3, "Updates only the signal columns. Before-and-after check on your data"],
  ["d2", 5, 5, "Your notes and contact history are exactly as you left them"],
  ["i1", 6, 3, "Sends the email summary and updates the live website"],
  ["i2", 6, 5, "Summary in your inbox; live site up to date"],
];
const EDGES = [
  ["v1", "s2"], ["s1", "s2"], ["s2", "c1"], ["c1", "c2"], ["c2", "c3"], ["c3", "a1"], ["a1", "r1"], ["r1", "r2"], ["r2", "r3"],
  ["r3", "r4"], ["r3", "d1"], ["d1", "d2"], ["r4", "v3"], ["d2", "i1"], ["i1", "i2"], ["v2", "r2"],
];

const W = 1900, LBL = 182, HDR = 50, TOP = 78, ROWH = 137, COLW = (W - 15 - 15 - LBL) / 6;
const H = TOP + HDR + ROWS.length * ROWH + 25;
const X0 = 15 + LBL;
const bw = COLW - 28, bh = 112;
const pos = Object.fromEntries(
  BOX.map(([id, r, c, t]) => [id, { id, r, c, t, x: X0 + c * COLW + 14, y: TOP + HDR + r * ROWH + (ROWH - bh) / 2, w: bw, h: bh }]),
);
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
function wrap(t, max = 30) {
  const out = [];
  let line = "";
  for (const w of t.split(" ")) {
    if ((line + " " + w).trim().length > max) { out.push(line); line = w; } else line = (line + " " + w).trim();
  }
  if (line) out.push(line);
  return out;
}

let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Segoe UI, Arial, sans-serif">
<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#0b3b3a"/></marker></defs>
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="${W / 2}" y="48" text-anchor="middle" font-size="36" font-weight="700" fill="#0b3b3a">RaiseRoute — How it works (Components Map)</text>
<rect x="15" y="${TOP}" width="${W - 30}" height="${HDR}" rx="10" fill="#0f766e"/>
<text x="${15 + LBL / 2}" y="${TOP + 32}" text-anchor="middle" font-size="20" font-weight="600" fill="#fff">Actor</text>`;
COLS.forEach((c, i) => (svg += `<text x="${X0 + i * COLW + COLW / 2}" y="${TOP + 32}" text-anchor="middle" font-size="20" font-weight="600" fill="#fff">${c}</text>`));
ROWS.forEach((r, i) => {
  const y = TOP + HDR + i * ROWH;
  svg += `<rect x="${X0}" y="${y}" width="${W - 30 - LBL}" height="${ROWH}" fill="${r.bg}"/>`;
  svg += `<rect x="15" y="${y}" width="${LBL}" height="${ROWH}" fill="#0b3b3a" stroke="#fff" stroke-width="1.5"/>`;
  svg += `<text x="${15 + LBL / 2}" y="${y + ROWH / 2 - 4}" text-anchor="middle" font-size="21" font-weight="700" fill="#fff">${esc(r.name)}</text>`;
  const sub = wrap(r.sub, 22);
  sub.forEach((l, k) => (svg += `<text x="${15 + LBL / 2}" y="${y + ROWH / 2 + 17 + k * 16}" text-anchor="middle" font-size="13" fill="#bfe3dd">${esc(l)}</text>`));
});
for (let i = 1; i < 6; i++) svg += `<line x1="${X0 + i * COLW}" y1="${TOP + HDR}" x2="${X0 + i * COLW}" y2="${H - 25}" stroke="#fff" stroke-width="2"/>`;

for (const [a, b] of EDGES) {
  const A = pos[a], B = pos[b];
  let d;
  if (A.r === B.r) d = `M${A.x + A.w} ${A.y + A.h / 2} L${B.x} ${B.y + B.h / 2}`;
  else if (A.c === B.c) d = `M${A.x + A.w / 2} ${A.y + (B.r > A.r ? A.h : 0)} L${B.x + B.w / 2} ${B.y + (B.r > A.r ? 0 : B.h)}`;
  else if (B.c > A.c) { const gx = B.x - 14; d = `M${A.x + A.w} ${A.y + A.h / 2} L${gx} ${A.y + A.h / 2} L${gx} ${B.y + B.h / 2} L${B.x} ${B.y + B.h / 2}`; }
  else { const gy = B.r > A.r ? B.y - 12 : B.y + B.h + 12; d = `M${A.x + A.w / 2} ${A.y + (B.r > A.r ? A.h : 0)} L${A.x + A.w / 2} ${gy} L${B.x + B.w / 2} ${gy} L${B.x + B.w / 2} ${B.y + (B.r > A.r ? 0 : B.h)}`; }
  svg += `<path d="${d}" fill="none" stroke="#0b3b3a" stroke-width="2" stroke-dasharray="7 5" marker-end="url(#ar)"/>`;
}
for (const p of Object.values(pos)) {
  const s = STYLE[COLS[p.c]];
  svg += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="14" fill="${s.fill}" stroke="${s.stroke}" stroke-width="2.5"/>`;
  const lines = wrap(p.t, 31);
  const y0 = p.y + p.h / 2 - ((lines.length - 1) * 9);
  lines.forEach((l, k) => (svg += `<text x="${p.x + p.w / 2}" y="${y0 + k * 18 + 5}" text-anchor="middle" font-size="15" fill="#0b3b3a">${esc(l)}</text>`));
}
svg += `</svg>`;

mkdirSync("docs", { recursive: true });
mkdirSync("public", { recursive: true });
writeFileSync("docs/components-map.svg", svg);
const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
writeFileSync("docs/components-map.png", png);
writeFileSync("public/components-map.png", png);
console.log("wrote docs/components-map.svg, docs/components-map.png, public/components-map.png");
