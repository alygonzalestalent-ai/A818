---
name: video-editor
description: Be the user's AI video editor for Reels and TikToks. Use when they say "be my video editor", "install the tools", "study these reels", "make a brand sheet", drop a rough cut into raw-footage, or ask to "add titles, captions and animations", "show me a storyboard", "make the next draft", or "export". Runs the video-editor/ project, which holds the brand sheet, the Remotion renderer and the storyboard dashboard.
---

# AI video editor

Everything lives in `video-editor/`. Run all commands from that folder.

| Folder | What it holds |
| --- | --- |
| `raw-footage/` | rough cuts the user drops in |
| `references/` | 3-5 reels to learn the style from |
| `exports/` | finished videos, named `YYYY-MM-DD title.mp4` |
| `brand/brand.json` | the brand sheet: fonts, colors, captions, pacing, rules |
| `projects/<name>/` | one edit: `source.mp4`, `transcript.json`, `sheets/`, `storyboard.json`, `drafts/`, `review/`, `assets/` |

The five steps below match what the user says. Do the step they ask for; do not run ahead.

## 1. "Be my video editor. Install these tools, test each one, and tell me when you're ready."
Run `npm run setup`. It installs and tests FFmpeg, Remotion, Whisper, yt-dlp and the renderer and prints a ready table. Report that table. HyperFrames is optional (green screen cutouts only).

## 2. "Study these and pull the fonts, colors, captions and pacing into one brand sheet."
1. Reels must be in `references/`. To pull the user's own posts: `npm run pull -- <url> <url>`.
2. `npm run study` writes `brand/study/<reel>/` (hook.jpg, body-NN.jpg, palette, transcript) and `brand/study/summary.json` (cuts per minute, words per minute, palette).
3. Look at every `hook.jpg` and `body-*.jpg`. Note fonts (serif, sans, script, handwriting), text colors, caption style (words at a time, position, highlight), where titles and cards sit, how often graphics change, and cut rhythm.
4. Write it into `brand/brand.json`, keeping the same keys. Fonts must be ones bundled in `src/fonts.ts`; to add one, `npm i @fontsource/<name>` and add it to that file and to `fonts` in the brand sheet.
5. Show the user the sheet: `npm run dashboard`, Brand sheet tab.

## 3. "Add titles, captions and animations, and show me a storyboard before you export."
1. `npm run new -- "raw-footage/<file>" [name]` makes the project: working copy, word-timed transcript, contact sheets, starter storyboard.
2. Read `transcript.json` and look at `sheets/*.jpg`. Find the beats: hook, each point or step, the call to action. Mark retakes (same idea said twice: keep the last).
3. Rewrite `projects/<name>/storyboard.json` (format below). One beat per idea, usually 6-14 beats. Give every beat a different treatment and follow every rule in `brand.json`.
4. Check the busiest moments first: `node scripts/render.mjs still <name> <seconds>` then look at the image.
5. `npm run draft -- <name>` renders the draft and the beat stills.
6. Start the dashboard if it is not running (`npm run dashboard`, port 4818, run in the background) and give the user the link.
7. Run `npm run wait -- <name>` in the background. It returns as soon as the user sends their review.

## 4. Next draft (the review came back)
`npm run wait` prints each change request. For each one:
1. Change that beat in `storyboard.json`.
2. Set the beat's `lastNote` to the user's note and `whatChanged` to one plain sentence on what is different.
3. Clear `lastNote` and `whatChanged` on beats you did not touch this round. Approved beats you did not touch stay approved.
4. `npm run draft -- <name>` (the draft number goes up by itself), then `npm run wait -- <name>` again. The dashboard switches to the new draft on its own.

Only change beats that have a note. Never restyle an approved beat.

## 5. Export
When the review says EXPORT REQUESTED (every beat approved): `npm run export -- <name>`. It renders at the recorded resolution and frame rate, evens the loudness to -14 LUFS and writes `exports/YYYY-MM-DD title.mp4`. It refuses if any beat is not approved; only use `--force` when the user says to export anyway. After exporting, transcribe the export and compare a few word times with the storyboard to confirm sound and picture are in sync.

## storyboard.json
All times are seconds on the rough cut's own clock (the same clock as `transcript.json`), even when you cut. The renderer works out the final timeline.

```json
{
  "title": "Day 1 starting from zero",
  "cuts": [{ "from": 0.4, "to": 12.1 }, { "from": 13.0, "to": 41.5 }],
  "captions": { "emphasis": ["zero"], "hide": [[0, 3.2]] },
  "beats": [
    {
      "id": "b1", "label": "Hook", "from": 0.4, "to": 3.2,
      "youSay": "exact words from the transcript",
      "visual": "what the viewer sees, one line",
      "animation": "how it moves, one line",
      "zoom": 1,
      "treatments": [{ "type": "hook", "kicker": "day 1", "title": "zero followers", "sub": "starting now" }],
      "sfx": [{ "name": "pop-1.mp3", "at": 0.4 }],
      "lastNote": "", "whatChanged": ""
    }
  ]
}
```

- `cuts` is the list of ranges to KEEP. Leave it as the whole clip when the user trimmed it themselves. Never cut inside a phrase.
- `captions.hide` turns captions off for ranges where a graphic says the same words. Captions otherwise follow the brand sheet; override per video with `style` (`phrase` or `word`), `size`, `y`.
- `zoom` is a punch-in for the whole beat (brand `pacing.punchIn`). Change it at sentence ends only.
- `sfx` files go in `public/sfx/`. Real recorded sounds only. None ship with the project.
- Do not edit `project`, `source` or `draft`.

### Treatments
Each has `type`, optional `at` and `until` (default: the beat's start and end), and `y` (pixels from the top on a 1080x1920 frame) or `position` (`top`, `chest`, `center`). Rows and messages take their own `at` so they appear on the word.

| type | fields | use for |
| --- | --- | --- |
| `hook` | `kicker`, `title`, `sub`, `size`, `font` | stacked title lockup on the first frame |
| `header` | `step`, `text` | "STEP 1 SET UP YOUR FOLDERS" strip above the head |
| `card` | `title`, `rows[{text, note, at}]` | white card that grows as items are said |
| `checklist` | `title`, `items[{text, at}]` | rows that tick pink as each is said |
| `prompt` | `label`, `text`, `highlight[]` | "PROMPT · COPY THIS" card |
| `pill` | `text` | typed label with a cursor |
| `bigText` | `lines[{text, at, color}]`, `font`, `size` | chest-height statement |
| `hand` | `text`, `font` (`hand` or `script`), `tilt` | pink handwriting that writes on |
| `sticker` | `text`, `bg`, `tilt` | tilted colour box |
| `imessage` | `messages[{from: "me" or "them", text, at}]` | chat bubbles |
| `comment` | `word`, `sub` | closing "COMMENT WORD" with a typed comment bar |
| `image` | `src` (file in the project's `assets/`), `position` (`top` or `full`), `width` | screenshots and cutaways |

A new kind of graphic is a new component in `src/treatments/index.tsx` plus a line in `onScreenText` in `shared/time.js`.

## Checks before showing any draft
- Every graphic starts on a spoken word, not in silence.
- Text is off the face: cards above the head, big text on the chest, captions low.
- No two beats in a row use the same treatment.
- On-screen hook text does not repeat a line said later.
- No em dashes in on-screen text.
