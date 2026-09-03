#!/usr/bin/env bash
# edit.sh — assemble the demo video from raw clips.
#
# Concatenates your numbered clips, trims leading/trailing dead air, burns the
# on-screen text overlays from VIDEO-SCRIPT.md, optionally lays a narration track
# under everything, and hard-enforces the < 3:00 hackathon limit.
#
# USAGE
#   ./edit.sh                       # clips from ./clips, no external narration
#   ./edit.sh --narration voice.m4a # lay voice.m4a under the video
#   ./edit.sh --clips ./raw --out demo.mp4
#
# INPUT
#   A clips dir with files that sort in play order. Name them so a plain sort is
#   the timeline, e.g.  01-coldopen.mov  02-agent.mov  03-usage.mov ...
#   (matches the clip list in VIDEO-SCRIPT.md).
#
# REQUIRES ffmpeg + ffprobe on PATH.  (macOS: brew install ffmpeg)

set -euo pipefail

CLIPS_DIR="./clips"
OUT="demo.mp4"
NARRATION=""
MAX_SECONDS=178   # 2:58 — a hair under the 3:00 hard cap
FONT=""           # auto-detected below

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clips)     CLIPS_DIR="$2"; shift 2 ;;
    --out)       OUT="$2"; shift 2 ;;
    --narration) NARRATION="$2"; shift 2 ;;
    --max)       MAX_SECONDS="$2"; shift 2 ;;
    -h|--help)   grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

