# AI video editor

Claude edits your Reels and TikToks: it learns your style, adds titles, captions and animations to a rough cut, shows you a storyboard to approve beat by beat, redrafts from your notes, and exports.

## The five steps

| Step | What you do | What you say to Claude |
| --- | --- | --- |
| 1. Folders | Already here: `raw-footage/`, `references/`, `exports/` | |
| 2. Tools | Open this repo in Claude Code | "Be my video editor. Install these tools, test each one, and tell me when you're ready." |
| 3. Style | Put 3-5 reels in `references/` | "Study these and pull the fonts, colors, captions and pacing into one brand sheet." |
| 4. Rough cut | Drop your clip in `raw-footage/` | "Add titles, captions and animations, and show me a storyboard before you export." |
| 5. Approve | Open the dashboard, approve each beat or write a change request, press **Send notes to Claude** | Nothing. The next draft appears in the dashboard. When every beat is approved, press **Approve & export final**. |

The finished video lands in `exports/`.

## Tools

| Tool | What it does |
| --- | --- |
| [Remotion](https://github.com/remotion-dev/remotion) | titles, captions and animation |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | cutting, audio, loudness |
| Whisper (via faster-whisper) | word-timed transcript for captions |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | pulls your own reels into `references/` |
| [HyperFrames](https://github.com/heygen-com/hyperframes) | optional, green screen cutouts only; not wired into the edit yet |

Needs Node 18+, Python 3.9+ and FFmpeg. `npm run setup` installs the rest and tests each tool.
Remotion is free for individuals and companies of up to three people; larger teams need a Remotion licence.

## Commands (Claude runs these for you)

```bash
npm run setup
```

```bash
npm run pull -- <reel url>
```

```bash
npm run study
```

```bash
npm run new -- "raw-footage/my-clip.mov"
```

```bash
npm run draft
```

```bash
npm run dashboard
```

```bash
npm run export
```

The dashboard runs at http://localhost:4818. Footage, drafts and exports stay on your machine and are not committed to git.

## How it fits together

- `brand/brand.json` is the brand sheet. Every render reads it.
- `projects/<name>/storyboard.json` is the plan for one video: beats, on-screen graphics, zooms, cuts.
- `src/` is the Remotion renderer. `src/treatments/index.tsx` holds the graphics (hook title, step header, card, checklist, prompt card, pill, big text, handwriting, sticker, iMessage, comment prompt, image).
- `dashboard/` and `scripts/dashboard.mjs` are the storyboard dashboard. Reviews are saved to `projects/<name>/review/draft-N.json`.
- `.claude/skills/video-editor/SKILL.md` (repo root) tells Claude how to run all of it.
