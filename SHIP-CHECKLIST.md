# Ship Checklist — final 2 days

> # 🧊 FREEZE AT 1:00 PM PT, THURSDAY SEP 3
> **Once the Submission Period ends, NOTHING can change** — not the repo, not the
> video, not the live site. Official rule: *"you may not make any changes or
> alterations to your Submission,"* and the project *"must function as depicted in
> the video"* through the end of judging (**Sep 21, 5:00 PM PT**).
>
> Concretely, after the deadline:
> - **Do NOT** `git push`, redeploy prod, `vercel alias set`, or re-upload the video.
> - **Do NOT** take the site offline or make the repo private.
> - **Do NOT** let any agent (including me) touch this repo or prod. If you ask me
>   to "just fix one thing" after 1 PM PT Thursday, the answer is **no** — remind me.
> - Keep prod live, public, and on the exact deployment the video shows.
>
> **Submit ~3 hours early** (buffer for YouTube processing + Devpost). Confirm the
> project is tagged **Submitted** (green), not a draft, on the My Projects page.

Ordered by what blocks what. Do 1 first; it gates the video and the submission.

## 1. Redeploy prod (BLOCKER) 🚨
The deployed site at `agent-seo-studio.vercel.app` was serving a **stale build**:
old two-line form, no "Agent usage — live" panel, no "Agent tools live on this page"
strip. `main` is fully pushed but prod didn't pick it up. Everything (video +
submission) points at prod, so fix this first.

```bash
# from the repo root, deploy the current main to production:
vercel --prod
```
(You're already linked — `.vercel/project.json` has the project.) If it complains
about auth, run `vercel login` first.

**Verify after deploy** — open the live URL and confirm ALL of:
- top-right badge reads **● WebMCP connected** (in a WebMCP browser) or **○ WebMCP off** otherwise
- the green **"Agent usage — live · 0 agent calls"** panel is visible
- the **"Agent tools live on this page — 10/13 registered"** strip is visible
- the check form is **one line** (site + "Check my site") with a
  "Customers come here to [ book an appointment ]" goal line under it
- the advanced toggle reads **"Generate ready-to-ship fixes (agent writes your JSON-LD + meta)"**

If the form still shows the old two-line competitors input, the deploy didn't take —
check the Vercel dashboard for a failed build.

## 2. Smoke-test the demo flow (against fresh prod)
Confirm the exact video cast still produces the numbers in `VIDEO-SCRIPT.md`:

```bash
# single-site before/after (expect ~61 -> 89):
curl -s -X POST https://agent-seo-studio.vercel.app/api/audit \
  -H 'Content-Type: application/json' \
  -d '{"url":"a11yproject.com","action":"generate"}' | node -e \
  'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log("before",j.before?.readiness,"-> projected",j.projected?.readiness)})'

# competitors (expect css-tricks ~94, smashingmagazine ~27):
for s in css-tricks.com smashingmagazine.com; do
  curl -s -X POST https://agent-seo-studio.vercel.app/api/audit \
    -H 'Content-Type: application/json' -d "{\"url\":\"$s\"}" | node -e \
    'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(process.argv[1],j.score?.readiness)})' "$s"
done
```
Scores drift a little as the sites change — if a number moved, update
`VIDEO-SCRIPT.md`'s cast table before recording so narration matches the screen.

## 3. Record the video
Follow `VIDEO-SCRIPT.md`. Record the numbered clips into a `./clips` folder
(`01-coldopen.mov`, `02-agent.mov`, …). Start already on the page, paste all long
text, jump-cut every load.

## 4. Assemble
```bash
./edit.sh                         # or: ./edit.sh --narration voice.m4a
```
Produces `demo.mp4`, under 3:00, overlays burned in. (Needs ffmpeg — already
installed here.)

## 5. Upload + link
- Upload `demo.mp4` to YouTube, visibility **Public**, confirm audio is present.
- Paste the link into `SUBMISSION.md`'s header (`**Video:** …`).

## 6. Submit
- Copy the four answers + implementation section from `SUBMISSION.md` into the
  Devpost form.
- Final gut check against the four judging criteria (WebMCP Leverage / Execution /
  Potential Impact / Creativity) — each is weighted equally.

---
**Deadline:** Thursday, September 3rd, 1:00 PM PT. Don't cut it close on the upload —
YouTube processing + Devpost form take longer than you expect.