command -v ffmpeg  >/dev/null || { echo "ffmpeg not found. brew install ffmpeg" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe not found. brew install ffmpeg" >&2; exit 1; }

# A font file for drawtext. Try common macOS/Linux paths; fall back to none.
for f in \
  /System/Library/Fonts/Supplemental/Arial.ttf \
  /System/Library/Fonts/Helvetica.ttc \
  /usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
  /Library/Fonts/Arial.ttf ; do
  [[ -f "$f" ]] && FONT="$f" && break
done
[[ -z "$FONT" ]] && echo "note: no system font found; overlays will be skipped." >&2

shopt -s nullglob
mapfile -t CLIPS < <(printf '%s\n' "$CLIPS_DIR"/*.{mov,mp4,mkv,MOV,MP4,webm} 2>/dev/null | sort)
shopt -u nullglob
[[ ${#CLIPS[@]} -eq 0 ]] && { echo "no clips found in $CLIPS_DIR (want 01-*.mov, 02-*.mov …)" >&2; exit 1; }
echo "found ${#CLIPS[@]} clip(s):"; printf '  %s\n' "${CLIPS[@]}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# --- 1. Normalize each clip: trim dead air (silenceremove on audio-driven cut),
#        standardize to 1920x1080/30fps/stereo so concat is clean. -------------
NORM=()
i=0
for c in "${CLIPS[@]}"; do
  out="$WORK/norm_$(printf '%02d' "$i").mp4"
  # silenceremove trims long silent gaps front/back; scale+pad keeps aspect;
  # setsar keeps concat happy. If a clip has no audio, add a silent track.
  ffmpeg -y -loglevel error -i "$c" \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p" \
    -af "silenceremove=start_periods=1:start_duration=0.3:start_threshold=-40dB:stop_periods=-1:stop_duration=0.6:stop_threshold=-40dB" \
    -c:v libx264 -preset veryfast -crf 20 -c:a aac -ar 48000 -ac 2 \
    "$out" 2>/dev/null || \
  ffmpeg -y -loglevel error -i "$c" -f lavfi -t 0.1 -i anullsrc=r=48000:cl=stereo \
    -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p" \
    -shortest -c:v libx264 -preset veryfast -crf 20 -c:a aac -ar 48000 -ac 2 "$out"
  NORM+=("$out"); i=$((i+1))
done

# --- 2. Concatenate. -----------------------------------------------------------
LIST="$WORK/list.txt"; : > "$LIST"
for n in "${NORM[@]}"; do echo "file '$n'" >> "$LIST"; done
CONCAT="$WORK/concat.mp4"
ffmpeg -y -loglevel error -f concat -safe 0 -i "$LIST" -c copy "$CONCAT"

DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CONCAT" | cut -d. -f1)"
echo "concatenated duration: ${DUR}s (cap ${MAX_SECONDS}s)"

# --- 3. Optional narration track. ---------------------------------------------
STAGE="$CONCAT"
if [[ -n "$NARRATION" ]]; then
  [[ -f "$NARRATION" ]] || { echo "narration file not found: $NARRATION" >&2; exit 1; }
  WITHVO="$WORK/withvo.mp4"
  # Replace clip audio with narration; keep whichever is shorter so nothing hangs.
  ffmpeg -y -loglevel error -i "$CONCAT" -i "$NARRATION" \
    -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest "$WITHVO"
  STAGE="$WITHVO"
fi

# --- 4. Enforce the hard cap. If over, nudge speed up to fit (max 1.25x), then
#        hard-trim as a last resort so the file is ALWAYS legal. ----------------
DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$STAGE" | cut -d. -f1)"
CAPPED="$STAGE"
if (( DUR > MAX_SECONDS )); then
  ratio=$(awk -v d="$DUR" -v m="$MAX_SECONDS" 'BEGIN{r=d/m; if(r>1.25)r=1.25; printf "%.4f", r}')
  echo "over cap; speeding video/audio by ${ratio}x"
  SPED="$WORK/sped.mp4"
  ffmpeg -y -loglevel error -i "$STAGE" \
    -filter_complex "[0:v]setpts=PTS/${ratio}[v];[0:a]atempo=${ratio}[a]" \
    -map "[v]" -map "[a]" -c:v libx264 -preset veryfast -crf 20 -c:a aac "$SPED"
  CAPPED="$SPED"
  NEW="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$CAPPED" | cut -d. -f1)"
  if (( NEW > MAX_SECONDS )); then
    echo "still over; hard-trimming to ${MAX_SECONDS}s"
    TRIM="$WORK/trim.mp4"
    ffmpeg -y -loglevel error -i "$CAPPED" -t "$MAX_SECONDS" -c copy "$TRIM"
    CAPPED="$TRIM"
  fi
fi

# --- 5. Final encode (overlays optional). --------------------------------------
# The on-screen text overlays from VIDEO-SCRIPT.md are timed to the default cut.
# Edit the array to match your final timing; each entry is: START END "TEXT".
# If timing drifts after speed-up, just clear this array and add captions in your
# editor — the video is still complete without them.
OVERLAYS=(
  "0.0 4.0 Ask once. The agent does the rest."
  "12.0 18.0 Not a guess — measured from the real page."
  "40.0 48.0 13 WebMCP tools · your agent calls them by name"
  "66.0 74.0 css-tricks 94 · you 61 · the gap is structured data"
  "92.0 100.0 It doesn't grade you. It fixes you.  61 -> 89"
  "126.0 134.0 audit -> compare -> fix -> prove — one turn"
)

if [[ -n "$FONT" ]]; then
  filter=""
  for o in "${OVERLAYS[@]}"; do
    start="${o%% *}"; rest="${o#* }"; end="${rest%% *}"; txt="${rest#* }"
    esc="${txt//:/\\:}"; esc="${esc//\'/}"
    filter+="drawtext=fontfile='${FONT}':text='${esc}':fontcolor=white:fontsize=44:box=1:boxcolor=black@0.55:boxborderw=18:x=(w-tw)/2:y=h-160:enable='between(t,${start},${end})',"
  done
  filter="${filter%,}"
  ffmpeg -y -loglevel error -i "$CAPPED" -vf "$filter" \
    -c:v libx264 -preset medium -crf 19 -c:a aac -movflags +faststart "$OUT"
else
  ffmpeg -y -loglevel error -i "$CAPPED" -c:v libx264 -preset medium -crf 19 \
    -c:a aac -movflags +faststart "$OUT"
fi

FINAL="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT" | cut -d. -f1)"
echo ""
echo "✅  wrote $OUT  (${FINAL}s)"
(( FINAL <= 180 )) && echo "✅  under the 3:00 cap" || echo "⚠️  STILL over 3:00 — trim a clip and re-run"
echo "next: upload to YouTube as Public, paste the link into SUBMISSION.md"
