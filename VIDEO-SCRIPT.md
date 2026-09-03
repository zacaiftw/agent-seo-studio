# Demo Video — Script & Storyboard

**Target:** under 3:00 · public YouTube · your voice (or AI narration) over screen capture.
**One flow, told once:** a site owner's agent audits their site, ranks it against two real
competitors, writes the fix, and projects the score climbing — the human watching every
call land on screen.

> **Record against the CURRENT UI**, not the deployed one until prod is redeployed. Prod
> (`agent-seo-studio.vercel.app`) was serving a stale build as of this writing — see
> `SHIP-CHECKLIST.md` step 1. Redeploy first, confirm the landing page shows the green
> "Agent usage — live" panel and "Agent tools live on this page — 10/13", THEN record.

## The demo cast (real, reproducible — verified against the live audit API)

| Role | Site | Score | Why it's in the cast |
|---|---|---|---|
| **Your site** (target) | `a11yproject.com` | **61 → 89** | Real content, genuinely missing JSON-LD — an honest, fixable gap |
| Strong competitor | `css-tricks.com` | **94** | Has the structured data your site lacks — the "one thing they do" |
| Weak competitor | `smashingmagazine.com` | **27** | Also missing schema — makes the market look beatable |

Goal dropdown: **contact**. (Gives the clean "An AI agent can't reach you" hook on tab 1.)

Every number above is real output from the tools — don't fabricate. If you re-record with a
different cast, re-run the numbers first (see `SHIP-CHECKLIST.md`).

---

## Script (spoken) — ~2:40, leaves headroom

Times are cumulative. **Bold** = on-screen text overlay. Record in the numbered clips
below so you can redo one without reshooting everything.

### 0:00–0:12 — Cold open, product already working (NO intro, NO title card)
Start already on the page, site already typed in, mid-action.

> "This is my website. I'm going to ask my AI agent one question —
> *is it ready for the world of AI search?* — and watch it do the whole job itself."

**On-screen: "Ask once. The agent does the rest."**
Click **Check my site**. The four-tab report snaps in.

### 0:12–0:35 — The hook: an agent can't reach you
Report lands on the **"Can an agent book you?"** tab, red: *"An AI agent can't reach you."*

> "Right away it's brutal but honest: an AI agent trying to contact this business
> gets nowhere. No form, no contact path it can act on. That's a customer lost —
> not to Google, to an agent."

**On-screen: "Not a guess — measured from the real page."**

### 0:35–1:05 — Let the agent drive (the WebMCP centerpiece)
Switch to your agent (ChatGPT in-app browser / Chrome WebMCP). Paste the prompt.

> "Now the part that matters. I don't click through five screens — I just ask my agent."

**Paste (don't type live):**
> *"Audit a11yproject.com, compare it against css-tricks.com and smashingmagazine.com,
> rank us for AI-search readiness, then generate the fixes and show me the projected score."*

As it runs, cut to the page: the green **"Agent usage — live"** panel ticks up, and cards
land in the workspace. Point the cursor at the counter.

> "Every one of those is a real WebMCP tool call — `audit_website`, `compare_sites`,
> `generate_fixes` — my agent calling named actions this page registered. The page is
> counting them live. That number is the whole point: agents are actually *using* the site."

**On-screen: "13 WebMCP tools · your agent calls them by name"**

### 1:05–1:30 — The ranking (competitors on screen)
Cut to the **"Your rank"** tab / the agent's ranked answer.

> "It ranked all three. The leader, css-tricks, scores 94 — because it ships structured
> data an AI can read. Mine's mid-pack. The gap isn't vague advice — it's one specific,
> machine-readable thing they have and I don't."

**On-screen: "css-tricks 94 · you 61 · the gap is structured data"**

### 1:30–2:05 — The repair (the part chatbots can't do)
Cut to the generated JSON-LD + meta, and the **61 → 89** before/after.

> "And here's what makes this more than a critique. The agent didn't just tell me what's
> wrong — it *wrote the fix*. Real JSON-LD, built from my page's actual content, ready to
> paste. And it projects the score: sixty-one to eighty-nine if I ship it."

**On-screen: "It doesn't grade you. It fixes you. 61 → 89"**
Hover the **copy** button on the JSON-LD block.

### 2:05–2:30 — Why this needed WebMCP
Cut back to the live-tools panel / usage counter.

> "A chatbot couldn't do this. The browser can't fetch these sites cross-origin — CORS
> blocks it. And the fixes are grounded in HTML only the page's own server could read.
> WebMCP is what lets my agent reach across all of it and finish the job, while I watch
> every step."

**On-screen: "audit → compare → fix → prove — one turn, one workspace"**

### 2:30–2:40 — Close
> "Agent SEO Studio. Your agent audits, ranks, and repairs your site for AI search —
> and the site counts every call, because agents are the new customers."

**On-screen: URL + "Built for the WebMCP Challenge"**

---

## Clip list (record these separately)

Keep each ≤ ~20s of raw footage; the edit trims to the beats above.

1. **Cold open** — page pre-loaded, `a11yproject.com` already in the field, goal = contact. Click Check my site. Capture the report snapping in. *(covers 0:00–0:35)*
2. **Agent prompt** — your agent surface; paste the prompt; let it run. Capture the agent's tool-call trace. *(0:35–1:05, 2:05–2:30)*
3. **Usage panel B-roll** — screen-record the page's green "Agent usage — live" panel while the agent runs, so the counter visibly climbs. *(cutaway for 0:35–1:05)*
4. **Rank tab** — the ranked leaderboard / the agent's ranked answer with the three scores. *(1:05–1:30)*
5. **Fix + before/after** — the generated JSON-LD block, the 61 → 89 panel, hover copy. *(1:30–2:05)*
6. **Close card** — final frame with URL. *(2:30–2:40)*

### Recording hygiene (from the hackathon brief)
- Start already logged in / already on the page. No sign-up, no loading screens.
- Paste long text; never type live.
- Cut every load/wait — the audits take a few seconds; jump-cut them out.
- One strong example. Don't repeat a feature.
- Use the on-screen text overlays above to make points fast instead of narrating them.
- Save team story / inspiration for the written description, not the video.

## Fastest path if you don't want to record your voice
Narration script above is self-contained — feed it to any TTS (or the brief explicitly
allows AI narration) and lay it under the clips. The `edit.sh` pipeline in this repo will
concatenate your clips, cut dead air, burn the on-screen overlays, and enforce < 3:00.
