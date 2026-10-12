# Design Spec — "calm control tower" (visual layer; routes/content stay as in 01_PRODUCT_SPEC §6)

Goal: a founder opens this on his phone before work and in **5 seconds** knows who to contact today and why.
**Calm, spacious, one thing shouts at a time.** If a screen feels busy, remove things, do not shrink them.

## 1. Reference layouts (structure only, colours are ours)
| Reference | Borrow | Used on |
|---|---|---|
| Finance dashboard (greeting, KPI cards, chart card, recent-activity table) | Overall page skeleton, soft cards on light grey, pill nav, rounded table with status dots | `/` Command Centre, `/pipeline` |
| Task board (greeting, one-line AI banner, columns with count badges, cards with priority chip) | Column board grouped by recommended action, card anatomy | Board view toggle on `/pipeline` and Today's Actions |
| Chat workspace (right-hand "Info / Pins / Files" panel) | Right-side detail drawer with tabs and a vertical member-style list | `/vc/[slug]` drawer: Why / Evidence / Relationship / History |

Do NOT copy the dense three-pane chat sidebar. One slim icon rail only.

## 2. Layout shell
- App background `--bg`, a large rounded white container with 24px radius inside (like the references), 16–24px page padding.
- **Top bar (pill-shaped):** logo mark + "FreightLoop Pipeline" wordmark · pill nav (Overview, Pipeline, Runs, Digests, Calibration, Settings) · right side: last-run chip, Integrity badge, avatar.
- **Left icon rail** (56px, icons only, tooltips): Overview, Pipeline, Runs, Digests, Settings. Hidden on mobile, replaced by a bottom tab bar (4 items).
- Content max width 1280px. 12-col grid, 16px gaps (24px on desktop).
- Greeting header: "Good morning, Vikram" (H1) + one calm subline: "3 investors worth contacting today. Last checked 2 hours ago."

## 3. Command Centre (`/`) — visual hierarchy, top to bottom
1. **Greeting + subline** (the only H1).
2. **One-line AI banner** (like the "Noteflow AI" strip): "Weekly scan complete: 4 new signals, 2 priority changes. [View changes]". Dismissable. Violet tag "AI".
3. **KPI strip: only 4 big cards**, not 7: *Reach out now* (hero card, filled brand gradient, largest number) · *Follow up now* · *Monitor* · *Needs attention* (hold + incomplete). Each: big number, label, tiny delta vs last run. "Don't prioritize" and the rest live behind a "See all 50" link, not as cards.
4. **Two-column row:**
   - Left (wider): **Today's Actions**, max 5 cards, each = VC name + firm, score ring, ONE-sentence "why now", evidence chip (domain · date), next-step button, 👍/👎. "Show more" for the rest.
   - Right: **What changed** (short list, max 5 rows, with up/down arrows) and **Quiet investors** (count + "No qualifying signal found in the sources checked in the past 30 days." copy exactly as configured).
5. **Opportunity chart card** (M3, optional): fit vs score bubbles, one card, collapsed by default.

Anything beyond this goes on other pages. No page has more than ~6 content blocks.

## 4. Typography (font + size scale: this is the "balance")
- Font: **Plus Jakarta Sans** (headings, numbers) + **Inter** (body/table). Load with `next/font`, system-ui fallback. Numbers use `tabular-nums`.
| Role | Size / weight | Use |
|---|---|---|
| Display number | 40–48 / 700 | KPI hero numbers only |
| H1 | 32 / 700 | Greeting, page title |
| H2 | 20 / 600 | Card titles |
| Body | 14–15 / 400 | Descriptions, why-now sentence |
| Table / meta | 13 / 400–500 | Rows, dates, domains |
| Label / chip | 12 / 600, uppercase optional | Status chips, tags |
- Max 3 sizes visible in any one card. Muted text uses `--ink-500`, never lighter than 4.5:1 contrast.
- Importance rule: **score and action chip are the loudest items in a row; everything else is quiet grey.**

