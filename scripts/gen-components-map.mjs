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
  { name: "Vikram", sub: "(Founder, user)", bg: "#e7ecfd" },
  { name: "Scheduler", sub: "(Vercel Cron, Run now)", bg: "#efe7fc" },
  { name: "Source Collector", sub: "(App backend, per investor)", bg: "#fff4dc" },
  { name: "Gemini Flash", sub: "(AI model)", bg: "#e6f4ea" },
  { name: "Rules Engine", sub: "(App backend, code)", bg: "#fbece0" },
  { name: "Database", sub: "(Neon + Integrity Guard)", bg: "#e2f1f6" },
  { name: "Integrations", sub: "(Resend, GitHub, Vercel)", bg: "#fde7ee" },
];
const STYLE = {
  Trigger: { fill: "#e3e1fb", stroke: "#5b5bd6" },
  Input: { fill: "#dcebfd", stroke: "#2f80d8" },
  Context: { fill: "#dff3e3", stroke: "#2e9e55" },
  Processing: { fill: "#fdefd0", stroke: "#e5a11a" },
  AI: { fill: "#fcdcec", stroke: "#d6307f" },
  Output: { fill: "#fde0dc", stroke: "#e5483b" },
};

// id, row, col, text
const BOX = [
  ["v1", 0, 0, "Opens RaiseRoute, or presses Run now"],
  ["v2", 0, 1, "Edits notes, contact status, company profile and the scoring rubric"],
  ["v3", 0, 5, "Sees who to contact this week and why, with dated sources"],
  ["s1", 1, 0, "Mon + Thu 03:00 UTC (Vercel Cron) or Run now"],
  ["s2", 1, 1, "Starts one run: one task per investor (50)"],
  ["c1", 2, 1, "Investor names, aliases and tracked people"],
  ["c2", 2, 2, "Official feeds, Google News RSS, 9 sector feeds, company profile"],
  ["c3", 2, 3, "Safe fetch, real publish date, right investor? Dedupe"],
  ["a1", 3, 4, "Reads each page, returns the event and an exact quote. Never scores"],
  ["r1", 4, 1, "Verified facts: quote found, date within 30 days"],
  ["r2", 4, 2, "Scoring rubric (editable), relationship status, 30-day window"],
  ["r3", 4, 3, "Scores 100 points, picks the action, writes the why-now"],
  ["r4", 4, 5, "Score, action, why-now and sources saved as a snapshot"],
  ["d1", 5, 3, "apply_assessment() updates only signal columns, hash before and after"],
  ["d2", 5, 5, "Your notes and contact history untouched; run receipt saved"],
  ["i1", 6, 3, "Digest email (Resend); code in GitHub deploys to Vercel"],
  ["i2", 6, 5, "Email in your inbox; live site updated"],
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
<defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#14284b"/></marker></defs>
<rect width="${W}" height="${H}" fill="#fff"/>
<text x="${W / 2}" y="48" text-anchor="middle" font-size="36" font-weight="700" fill="#14284b">RaiseRoute — Components Map</text>
<rect x="15" y="${TOP}" width="${W - 30}" height="${HDR}" rx="10" fill="#14284b"/>
<text x="${15 + LBL / 2}" y="${TOP + 32}" text-anchor="middle" font-size="20" font-weight="600" fill="#fff">Actor</text>`;
COLS.forEach((c, i) => (svg += `<text x="${X0 + i * COLW + COLW / 2}" y="${TOP + 32}" text-anchor="middle" font-size="20" font-weight="600" fill="#fff">${c}</text>`));
ROWS.forEach((r, i) => {
  const y = TOP + HDR + i * ROWH;
  svg += `<rect x="${X0}" y="${y}" width="${W - 30 - LBL}" height="${ROWH}" fill="${r.bg}"/>`;
  svg += `<rect x="15" y="${y}" width="${LBL}" height="${ROWH}" fill="#14284b" stroke="#fff" stroke-width="1.5"/>`;
  svg += `<text x="${15 + LBL / 2}" y="${y + ROWH / 2 - 4}" text-anchor="middle" font-size="21" font-weight="700" fill="#fff">${esc(r.name)}</text>`;
  const sub = wrap(r.sub, 22);
  sub.forEach((l, k) => (svg += `<text x="${15 + LBL / 2}" y="${y + ROWH / 2 + 17 + k * 16}" text-anchor="middle" font-size="13" fill="#c9d3e6">${esc(l)}</text>`));
});
for (let i = 1; i < 6; i++) svg += `<line x1="${X0 + i * COLW}" y1="${TOP + HDR}" x2="${X0 + i * COLW}" y2="${H - 25}" stroke="#fff" stroke-width="2"/>`;

for (const [a, b] of EDGES) {
  const A = pos[a], B = pos[b];
  let d;
  if (A.r === B.r) d = `M${A.x + A.w} ${A.y + A.h / 2} L${B.x} ${B.y + B.h / 2}`;
  else if (A.c === B.c) d = `M${A.x + A.w / 2} ${A.y + (B.r > A.r ? A.h : 0)} L${B.x + B.w / 2} ${B.y + (B.r > A.r ? 0 : B.h)}`;
  else if (B.c > A.c) { const gx = B.x - 14; d = `M${A.x + A.w} ${A.y + A.h / 2} L${gx} ${A.y + A.h / 2} L${gx} ${B.y + B.h / 2} L${B.x} ${B.y + B.h / 2}`; }
  else { const gy = B.r > A.r ? B.y - 12 : B.y + B.h + 12; d = `M${A.x + A.w / 2} ${A.y + (B.r > A.r ? A.h : 0)} L${A.x + A.w / 2} ${gy} L${B.x + B.w / 2} ${gy} L${B.x + B.w / 2} ${B.y + (B.r > A.r ? 0 : B.h)}`; }
  svg += `<path d="${d}" fill="none" stroke="#14284b" stroke-width="2" stroke-dasharray="7 5" marker-end="url(#ar)"/>`;
}
for (const p of Object.values(pos)) {
  const s = STYLE[COLS[p.c]];
  svg += `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="14" fill="${s.fill}" stroke="${s.stroke}" stroke-width="2.5"/>`;
  const lines = wrap(p.t, 31);
  const y0 = p.y + p.h / 2 - ((lines.length - 1) * 9);
  lines.forEach((l, k) => (svg += `<text x="${p.x + p.w / 2}" y="${y0 + k * 18 + 5}" text-anchor="middle" font-size="15" fill="#14284b">${esc(l)}</text>`));
}
svg += `</svg>`;

mkdirSync("docs", { recursive: true });
mkdirSync("public", { recursive: true });
writeFileSync("docs/components-map.svg", svg);
const png = await sharp(Buffer.from(svg), { density: 144 }).png().toBuffer();
writeFileSync("docs/components-map.png", png);
writeFileSync("public/components-map.png", png);
console.log("wrote docs/components-map.svg, docs/components-map.png, public/components-map.png");
