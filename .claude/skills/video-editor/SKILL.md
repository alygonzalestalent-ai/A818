---
name: video-editor
description: Be the user's AI video editor for Reels and TikToks, working only through CapCut. Use when they say "be my video editor", "install the tools", "review my inspo", "make a brand sheet", "learn my sound kit", put a rough cut in "01 to edit", or ask to "add titles, captions and animations", "show me a storyboard", "make the next draft", or "finish it". Runs video-editor/editor.py, which writes real CapCut desktop projects using CapCut's own fonts, text animations and sounds, plus the storyboard dashboard.
---

# AI video editor (CapCut)

Run everything from `video-editor/` on the computer that has CapCut desktop (the user's Mac). The finished video is always made and exported in CapCut. Every font, text animation and sound on screen must be CapCut's own. Remotion, HyperFrames, FFmpeg, Whisper and yt-dlp are installed as backup tools only: never use them to draw text, add sound, or render the video.

## Folders
The user's working folder is `~/Desktop/claude to edit` (set in `brand/brand.json` under `folders`):

| Folder | Use |
| --- | --- |
| `01 to edit/` | rough cuts, one subfolder per video |
| `02 edited/AGENCY818` and `02 edited/MOM`, each with `POSTED` and `NOT POSTED YET` | where the user saves CapCut exports. Finals only. |
| `03 inspo/` | inspiration videos to learn the style from |

In the repo: `brand/brand.json` (brand sheet), `brand/capcut-kit.json` (sounds and fonts learned from the user's CapCut), `projects/<name>/` (storyboard, transcript, reviews).

## 1. "Be my video editor. Install these tools, test each one, and tell me when you're ready."
`python3 editor.py setup`. Report the table as printed. "Project writer" and "Test project" must be ready. CapCut, the folders and the sound kit show as optional when missing; say plainly which are missing.

## 2. "Review my inspo and make the brand sheet."
1. `python3 editor.py inspo` makes contact sheets for every video in `03 inspo` under `brand/study/<video>/` (`hook.jpg`, `body-NN.jpg`). To add the user's own posts first: `python3 editor.py pull <url>`.
2. Look at every sheet. Note text style (serif, bold sans, handwriting, script), colors, caption style, where titles and cards sit, how often graphics change, and which moments would carry a sound.
3. Write it into `brand/brand.json`, keeping the keys. `fonts` must be CapCut font names from `python3 editor.py list fonts`; pick the closest CapCut match and say which inspo it came from in `sources`. `animations` must be names from `python3 editor.py list animations`.
4. Show the sheet: `python3 editor.py dashboard`, Brand sheet tab.

## 3. "Learn my sound kit."
CapCut library sounds can only be placed if they are already on the computer. Ask the user to make a CapCut project called "Sound Kit", drag in the CapCut sound effects they like, and close it. Then `python3 editor.py kit "Sound Kit"`. Use the printed names exactly in `sfx`. The same command also learns fonts used in that project. Any sound not in the kit is listed for the user to drag in by hand.

## 4. "Add titles, captions and animations, and show me a storyboard."
1. `python3 editor.py start "<clip name>"` (no name lists the clips in `01 to edit`). It writes a CapCut project called "<title> (captions)" holding just the clip.
2. Ask the user to open that project in CapCut, press Captions > Auto captions, and close it. Then `python3 editor.py captions`. This reads CapCut's own captions so you know what is said and when.
   - If it reports the project cannot be read, ask for an `.srt` exported next to the clip, or, as a last resort, run `python3 editor.py captions --listen` (Whisper, for planning only; nothing from it goes on screen and the user then presses Auto captions on the final).
3. Write the beats into `projects/<name>/storyboard.json` (format below). One beat per idea, usually 6-14. Give every beat a different treatment and follow every rule in `brand.json`.
4. `python3 editor.py build` writes "<title> draft N" into CapCut.
5. Start the dashboard in the background if it is not running (`python3 editor.py dashboard`, port 4818) and give the user the link. Tell them to play the draft in CapCut, then review in the dashboard.
6. Run `python3 editor.py wait` in the background. It returns when the user sends their review.

## 5. Next draft
`wait` prints each change request. For each one: change that beat, set its `lastNote` to the user's words and `whatChanged` to one plain sentence. Clear `lastNote` and `whatChanged` on beats you did not touch. Then `python3 editor.py build` (the draft number goes up by itself; each draft is a new CapCut project) and `wait` again. Never restyle an approved beat.

## 6. Finish
When the review says FINISH REQUESTED: `python3 editor.py final`. It writes the approved edit as "<title>" in CapCut and refuses if any beat is unapproved (`--force` only when the user says so). Then tell the user the three things left for them in CapCut: Auto captions (only if the build said none were carried), any sounds listed to drag in, and Export at the recorded resolution and frame rate into `02 edited/<BRAND>/NOT POSTED YET`. Suggest the file name `YYYY-MM-DD topic.mp4`.

## storyboard.json
All times are seconds on the rough cut's own clock (same as `transcript.json`), even when you cut.

```json
{
  "title": "Day 1 starting from zero",
  "cuts": [{ "from": 0.4, "to": 12.1 }, { "from": 13.0, "to": 41.5 }],
  "captions": { "hide": [[0, 3.2]] },
  "beats": [
    {
      "id": "b1", "label": "Hook", "from": 0.4, "to": 3.2,
      "youSay": "exact words from the transcript",
      "visual": "what the viewer sees, one line",
      "animation": "how it moves, one line",
      "zoom": 1,
      "treatments": [{ "type": "hook", "kicker": "day 1", "title": "zero followers", "sub": "starting now" }],
      "sfx": [{ "name": "Pop", "at": 0.4 }],
      "lastNote": "", "whatChanged": ""
    }
  ]
}
```

- `cuts` lists the ranges to KEEP. Leave it as the whole clip when the user trimmed it themselves. Never cut inside a phrase.
- `zoom` is a punch-in for the whole beat (`pacing.punchIn` in the brand sheet). Change it at sentence ends only.
- `sfx.name` is a sound from the kit (`python3 editor.py list sounds`).
- `captions.hide` drops carried captions for ranges where a graphic says the same words.
- Do not edit `project`, `source` or `draft`.

### Treatments
Each has `type`, optional `at` and `until` (default: the beat), `y` (pixels from the top of a 1080x1920 frame) or `position` (`top`, `chest`). Rows and messages take their own `at` so they land on the word. Any treatment can override `intro` and `outro` with a CapCut animation name, and `font` with a brand font key.

| type | fields | becomes in CapCut |
| --- | --- | --- |
| `hook` | `kicker`, `title`, `sub`, `size` | three stacked text layers |
| `header` | `step`, `text` | one text layer, step word in the accent color |
| `card` | `title`, `rows[{text, note, at}]` | text layers with a paper background, one per row |
| `checklist` | `title`, `items[{text, at}]` | same, each row starting with a pink tick |
| `prompt` | `label`, `text` | label plus wrapped text on a paper background |
| `pill` | `text` | rounded label with the Typewriter animation |
| `bigText` | `lines[{text, at, color}]`, `size` | large chest-height lines |
| `hand` | `text`, `tilt` | handwriting font, Letter by letter animation |
| `sticker` | `text`, `bg`, `tilt` | tilted text on a color background |
| `imessage` | `messages[{from: "me" or "them", text, at}]` | blue and grey bubbles |
| `comment` | `word`, `sub` | COMMENT "WORD" plus a typed comment pill |
| `image` | `src` (in the project's `assets/`), `position` (`top` or `full`), `width` | picture layer with Fade in |

## Known limits (say these plainly when relevant)
- Text sizes and positions are estimates until checked in CapCut. If text is too big or small, adjust `capcut.sizePerPx` in the brand sheet and rebuild.
- CapCut's project format is undocumented. If a project does not appear or will not open, report exactly what CapCut shows; do not keep rebuilding blindly.
- Animated word-by-word caption highlights come from CapCut's caption templates, which the user picks in CapCut.

## Checks before showing any draft
- Every graphic starts on a spoken word, not in silence.
- Text is off the face: cards above the head, big text on the chest, captions low.
- No two beats in a row use the same treatment.
- On-screen hook text does not repeat a line said later.
- No em dashes in on-screen text.
