#!/usr/bin/env bash
# Pull your own Reels / TikToks into references/ so Claude can study your style.
# Usage: npm run pull -- <url> [<url> ...]
cd "$(dirname "$0")/.."
[ $# -gt 0 ] || { echo "Usage: npm run pull -- <reel or tiktok url> [more urls]"; exit 1; }
YT=yt-dlp; command -v yt-dlp >/dev/null || YT="python3 -m yt_dlp"
$YT -P references -o "%(uploader)s-%(id)s.%(ext)s" -f "bv*+ba/b" --merge-output-format mp4 --no-playlist "$@"
