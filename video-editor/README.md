# AI video editor (CapCut)

Claude plans your edit and writes it as a real CapCut project: your clip, cuts, punch-ins, titles, cards and sounds, all made with CapCut's own fonts, text animations and sound effects. You watch it in CapCut, approve it beat by beat in the storyboard dashboard, and export from CapCut.

Run it in Claude Code on the Mac that has CapCut desktop.

## Your folders

Claude works from `~/Desktop/claude to edit`:

| Folder | Use |
| --- | --- |
| `01 to edit` | your rough cuts |
| `02 edited` | where you save the CapCut exports |
| `03 inspo` | videos Claude studies for your style |

## What you say

| Step | Say to Claude | What happens |
| --- | --- | --- |
| 1 | "Be my video editor. Install these tools, test each one, and tell me when you're ready." | Installs and tests everything |
| 2 | "Review my inspo and make the brand sheet." | Studies `03 inspo`, writes your brand sheet with CapCut fonts and animations |
| 3 | "Learn my sound kit." | Reads the CapCut sound effects from a CapCut project you name "Sound Kit" |
| 4 | "Add titles, captions and animations, and show me a storyboard." | Writes a draft into CapCut and opens the dashboard |
| 5 | Approve beats or write change requests, then press **Send notes to Claude** | The next draft appears in CapCut |
| 6 | Press **Approve & finish in CapCut** | The final project appears in CapCut; you add Auto captions and export |

## What you do in CapCut

- Press **Captions > Auto captions** once on the "(captions)" project so Claude knows what you say and when.
- Play each draft.
- On the final: pick your caption style, drag in any sounds the dashboard lists, and export.

## Tools

The edit itself uses only CapCut. These are installed as backup and for looking at footage:

| Tool | Used for |
| --- | --- |
| [pycapcut](https://github.com/GuanYixuan/pycapcut) | writes the CapCut project files |
| [FFmpeg](https://github.com/FFmpeg/FFmpeg) | pictures of your clips and inspo for Claude to look at |
| Whisper | backup: lets Claude hear a clip if CapCut's captions cannot be read |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | pulls your own Reels into `03 inspo` |
| [Remotion](https://github.com/remotion-dev/remotion), [HyperFrames](https://github.com/heygen-com/hyperframes) | installed as backup, not used by the CapCut edit |

## Commands (Claude runs these)

```bash
python3 editor.py setup
```

```bash
python3 editor.py inspo
```

```bash
python3 editor.py kit "Sound Kit"
```

```bash
python3 editor.py start "my clip"
```

```bash
python3 editor.py captions
```

```bash
python3 editor.py build
```

```bash
python3 editor.py dashboard
```

```bash
python3 editor.py final
```

The dashboard runs at http://localhost:4818.