## 5. Colour system (creative, logistics-flavoured)
Light theme first (dark theme is optional polish). Define as CSS variables / Tailwind tokens.
```
--bg:        #F3F5F4   /* page, warm cool-grey */
--surface:   #FFFFFF   /* cards */
--ink-900:   #0E1F2B   /* headings, deep harbour navy */
--ink-700:   #2B3F4D
--ink-500:   #5E7280   /* secondary text */
--line:      #E3E8E6   /* borders */
--brand:     #0F766E   /* teal, primary buttons, active nav */
--brand-ink: #0B3B3A   /* deep teal for hero card gradient start */
--accent:    #F59E0B   /* cargo amber, highlights, "You" tag, route line */
--ai:        #7C3AED   /* violet, "AI" tag only */
Action chips:
 REACH OUT NOW  bg #DCFCE7 text #166534 dot #22C55E
 FOLLOW UP NOW  bg #CCFBF1 text #115E59 dot #14B8A6
 MONITOR        bg #DBEAFE text #1E40AF dot #3B82F6
 HOLD           bg #E5E7EB text #374151 dot #9CA3AF   (always show reason)
 DON'T PRIORITIZE bg #F3F4F6 text #6B7280
 INCOMPLETE     bg #FFEDD5 text #9A3412 dot #F97316
```
- Hero KPI card ("Reach out now"): gradient `--brand-ink → --brand`, white text, a faint route-line motif in the corner.
- Use colour for **meaning only** (action status, AI vs You). Everything else is neutral. Max 2 saturated colours per screen region.
- Radius: cards 20px, chips 999px, buttons 12px. Shadows: very soft (`0 1px 2px rgba(14,31,43,.04), 0 8px 24px rgba(14,31,43,.04)`).

## 6. Logistics identity (subtle, never cartoonish)
- **Logo mark (SVG, make it yourself):** a rounded square in `--brand` with a white route glyph: two dots connected by a curved path with an arrow head (reads as "route" and "pipeline"). Wordmark "FreightLoop" + small grey "Pipeline Intelligence".
- **Icons (lucide-react):** `Truck`, `Route`, `Package`, `Warehouse`, `MapPin`, `Ship`, `Container`, `Radar`, `Gauge`. Use `Radar` for "scan/run", `Route` for pipeline, `Truck` for reach-out action, `Package` for evidence, `Gauge` for score.
- **Pipeline as shipment tracking:** on `/vc/[slug]` show the relationship stage as a horizontal tracker: *To reach out → Contacted → In conversation → Meeting → Term sheet / Passed*, with a small truck marker on the current stage and a dotted route line between stages.
- **Route-line motif:** a thin dotted curved line with 2–3 pin dots as background accent in the greeting area and hero card (SVG, 6–8% opacity).
- **Empty states:** simple line illustration (truck on a road / empty container) + a next-action button. Example: "No signals this week. Quiet is not a failure. [View sources checked]".
- **Loading:** skeleton cards; the Run-now button shows a small truck sliding along a progress line.
- Favicon: the route glyph.

## 7. Components (build once, reuse)
`AppShell`, `TopNav`, `IconRail`, `GreetingHeader`, `AiBanner`, `KpiCard` (+hero variant), `ActionChip`, `ScoreRing`, `SourceChip`, `ActionCard`, `ChangeRow`, `StageTracker`, `FactorBar`, `DataTable` (rounded, sticky header, status dots, checkbox optional), `BoardColumn`, `DetailDrawer` (tabs), `EmptyState`, `Skeleton`, `IntegrityBadge`, `TagAI` / `TagYou`.
Use shadcn/ui + Tailwind + lucide-react. Charts: Recharts, one chart style, palette limited to brand/accent/neutrals.

## 8. Table / board rules
- `/pipeline` default = **table**, toggle to **board** (columns = recommended action, with count badges and coloured header chips like the task-board reference). Cards in the board show: VC, score ring, why-now (1 line, truncated), last signal date.
- Table columns visible by default: VC / Firm · Action · Score · Last signal · Contact status · Last contact. Others behind a "Columns" menu. Row click opens the **right-hand drawer**, not a new page, on desktop.
- Sticky filter bar: search, action, status, region. Rest under "More filters".

## 9. Honesty cues (exam-critical, keep them visible but quiet)
- Amber "You" tag on founder-owned fields; violet "AI" tag on AI-derived text.
- Small "Demo data" chip on relationship columns while `is_demo_relationship = true`.
- Integrity badge in the top bar, always visible.
- Quiet vs Incomplete are visually different (grey vs orange) and never both described as "inactive".

## 10. Responsive and accessibility
- Mobile first: single column, KPI cards 2×2, Today's Actions as stacked cards, bottom tab bar, drawer becomes full-screen sheet.
- Tap targets ≥ 44px. Visible focus rings (`--brand`). Do not rely on colour alone: chips always have text.
- Respect `prefers-reduced-motion`.

## 11. Definition of done for the UI (verify in a real browser at 390px and 1440px)
- [ ] Command Centre shows ≤ 4 KPI cards and ≤ 5 action cards above the fold.
- [ ] Only one H1 and one hero card per page.
- [ ] Score and action chip are the most prominent item in every row/card.
- [ ] No horizontal scroll at 390px.
- [ ] Logo, route motif and at least 4 logistics icons visible.
- [ ] Screenshots of `/`, `/pipeline`, `/vc/[slug]` saved to `docs/screenshots/`.
