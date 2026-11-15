#!/usr/bin/env bash
# Step 2: install the tools, test each one, and print a ready/not-ready table.
# Safe to run again at any time.
cd "$(dirname "$0")/.."
ok()   { printf "  \033[32mready\033[0m      %-12s %s\n" "$1" "$2"; }
bad()  { printf "  \033[31mNOT READY\033[0m  %-12s %s\n" "$1" "$2"; FAIL=1; }
FAIL=0

echo "Installing..."
[ -d node_modules/remotion ] || npm install --no-audit --no-fund >/dev/null 2>&1
PIP="python3 -m pip install -q --disable-pip-version-check"
python3 -c "import faster_whisper" 2>/dev/null || $PIP faster-whisper >/dev/null 2>&1 || $PIP --user --break-system-packages faster-whisper >/dev/null 2>&1
command -v yt-dlp >/dev/null || $PIP yt-dlp >/dev/null 2>&1 || $PIP --user --break-system-packages yt-dlp >/dev/null 2>&1
if ! command -v ffmpeg >/dev/null; then
  if command -v brew >/dev/null; then brew install ffmpeg >/dev/null 2>&1; fi
fi

# Whisper model: normal download first; if that host is blocked, assemble the same model from npm.
MODEL=.models/whisper-small
if [ ! -f "$MODEL/model.bin" ]; then
  mkdir -p "$MODEL"
  python3 - <<PY 2>/dev/null || true
from faster_whisper.utils import download_model
download_model("small", output_dir="$MODEL")
PY
fi
if [ ! -f "$MODEL/model.bin" ]; then
  TMP=$(mktemp -d)
  ( cd "$TMP" && for i in 0 1 2 3; do npm pack "@skillninja/shortmovie-telop-model-p$i" --silent >/dev/null 2>&1 && tar xzf skillninja-shortmovie-telop-model-p$i-*.tgz && mv package "p$i"; done )
  if [ -f "$TMP/p3/model.bin.part3" ]; then
    cat "$TMP"/p0/model.bin.part0 "$TMP"/p1/model.bin.part1 "$TMP"/p2/model.bin.part2 "$TMP"/p3/model.bin.part3 > "$MODEL/model.bin"
    cp "$TMP"/p0/*.json "$MODEL/"
    WANT=$(awk '{print $1}' "$TMP/p0/model.sha256")
    GOT=$( (sha256sum "$MODEL/model.bin" 2>/dev/null || shasum -a 256 "$MODEL/model.bin") | awk '{print $1}')
    [ "$WANT" = "$GOT" ] || { echo "  whisper model checksum mismatch, removing"; rm -f "$MODEL/model.bin"; }
  fi
  rm -rf "$TMP"
fi

echo
echo "Tool check"
command -v ffmpeg >/dev/null && ok FFmpeg "cutting + audio ($(ffmpeg -version | head -1 | awk '{print $3}'))" || bad FFmpeg "install it: brew install ffmpeg"
node -e "require.resolve('remotion')" 2>/dev/null && ok Remotion "titles + animation ($(node -p "require('remotion/package.json').version"))" || bad Remotion "npm install failed"
if python3 -c "import faster_whisper" 2>/dev/null && [ -f "$MODEL/model.bin" ]; then ok Whisper "auto captions (small model)"; else bad Whisper "faster-whisper or its model is missing"; fi
(command -v yt-dlp >/dev/null || python3 -m yt_dlp --version >/dev/null 2>&1) && ok yt-dlp "pulls your own Reels" || bad yt-dlp "pip install yt-dlp"
if npx --no-install hyperframes --version >/dev/null 2>&1; then ok HyperFrames "green screen cutouts"; else printf "  optional   %-12s %s\n" HyperFrames "not installed (only needed for green screen cutouts): npm i hyperframes"; fi
node scripts/render.mjs check >/dev/null 2>&1 && ok Renderer "test frame rendered" || bad Renderer "run: node scripts/render.mjs check"
echo
[ "$FAIL" = 0 ] && echo "All set. Next: put 3-5 reels in references/ and say \"study these\"." || echo "Fix the NOT READY rows, then run npm run setup again."
exit $FAIL
