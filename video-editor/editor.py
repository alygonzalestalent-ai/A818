#!/usr/bin/env python3
"""AI video editor for CapCut.

Claude plans the edit; this script writes it as a real CapCut desktop project, so every
font, text animation and sound in the video is CapCut's own. You watch, caption and export in CapCut.

  python3 editor.py setup                       check what is ready on this computer
  python3 editor.py list fonts|animations|sounds
  python3 editor.py kit "<CapCut project>"      learn sounds and fonts from one of your CapCut projects
  python3 editor.py pull <url> [<url>]          download your own Reels into "03 inspo"
  python3 editor.py inspo                       take contact sheets of every video in "03 inspo"
  python3 editor.py start ["<clip>"] [name]     a clip from "01 to edit" (no clip: list them)
  python3 editor.py captions [name]             read CapCut's auto captions (what you say, and when)
  python3 editor.py build [name]                write "<title> draft N" into CapCut
  python3 editor.py final [name]                write the approved edit as "<title>" into CapCut
  python3 editor.py dashboard                   storyboard dashboard, http://localhost:4818
  python3 editor.py wait [name]                 block until the review is sent from the dashboard
"""
import copy, json, os, re, shutil, subprocess, sys, time, uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECTS = ROOT / "projects"
US = 1_000_000


# ───────────────────────── small helpers ─────────────────────────

def read_json(p, default=None):
    try:
        return json.loads(Path(p).read_text(encoding="utf-8"))
    except Exception:
        if default is not None or not Path(p).exists():
            return default
        raise


def write_json(p, data):
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(p.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(p)


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", re.sub(r"\.[A-Za-z0-9]+$", "", s).lower()).strip("-") or "video"


def die(msg, code=1):
    print(msg, file=sys.stderr)
    sys.exit(code)


def brand():
    return read_json(ROOT / "brand" / "brand.json", {})


def kit():
    return read_json(ROOT / "brand" / "capcut-kit.json", {"sounds": {}, "fonts": {}, "animations": []})


VIDEO_EXT = (".mp4", ".mov", ".m4v", ".webm")


def folders():
    """The working folders. Default: the "claude to edit" folder on the Desktop."""
    f = brand().get("folders") or {}
    ws = Path(os.environ.get("CLAUDE_TO_EDIT") or f.get("workspace") or "~/Desktop/claude to edit").expanduser()
    return {"workspace": ws, "toEdit": ws / f.get("toEdit", "01 to edit"), "edited": ws / f.get("edited", "02 edited"),
            "inspo": ws / f.get("inspo", "03 inspo")}


def find_clip(arg):
    """A rough cut by path, or by name anywhere inside the "to edit" folder."""
    p = Path(arg).expanduser()
    if p.is_file():
        return p.resolve()
    base = folders()["toEdit"]
    if base.is_dir():
        hits = [f for f in base.rglob("*") if f.suffix.lower() in VIDEO_EXT and arg.lower() in str(f.relative_to(base)).lower()]
        if len(hits) == 1:
            return hits[0]
        if hits:
            die("More than one clip matches:\n" + "\n".join(f"  {h.relative_to(base)}" for h in hits))
    return None


def list_projects():
    if not PROJECTS.exists():
        return []
    ps = [d for d in PROJECTS.iterdir() if (d / "storyboard.json").exists()]
    return [d.name for d in sorted(ps, key=lambda d: (d / "storyboard.json").stat().st_mtime, reverse=True)]


def pick_project(arg=None):
    if arg:
        if not (PROJECTS / arg / "storyboard.json").exists():
            die(f'No project "{arg}" in projects/')
        return arg
    ps = list_projects()
    if not ps:
        die('No projects yet. Run: python3 editor.py start "<clip name>"')
    return ps[0]


def review_file(slug, draft):
    return PROJECTS / slug / "review" / f"draft-{draft}.json"


def fmt(t):
    return f"{int(t // 60)}:{t % 60:04.1f}"


def need_pycapcut():
    try:
        import pycapcut
        return pycapcut
    except ImportError:
        die("The CapCut project writer is not installed. Run: python3 editor.py setup")


# ───────────────────────── CapCut on this computer ─────────────────────────

def capcut_dir():
    """Folder where CapCut desktop keeps its projects, or None when CapCut is not on this computer."""
    cands = [os.environ.get("CAPCUT_PROJECTS"), (brand().get("capcut") or {}).get("projectsDir")]
    home = Path.home()
    cands += [
        home / "Movies/CapCut/User Data/Projects/com.lveditor.draft",
        Path(os.environ.get("LOCALAPPDATA", "")) / "CapCut/User Data/Projects/com.lveditor.draft" if os.environ.get("LOCALAPPDATA") else None,
    ]
    for c in cands:
        if c and Path(c).expanduser().is_dir():
            return Path(c).expanduser()
    return None


def out_dir():
    """Where new CapCut projects are written: CapCut's own folder, else exports/capcut-projects."""
    d = capcut_dir()
    if d:
        return d, True
    d = ROOT / "exports" / "capcut-projects"
    d.mkdir(parents=True, exist_ok=True)
    return d, False


def load_capcut_project(name):
    """Read a CapCut project's timeline file. Returns (data, folder)."""
    for base in [capcut_dir(), ROOT / "exports" / "capcut-projects"]:
        if not base:
            continue
        folder = base / name
        for fn in ("draft_info.json", "draft_content.json"):
            f = folder / fn
            if f.exists():
                try:
                    return json.loads(f.read_text(encoding="utf-8")), folder
                except Exception:
                    die(f'CapCut project "{name}" was found but its timeline file cannot be read. '
                        "This CapCut version encrypts saved projects, so Claude cannot read captions or sounds from it.")
    return None, None


# ───────────────────────── timeline maths (source clock -> edited clock) ─────────────────────────

def norm_cuts(sb):
    dur, fps = sb["source"]["duration"], sb["source"]["fps"]
    cuts = sb.get("cuts") or [{"from": 0, "to": dur}]
    out, res = 0, []
    for c in sorted(cuts, key=lambda c: c["from"]):
        f0, f1 = round(max(0, c["from"]) * fps), round(min(dur, c["to"]) * fps)
        if f1 > f0:
            res.append({"from": f0 / fps, "to": f1 / fps, "out": out / fps, "frames": f1 - f0})
            out += f1 - f0
    return res


def total(cuts, fps):
    return sum(c["frames"] for c in cuts) / fps


def to_out(cuts, fps, t):
    for c in cuts:
        if t < c["from"]:
            return c["out"]
        if t <= c["to"]:
            return c["out"] + (t - c["from"])
    return total(cuts, fps)


def kept(cuts, t):
    return any(c["from"] <= t < c["to"] for c in cuts)


# ───────────────────────── brand lookups: CapCut fonts, animations, sounds ─────────────────────────

# Friendly names for CapCut's free text animations. The names in CapCut's own panel can differ
# slightly by app language and version; `list animations` prints every one this script can place.
ANIMS = {
    "in": {"fadeIn": "渐显", "zoomIn": "放大", "popUp": "弹出", "bounceUp": "向上弹入", "slideUp": "向上滑动",
           "typewriter": "打字机", "letterByLetter": "逐字", "waveIn": "波浪弹入", "blurIn": "模糊"},
    "out": {"fadeOut": "渐隐", "zoomOut": "缩小", "slideDown": "向下滑动", "typewriterOut": "打字机", "blurOut": "模糊"},
    "loop": {"wave": "波浪", "wobble": "晃动"},
}
DEFAULT_FONTS = {"serif": "Prata-Regular", "italic": "PlayfairDisplay-Italic", "sans": "Poppins-Bold",
                 "hand": "ReenieBeanie-Regular", "script": "Italianno", "round": "FredokaOne-Regular", "condensed": "Anton"}


def find_font(cc, name):
    """A CapCut font by its name in CapCut's font list. Returns (FontType or None, raw kit font or None)."""
    if not name:
        return None, None
    key = re.sub(r"[^a-z0-9]", "", name.lower())
    for f in cc.FontType:
        if key in (re.sub(r"[^a-z0-9]", "", f.name.lower()), re.sub(r"[^a-z0-9]", "", f.value.name.lower())):
            return f, None
    k = kit().get("fonts", {})
    for n, raw in k.items():
        if re.sub(r"[^a-z0-9]", "", n.lower()) == key:
            return None, raw
    die(f'"{name}" is not a CapCut font this script knows. Run: python3 editor.py list fonts')


def find_anim(cc, kind, name):
    if not name or name == "none":
        return None
    enum = {"in": cc.TextIntro, "out": cc.TextOutro, "loop": cc.TextLoopAnim}[kind]
    raw = ANIMS[kind].get(name, name)
    for a in enum:
        if a.name == raw or a.value.title == raw:
            return a
    die(f'"{name}" is not a CapCut text {kind} animation this script knows. Run: python3 editor.py list animations')


def rgb(hexcolor):
    h = hexcolor.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def color(b, c, fallback):
    cols = b.get("colors", {})
    return cols.get(c, c) if c else cols.get(fallback, fallback)


# ───────────────────────── storyboard -> CapCut text layers ─────────────────────────

def layers_for(beat, t, b):
    """One treatment becomes one or more CapCut text layers (dicts). Sizes and y are on a 1080x1920 frame."""
    L = (b.get("layout") or {})
    at, until = t.get("at", beat["from"]), t.get("until", beat["to"])
    typ = t["type"]
    top = t.get("y", L.get("chestY", 1250) if t.get("position") == "chest" else L.get("topY", 150))
    paper, ink = color(b, None, "paper"), color(b, None, "ink")
    out = []

    def add(text, px, y, font="sans", col="#FFFFFF", at_=None, intro="fadeIn", bg=None, **kw):
        out.append({"text": text, "px": px, "y": y, "font": t.get("font", font) if kw.pop("own_font", False) else font,
                    "color": col, "at": at if at_ is None else at_, "until": until, "intro": t.get("intro", intro),
                    "outro": t.get("outro", "fadeOut"), "bg": bg, **kw})

    if typ == "hook":
        y = t.get("y", 300)
        if t.get("kicker"):
            add(t["kicker"].upper(), 44, y + 26, "sans")
        size = t.get("size", 150)
        add(t["title"], size, y + 70 + size * 0.5, t.get("font", "italic"), color(b, t.get("color"), "cream"), intro=t.get("intro", "zoomIn"))
        if t.get("sub"):
            add(t["sub"].upper(), 40, y + 110 + size, "sans")
    elif typ == "header":
        step = (t.get("step") or "").upper()
        text = (step + " " if step else "") + (t.get("text") or "").upper()
        add(text, t.get("size", 46), top + 28, "sans", ranges=[(0, len(step), color(b, t.get("color"), "cream"))] if step else None)
    elif typ in ("card", "checklist"):
        rows = t.get("rows") or t.get("items") or []
        px = t.get("size", 40)
        y = top + 40
        if t.get("title"):
            add(t["title"].upper(), 34, y, "sans", ink, bg=paper, intro="popUp")
            y += 34 * 2.1
        for r in rows:
            text = ("✓ " if typ == "checklist" else "") + r["text"] + (f"  ({r['note']})" if r.get("note") else "")
            add(text, px, y, "sans", ink, at_=r.get("at", at), bg=paper, intro="bounceUp",
                ranges=[(0, 1, color(b, None, "pink"))] if typ == "checklist" else None)
            y += px * 2.1
    elif typ == "prompt":
        add((t.get("label") or "PROMPT · COPY THIS").upper(), 24, top + 20, "sans", color(b, None, "pink"), bg=paper)
        add(t["text"], t.get("size", 36), top + 150, "sans", ink, bg=paper, wrap=True, intro="slideUp")
    elif typ == "pill":
        add(t["text"], t.get("size", 44), top + 36, "sans", color(b, t.get("color"), "ink"), bg=color(b, t.get("bg"), "white"), intro="typewriter", radius=1.0)
    elif typ == "bigText":
        lines = [l if isinstance(l, dict) else {"text": l} for l in (t.get("lines") or [t.get("text")])]
        px = t.get("size", 84)
        y0 = t.get("y", L.get("chestY", 1250)) - (len(lines) - 1) * px * 0.6
        for i, l in enumerate(lines):
            txt = l["text"] if t.get("uppercase") is False else l["text"].upper()
            add(txt, px, y0 + i * px * 1.2, t.get("font", "sans"), color(b, l.get("color") or t.get("color"), "cream"), at_=l.get("at", at), intro="popUp")
    elif typ == "hand":
        add(t["text"], t.get("size", 120), t.get("y", L.get("chestY", 1250)), t.get("font", "hand"), color(b, t.get("color"), "pink"),
            intro="letterByLetter", rotation=t.get("tilt", -3))
    elif typ == "sticker":
        add(t["text"], t.get("size", 56), top + 40, "sans", color(b, t.get("color"), "white"), bg=color(b, t.get("bg"), "pink"),
            intro="popUp", rotation=t.get("tilt", -4))
    elif typ == "imessage":
        y = top + 40
        px = t.get("size", 40)
        for m in t.get("messages", []):
            me = m.get("from") != "them"
            lines = max(1, -(-len(m["text"]) // 30))
            add(m["text"], px, y + (lines - 1) * px * 0.6, "sans", "#FFFFFF" if me else "#111111", at_=m.get("at", at),
                bg="#0B84FE" if me else "#E9E9EB", intro="bounceUp", x=0.16 if me else -0.16, wrap=True, wrap_width=0.6, radius=0.6)
            y += lines * px * 1.25 + px * 1.3
    elif typ == "comment":
        w = t["word"].upper()
        add(f'COMMENT "{w}"', 50, top + 30, "sans", ranges=[(8, 10 + len(w), color(b, None, "cream"))])
        add(w, 40, top + 130, "sans", ink, bg="#FFFFFF", intro="typewriter", radius=1.0)
        if t.get("sub"):
            add(t["sub"], 64, top + 240, "hand", color(b, None, "pink"), intro="letterByLetter")
    elif typ == "image":
        return []  # images are placed as picture layers, see build()
    else:
        add(t.get("text", ""), t.get("size", 60), top + 40)
    for layer in out:
        layer["sound"] = None
    return out


def on_screen_text(beat, b):
    out = []
    for t in beat.get("treatments", []):
        if t["type"] == "image":
            out.append(f"[image] {t['src']}")
        out += [l["text"] for l in layers_for(beat, t, b)]
    return out


def plan_sounds(sb):
    """Every sound cue in the storyboard, on the edited clock."""
    cuts, fps = norm_cuts(sb), sb["source"]["fps"]
    cues = []
    for beat in sb["beats"]:
        for s in beat.get("sfx", []):
            cues.append({"beat": beat["id"], "label": beat.get("label", beat["id"]), "name": s["name"],
                         "t": to_out(cuts, fps, s.get("at", beat["from"])), "volume": s.get("volume", 0.5)})
    return cues


# ───────────────────────── writing the CapCut project ─────────────────────────

def build(slug, final=False):
    cc = need_pycapcut()
    b, k = brand(), kit()
    pdir = PROJECTS / slug
    sb = read_json(pdir / "storyboard.json")
    src = sb["source"]
    if not Path(src["path"]).exists():
        die(f"The rough cut has moved or been deleted: {src['path']}")
    fps = src["fps"]
    cuts = norm_cuts(sb)
    O = lambda t: to_out(cuts, fps, t)
    snap = lambda t: round(t * fps) * US // fps  # whole frames, in CapCut's microseconds

    if final:
        review = read_json(review_file(slug, sb["draft"]), {"beats": {}})
        todo = [x.get("label", x["id"]) for x in sb["beats"] if (review["beats"].get(x["id"]) or {}).get("status") != "approved"]
        if todo and "--force" not in sys.argv:
            die(f"Not finishing: {len(todo)} beat(s) are not approved yet ({', '.join(todo)}).\n"
                "Approve them in the dashboard, or run again with --force.", 2)
        name = sb["title"]
    else:
        prev = read_json(review_file(slug, sb["draft"]))
        if sb["draft"] == 0 or (prev and prev.get("submittedAt")):
            sb["draft"] += 1
            write_json(pdir / "storyboard.json", sb)
        name = f"{sb['title']} draft {sb['draft']}"

    base, in_capcut = out_dir()
    folder = base / name
    if folder.exists():
        shutil.rmtree(folder)
    script = cc.DraftFolder(str(base)).create_draft(name, src["width"], src["height"], fps, allow_replace=True)

    # 1. Your clip: one piece per kept range, split at beat edges so each beat can have its own punch-in
    script.add_track(cc.TrackType.video, "footage")
    mat = cc.VideoMaterial(src["path"])
    edges = sorted({x["from"] for x in sb["beats"]} | {x["to"] for x in sb["beats"]})
    oy = sb.get("zoomOriginY", 38) / 100
    for c in cuts:
        pts = [c["from"]] + [e for e in edges if c["from"] < e < c["to"]] + [c["to"]]
        for a, z in zip(pts, pts[1:]):
            s0, s1 = snap(a), snap(z)
            if s1 <= s0:
                continue
            t0 = snap(O(a))
            beat = next((x for x in sb["beats"] if x["from"] <= (a + z) / 2 < x["to"]), None)
            zoom = (beat or {}).get("zoom", 1) or 1
            clip = cc.ClipSettings(scale_x=zoom, scale_y=zoom, transform_y=-(zoom - 1) * (0.5 - oy) * 2)
            script.add_segment(cc.VideoSegment(mat, cc.Timerange(t0, s1 - s0), source_timerange=cc.Timerange(s0, s1 - s0), clip_settings=clip), "footage")

    # 2. Text layers. CapCut cannot overlap two clips on one track, so layers are spread over as many tracks as needed.
    layers = []
    for beat in sb["beats"]:
        for t in beat.get("treatments", []):
            for layer in layers_for(beat, t, b):
                layer["t0"], layer["t1"] = snap(O(layer["at"])), snap(O(layer["until"]))
                if layer["t1"] - layer["t0"] >= 3 * US // fps and layer["text"]:
                    layers.append(layer)

    # carried captions (only when the words came from CapCut's own auto captions or an .srt)
    tr = read_json(pdir / "transcript.json", {"phrases": [], "source": None})
    cap = {**(b.get("captions") or {}), **(sb.get("captions") or {})}
    carried = 0
    if cap.get("carry", True) and tr.get("source") in ("capcut", "srt"):
        for p in tr["phrases"]:
            mid = (p["s"] + p["e"]) / 2
            if not kept(cuts, mid) or any(a <= mid < z for a, z in cap.get("hide", [])):
                continue
            layers.append({"text": p["text"], "px": cap.get("size", 60), "y": cap.get("y", 1500), "font": cap.get("font", "serif"),
                           "color": cap.get("color", "#FFFFFF"), "t0": snap(O(p["s"])), "t1": snap(O(p["e"])), "intro": None, "outro": None,
                           "bg": None, "wrap": True, "track": "captions"})
            carried += 1

    fonts_map = {**DEFAULT_FONTS, **(b.get("fonts") or {})}
    size_per_px = (b.get("capcut") or {}).get("sizePerPx", 0.15)
    tracks, patches = {}, {}
    for layer in sorted(layers, key=lambda l: l["t0"]):
        group = layer.get("track", "text")
        lanes = tracks.setdefault(group, [])
        lane = next((i for i, end in enumerate(lanes) if end <= layer["t0"]), None)
        if lane is None:
            lane = len(lanes)
            lanes.append(0)
            script.add_track(cc.TrackType.text, f"{group} {lane + 1}", relative_index=(100 if group == "text" else 0) + lane)
        lanes[lane] = layer["t1"]

        font, raw_font = find_font(cc, fonts_map.get(layer["font"], layer["font"]))
        style = cc.TextStyle(size=round(layer["px"] * size_per_px, 1), color=rgb(layer["color"]), align=1,
                             auto_wrapping=bool(layer.get("wrap")), max_line_width=layer.get("wrap_width", 0.82))
        clip = cc.ClipSettings(transform_x=layer.get("x", 0), transform_y=1 - 2 * layer["y"] / 1920, rotation=layer.get("rotation", 0))
        bg = cc.TextBackground(color=layer["bg"], round_radius=layer.get("radius", 0.4), height=0.34, width=0.2) if layer.get("bg") else None
        shadow = None if bg else cc.TextShadow(alpha=0.55, diffuse=18, distance=4, angle=-90)
        seg = cc.TextSegment(layer["text"], cc.Timerange(layer["t0"], layer["t1"] - layer["t0"]), font=font, style=style,
                             clip_settings=clip, background=bg, shadow=shadow)
        length = layer["t1"] - layer["t0"]
        intro, outro = find_anim(cc, "in", layer.get("intro")), find_anim(cc, "out", layer.get("outro"))
        if intro:
            seg.add_animation(intro, min(intro.value.duration, length // 2))
        if outro:
            seg.add_animation(outro, min(200_000, length // 3))
        if layer.get("loop"):
            seg.add_animation(find_anim(cc, "loop", layer["loop"]))
        script.add_segment(seg, f"{group} {lane + 1}")
        if layer.get("ranges") or raw_font:
            patches[seg.material_id] = {"ranges": layer.get("ranges"), "font": raw_font}

    # 3. Pictures (screenshots, cutaways) from the project's assets folder
    n_img = 0
    for beat in sb["beats"]:
        for t in beat.get("treatments", []):
            if t["type"] != "image":
                continue
            f = pdir / "assets" / t["src"]
            if not f.exists():
                die(f"Beat {beat['id']} uses image {t['src']} but it is not in projects/{slug}/assets/")
            n_img += 1
            script.add_track(cc.TrackType.video, f"picture {n_img}", relative_index=n_img)
            t0, t1 = snap(O(t.get("at", beat["from"]))), snap(O(t.get("until", beat["to"])))
            full = t.get("position") == "full"
            sc = 1 if full else t.get("width", 760) / 1080
            clip = cc.ClipSettings(scale_x=sc, scale_y=sc, transform_y=0 if full else 1 - 2 * (t.get("y", 420)) / 1920)
            seg = cc.VideoSegment(cc.VideoMaterial(str(f)), cc.Timerange(t0, t1 - t0), clip_settings=clip)
            seg.add_animation(cc.IntroType.渐显)
            script.add_segment(seg, f"picture {n_img}")

    # 4. Sounds from your CapCut sound kit. Sounds not in the kit are listed for you to drag in.
    placed, missing = [], []
    cues = plan_sounds(sb)
    lanes = []
    for cue in cues:
        s = (k.get("sounds") or {}).get(cue["name"])
        if not s or not Path(s["path"]).exists():
            missing.append(cue)
            continue
        t0 = max(0, snap(cue["t"]) - int(s.get("peak", 0) * US))
        dur = min(s["duration"], snap(total(cuts, fps)) - t0)
        if dur <= 0:
            continue
        lane = next((i for i, end in enumerate(lanes) if end <= t0), None)
        if lane is None:
            lane = len(lanes)
            lanes.append(0)
            script.add_track(cc.TrackType.audio, f"sounds {lane + 1}")
        lanes[lane] = t0 + dur
        script.add_segment(cc.AudioSegment(cc.AudioMaterial(s["path"]), cc.Timerange(t0, dur), volume=cue["volume"]), f"sounds {lane + 1}")
        placed.append(cue)

    # 5. Save. Colour ranges and kit fonts are patched into the saved file.
    data = json.loads(script.dumps())
    for m in data["materials"].get("texts", []):
        p = patches.get(m["id"])
        if not p:
            continue
        content = json.loads(m["content"])
        st = content["styles"][0]
        if p.get("font"):
            st["font"] = p["font"]
        if p.get("ranges"):
            n, styles, pos = len(content["text"]), [], 0
            for a, z, col in sorted(p["ranges"]):
                a, z = max(0, a), min(n, z)
                if a > pos:
                    styles.append({**copy.deepcopy(st), "range": [pos, a]})
                hi = {**copy.deepcopy(st), "range": [a, z]}
                hi["fill"]["content"]["solid"]["color"] = list(rgb(col))
                styles.append(hi)
                pos = z
            if pos < n:
                styles.append({**copy.deepcopy(st), "range": [pos, n]})
            content["styles"] = styles
        m["content"] = json.dumps(content, ensure_ascii=False)
    if sys.platform == "darwin":
        for key in ("platform", "last_modified_platform"):
            if isinstance(data.get(key), dict):
                data[key]["os"] = "mac"
    text = json.dumps(data, ensure_ascii=False)
    for fn in ("draft_content.json", "draft_info.json"):  # Windows and Mac CapCut use different file names
        (folder / fn).write_text(text, encoding="utf-8")
    meta = read_json(folder / "draft_meta_info.json", {})
    now = int(time.time() * US)
    meta.update({"draft_name": name, "draft_fold_path": str(folder), "draft_root_path": str(base), "draft_id": str(uuid.uuid4()).upper(),
                 "tm_draft_create": now, "tm_draft_modified": now, "tm_duration": data.get("duration", 0)})
    write_json(folder / "draft_meta_info.json", meta)

    info = {"name": name, "folder": str(folder), "inCapCut": in_capcut, "final": final, "draft": sb["draft"],
            "builtAt": datetime.now(timezone.utc).isoformat(), "seconds": total(cuts, fps), "textLayers": len(layers) - carried,
            "captionsCarried": carried, "soundsPlaced": placed, "soundsToAdd": missing, "pictures": n_img}
    write_json(pdir / ("final.json" if final else f"drafts/draft-{sb['draft']}.json"), info)
    if not final:
        stills(slug, sb)
        old = read_json(review_file(slug, sb["draft"] - 1), {"beats": {}})
        cur = read_json(review_file(slug, sb["draft"]))
        if not cur or not cur.get("submittedAt"):
            write_json(review_file(slug, sb["draft"]), {"draft": sb["draft"], "submittedAt": None, "finishRequested": False, "beats": {
                x["id"]: {"status": "approved" if (old["beats"].get(x["id"]) or {}).get("status") == "approved" and not x.get("whatChanged") else "pending", "note": ""}
                for x in sb["beats"]}})

    print(f'CapCut project written: "{name}"')
    print(f"  {info['textLayers']} text layers, {len(placed)} sounds placed, {n_img} pictures, {fmt(info['seconds'])} long")
    if carried:
        print(f"  {carried} caption lines carried over from CapCut's auto captions")
    else:
        print("  No captions in the project: press Captions > Auto captions in CapCut.")
    if missing:
        print("  Sounds to drag in from CapCut's Sound effects (not in your sound kit yet):")
        for c in missing:
            print(f"    {fmt(c['t'])}  {c['name']}  ({c['label']})")
    if in_capcut:
        print("  Open CapCut and it is in your project list (restart CapCut if it does not show).")
    else:
        print(f"  CapCut is not on this computer. Copy this folder into CapCut's projects folder:\n    {folder}")
    return info


def stills(slug, sb):
    """One picture of the raw clip per beat for the dashboard. Skipped when ffmpeg is not installed."""
    if not shutil.which("ffmpeg"):
        return
    d = PROJECTS / slug / "stills"
    d.mkdir(exist_ok=True)
    for beat in sb["beats"]:
        f = d / f"{beat['id']}-{round(beat['from'] * 10)}.jpg"
        if f.exists():
            continue
        for old in d.glob(f"{beat['id']}-*.jpg"):
            old.unlink()
        t = beat["from"] + min(1.0, (beat["to"] - beat["from"]) / 2)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", sb["source"]["path"], "-frames:v", "1",
                        "-vf", "scale=360:-2", "-q:v", "4", str(f)], check=False)


# ───────────────────────── start / captions / kit ─────────────────────────

def start(path, name=None):
    cc = need_pycapcut()
    p = find_clip(path) if path else None
    if not p:
        base = folders()["toEdit"]
        clips = sorted(f for f in base.rglob("*") if f.suffix.lower() in VIDEO_EXT) if base.is_dir() else []
        die((f'No clip matching "{path}".\n' if path else "") + f"Clips in {base}:\n" +
            ("\n".join(f"  {c.relative_to(base)}" for c in clips) or "  (none, or the folder is not on this computer)") +
            '\nUsage: python3 editor.py start "<clip name or path>" [name]')
    from pymediainfo import MediaInfo
    v = next(t for t in MediaInfo.parse(str(p)).tracks if t.track_type == "Video")
    w, h = int(v.width), int(v.height)
    if abs(float(v.rotation or 0)) % 180 == 90:
        w, h = h, w
    fps = round(float(v.frame_rate or 30))
    dur = cc.VideoMaterial(str(p)).duration / US
    slug = slugify(name or p.name)
    title = name or p.stem
    pdir = PROJECTS / slug
    (pdir / "assets").mkdir(parents=True, exist_ok=True)
    if (pdir / "storyboard.json").exists():
        shutil.copy(pdir / "storyboard.json", pdir / "storyboard.json.bak")
    write_json(pdir / "storyboard.json", {
        "project": slug, "title": title, "draft": 0,
        "source": {"path": str(p), "width": w, "height": h, "fps": fps, "duration": dur},
        "cuts": [{"from": 0, "to": dur}], "captions": {"hide": []}, "beats": []})

    # A CapCut project holding just the clip, for running Auto captions.
    base, in_capcut = out_dir()
    cname = f"{title} (captions)"
    script = cc.DraftFolder(str(base)).create_draft(cname, w, h, fps, allow_replace=True)
    script.add_track(cc.TrackType.video, "footage")
    script.add_segment(cc.VideoSegment(cc.VideoMaterial(str(p)), cc.Timerange(0, round(dur * fps) * US // fps)), "footage")
    data = script.dumps()
    for fn in ("draft_content.json", "draft_info.json"):
        (base / cname / fn).write_text(data, encoding="utf-8")
    print(f"Project ready: projects/{slug}/  ({w}x{h} @ {fps}fps, {fmt(dur)})")
    print(f'CapCut project written: "{cname}"' + ("" if in_capcut else f"  (in {base}; CapCut is not on this computer)"))
    print("Next, in CapCut: open it, press Captions > Auto captions, wait for it to finish, then close the project.")
    print(f"Then: python3 editor.py captions {slug}")


def captions(slug):
    """Find out what is said and when: CapCut's auto captions first, then an .srt, then local listening."""
    pdir = PROJECTS / slug
    sb = read_json(pdir / "storyboard.json")
    phrases, source = [], None

    data, _ = load_capcut_project(f"{sb['title']} (captions)")
    if data:
        texts = {m["id"]: m for m in data.get("materials", {}).get("texts", [])}
        for tr in data.get("tracks", []):
            if tr.get("type") != "text":
                continue
            for seg in tr.get("segments", []):
                m = texts.get(seg.get("material_id"))
                if not m:
                    continue
                try:
                    txt = json.loads(m["content"])["text"]
                except Exception:
                    txt = re.sub(r"<[^>]+>|\[|\]", "", m.get("content", ""))
                s = seg["target_timerange"]["start"] / US
                e = s + seg["target_timerange"]["duration"] / US
                words = []
                w = m.get("words") or {}
                if w.get("text") and len(w["text"]) == len(w.get("start_time", [])):
                    words = [{"w": x, "s": s + a / 1000, "e": s + z / 1000} for x, a, z in zip(w["text"], w["start_time"], w["end_time"]) if x.strip()]
                if txt.strip():
                    phrases.append({"s": s, "e": e, "text": txt.strip(), "words": words})
        if phrases:
            source = "capcut"

    if not phrases:
        srt = next((f for f in [Path(sb["source"]["path"]).with_suffix(".srt"), pdir / "captions.srt"] if f.exists()), None)
        if srt:
            ts = lambda x: sum(float(v.replace(",", ".")) * m for v, m in zip(x.split(":"), (3600, 60, 1)))
            for blk in re.split(r"\n\s*\n", srt.read_text(encoding="utf-8-sig")):
                m = re.search(r"(\d+:\d+:\d+[,.]\d+)\s*-->\s*(\d+:\d+:\d+[,.]\d+)\s*\n(.+)", blk, re.S)
                if m:
                    phrases.append({"s": ts(m[1]), "e": ts(m[2]), "text": " ".join(m[3].split()), "words": []})
            source = "srt" if phrases else None

    if not phrases and "--listen" in sys.argv:
        try:
            import numpy as np
            from faster_whisper import WhisperModel
        except ImportError:
            die("Local listening needs: pip install faster-whisper")
        pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", sb["source"]["path"], "-vn", "-ac", "1", "-ar", "16000", "-f", "f32le", "-"],
                             check=True, capture_output=True).stdout
        local = ROOT / ".models" / "whisper-small"
        model = WhisperModel(str(local) if (local / "model.bin").exists() else "small", device="cpu", compute_type="int8")
        segs, _ = model.transcribe(np.frombuffer(pcm, dtype=np.float32), word_timestamps=True)
        for s in segs:
            phrases.append({"s": s.start, "e": s.end, "text": s.text.strip(),
                            "words": [{"w": w.word.strip(), "s": w.start, "e": w.end} for w in (s.words or [])]})
        source = "listen"

    if not phrases:
        die(f'No captions found yet.\n  1. In CapCut open "{sb["title"]} (captions)", press Captions > Auto captions, then close the project.\n'
            f"  2. Run this again.\nIf CapCut's file cannot be read, export the captions as .srt next to the clip, "
            "or run again with --listen to let Claude listen to the clip itself (planning only; nothing from it goes on screen).")

    phrases.sort(key=lambda p: p["s"])
    for p in phrases:  # no word timings: spread the words evenly across the phrase
        if not p["words"]:
            ws = p["text"].split()
            step = (p["e"] - p["s"]) / max(1, len(ws))
            p["words"] = [{"w": w, "s": p["s"] + i * step, "e": p["s"] + (i + 1) * step} for i, w in enumerate(ws)]
        for w in p["words"]:
            w["s"], w["e"] = round(w["s"], 3), round(w["e"], 3)
        p["s"], p["e"] = round(p["s"], 3), round(p["e"], 3)
    write_json(pdir / "transcript.json", {"source": source, "phrases": phrases})
    label = {"capcut": "CapCut auto captions", "srt": "the .srt file", "listen": "local listening (planning only)"}[source]
    print(f"{len(phrases)} caption lines from {label} -> projects/{slug}/transcript.json")
    for p in phrases:
        print(f"  {p['s']:6.1f}-{p['e']:6.1f}  {p['text']}")


def kit_cmd(name):
    """Learn the sounds, fonts and text animations used in one of the user's own CapCut projects."""
    data, folder = load_capcut_project(name)
    if not data:
        d = capcut_dir()
        have = sorted(p.name for p in d.iterdir() if p.is_dir())[:40] if d else []
        die(f'No CapCut project called "{name}".' + (f"\nProjects found: {', '.join(have)}" if have else "\nCapCut's projects folder was not found on this computer."))
    k = kit()
    mats = data.get("materials", {})
    for a in mats.get("audios", []):
        p = a.get("path", "")
        if a.get("name") and p:
            p = p.replace("##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##", str(folder))
            k["sounds"][a["name"]] = {"path": p, "duration": a.get("duration", 0), "type": a.get("type", ""), "peak": k["sounds"].get(a["name"], {}).get("peak", 0)}
    for t in mats.get("texts", []):
        try:
            for st in json.loads(t["content"]).get("styles", []):
                f = st.get("font") or {}
                if f.get("path") and Path(f["path"]).suffix:
                    k["fonts"][Path(f["path"]).stem] = f
        except Exception:
            pass
    seen = {a["name"] for a in k["animations"]}
    for ma in mats.get("material_animations", []):
        for a in ma.get("animations", []):
            if a.get("name") and a["name"] not in seen:
                seen.add(a["name"])
                k["animations"].append({"name": a["name"], "type": a.get("type"), "duration": a.get("duration")})
    k["from"] = sorted(set(k.get("from", []) + [name]))
    write_json(ROOT / "brand" / "capcut-kit.json", k)
    print(f'Kit updated from "{name}": {len(k["sounds"])} sounds, {len(k["fonts"])} fonts, {len(k["animations"])} animations')
    for n, s in k["sounds"].items():
        print(f"  sound  {n}  ({s['duration'] / US:.1f}s)" + ("" if Path(s["path"]).exists() else "  FILE MISSING"))
    for n in k["fonts"]:
        print(f"  font   {n}")
    for a in k["animations"]:
        print(f"  anim   {a['name']} ({a['type']})")


def inspo():
    """Contact sheets of every video in the inspo folder, for Claude to look at when writing the brand sheet."""
    d = folders()["inspo"]
    if not d.is_dir():
        d = ROOT / "inspo"
    if not d.is_dir():
        die(f"The inspo folder was not found: {folders()['inspo']}")
    if not shutil.which("ffmpeg"):
        die("Reviewing inspo needs ffmpeg to take pictures of the videos (brew install ffmpeg).")
    vids = sorted(f for f in d.rglob("*") if f.suffix.lower() in VIDEO_EXT)
    if not vids:
        die(f"No videos in {d}")
    study = ROOT / "brand" / "study"
    for v in vids:
        out = study / slugify(v.name)
        if (out / "hook.jpg").exists():
            print(f"  already studied  {v.name}")
            continue
        out.mkdir(parents=True, exist_ok=True)
        run = lambda *a: subprocess.run(["ffmpeg", "-v", "error", "-y", *a], check=False)
        run("-t", "12", "-i", str(v), "-vf", "fps=2,scale=360:-2,tile=6x4", "-frames:v", "1", str(out / "hook.jpg"))
        run("-i", str(v), "-vf", "fps=1/2,scale=360:-2,tile=6x4", str(out / "body-%02d.jpg"))
        print(f"  studied  {v.name}  ->  brand/study/{out.name}/")
    print(f"\n{len(vids)} inspo videos. Next: Claude looks at hook.jpg and body-*.jpg in each folder and writes what it sees\n"
          "(text style, caption style, layouts, pacing, sounds it implies) into brand/brand.json using CapCut fonts and animations.")


def pull(urls):
    """Download your own Reels or TikToks into the inspo folder with yt-dlp."""
    d = folders()["inspo"]
    if not d.is_dir():
        d = ROOT / "inspo"
        d.mkdir(exist_ok=True)
    if not urls:
        die("Usage: python3 editor.py pull <reel or tiktok url> [more urls]")
    r = subprocess.run([sys.executable, "-m", "yt_dlp", "-P", str(d), "-o", "%(uploader)s-%(id)s.%(ext)s", "-f", "bv*+ba/b",
                        "--merge-output-format", "mp4", "--no-playlist", *urls])
    print(f"Saved into {d}" if r.returncode == 0 else "yt-dlp could not download one or more links.")


def list_cmd(what):
    cc = need_pycapcut()
    if what == "fonts":
        print("CapCut fonts (use the name in brand.json):")
        names = sorted({f.value.name for f in cc.FontType if f.value.name.isascii()}, key=str.lower)
        for i in range(0, len(names), 4):
            print("  " + "".join(n.ljust(30) for n in names[i:i + 4]))
        for n in kit().get("fonts", {}):
            print(f"  {n}  (from your kit)")
    elif what == "animations":
        for kind, enum in (("in", cc.TextIntro), ("out", cc.TextOutro), ("loop", cc.TextLoopAnim)):
            print(f"Text {kind} animations: " + ", ".join(ANIMS[kind]))
            pro = sum(1 for a in enum if a.value.is_vip)
            print(f"  ({len(list(enum))} more available by CapCut's internal name, {pro} of them CapCut Pro)")
    elif what == "sounds":
        k = kit()
        if not k["sounds"]:
            print('No sounds learned yet. In CapCut, make a project called "Sound Kit", drag in the sound effects you like,\n'
                  'close it, then run: python3 editor.py kit "Sound Kit"')
        for n, s in k["sounds"].items():
            print(f"  {n}  ({s['duration'] / US:.1f}s)")
    else:
        die("Use: list fonts | animations | sounds")


def setup():
    ok = True
    def row(good, name, note, required=True):
        nonlocal ok
        ok = ok and (good or not required)
        print(f"  {'ready    ' if good else ('NOT READY' if required else 'optional ')}  {name:<16} {note}")
    try:
        import pycapcut  # noqa
    except ImportError:
        print("Installing the CapCut project writer...")
        for extra in ([], ["--user"], ["--user", "--break-system-packages"]):
            if subprocess.run([sys.executable, "-m", "pip", "install", "-q", *extra, "pycapcut"], capture_output=True).returncode == 0:
                break
    print("\nTool check")
    try:
        import pycapcut as cc
        row(True, "Project writer", f"writes CapCut projects ({len(list(cc.FontType))} CapCut fonts, {len(list(cc.TextIntro))} text animations)")
    except ImportError:
        row(False, "Project writer", "pip install pycapcut")
    d = capcut_dir()
    row(bool(d), "CapCut", str(d) if d else "CapCut desktop was not found on this computer; projects go to exports/capcut-projects/", required=False)
    fs = folders()
    row(fs["toEdit"].is_dir(), "Your folders", str(fs["workspace"]) if fs["toEdit"].is_dir() else f'"{fs["workspace"]}" was not found on this computer', required=False)
    k = kit()
    row(bool(k["sounds"]), "Sound kit", f"{len(k['sounds'])} CapCut sounds learned" if k["sounds"] else 'none yet: python3 editor.py kit "Sound Kit"', required=False)
    try:
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            s = cc.DraftFolder(tmp).create_draft("check", 1080, 1920, 30)
            s.add_track(cc.TrackType.text)
            f, _ = find_font(cc, {**DEFAULT_FONTS, **(brand().get("fonts") or {})}["serif"])
            s.add_segment(cc.TextSegment("test", cc.Timerange(0, US), font=f).add_animation(find_anim(cc, "in", "fadeIn")))
            json.loads(s.dumps())
        row(True, "Test project", "a test CapCut project was written and read back")
    except Exception as e:
        row(False, "Test project", str(e))
    # The five support tools. None of them draws anything in the finished video; CapCut does that.
    print("\nSupport tools")
    pip = lambda pkg: any(subprocess.run([sys.executable, "-m", "pip", "install", "-q", *x, pkg], capture_output=True).returncode == 0
                          for x in ([], ["--user"], ["--user", "--break-system-packages"]))
    def can(*cmd, cwd=None):
        try:
            return subprocess.run(cmd, capture_output=True, cwd=cwd, timeout=120).returncode == 0
        except Exception:
            return False
    tools = ROOT / "tools"
    if shutil.which("npm") and not (tools / "node_modules" / "remotion").exists():
        print("  installing Remotion and HyperFrames...")
        subprocess.run(["npm", "install", "--no-audit", "--no-fund"], cwd=tools, capture_output=True)
    if not shutil.which("ffmpeg") and shutil.which("brew"):
        subprocess.run(["brew", "install", "ffmpeg"], capture_output=True)
    if not can(sys.executable, "-c", "import faster_whisper"):
        pip("faster-whisper")
    if not can(sys.executable, "-m", "yt_dlp", "--version"):
        pip("yt-dlp")
    row(can("npx", "--no-install", "remotion", "versions", cwd=tools), "Remotion", "titles + animation (installed; the CapCut edit does not use it)", required=False)
    row(can("npx", "--no-install", "hyperframes", "--version", cwd=tools), "HyperFrames", "green screen cutouts (installed; the CapCut edit does not use it)", required=False)
    row(can("ffmpeg", "-version"), "FFmpeg", "pictures of your clips and inspo for Claude to look at", required=False)
    row(can(sys.executable, "-c", "import faster_whisper"), "Whisper", "lets Claude hear a clip when CapCut's captions cannot be read", required=False)
    row(can(sys.executable, "-m", "yt_dlp", "--version"), "yt-dlp", "pulls your own Reels into 03 inspo", required=False)
    print("\nAll set." if ok else "\nFix the NOT READY rows, then run setup again.")
    sys.exit(0 if ok else 1)


def wait(slug):
    sb = read_json(PROJECTS / slug / "storyboard.json")
    deadline = time.time() + float(os.environ.get("WAIT_MINUTES", 110)) * 60
    while True:
        r = read_json(review_file(slug, sb["draft"]))
        if r and r.get("submittedAt"):
            ch = [x for x in sb["beats"] if (r["beats"].get(x["id"]) or {}).get("status") == "changes"]
            pend = [x for x in sb["beats"] if (r["beats"].get(x["id"]) or {}).get("status") not in ("approved", "changes")]
            print(f'Review of "{slug}" draft {sb["draft"]} sent {r["submittedAt"]}')
            print(f"{len(sb['beats']) - len(ch) - len(pend)} approved, {len(ch)} change request(s), {len(pend)} not reviewed")
            for x in ch:
                print(f"\n[{x['id']}] {x.get('label', '')}\n  NOTE: {r['beats'][x['id']].get('note') or '(no note written)'}")
            if pend:
                print("\nNot reviewed: " + ", ".join(x.get("label", x["id"]) for x in pend))
            print(f"\nFINISH REQUESTED: run  python3 editor.py final {slug}" if r.get("finishRequested")
                  else f"\nNEXT: apply the notes in storyboard.json, then  python3 editor.py build {slug}")
            return
        if time.time() > deadline:
            print("No review sent yet.")
            sys.exit(3)
        time.sleep(2)


def main():
    a = [x for x in sys.argv[1:] if not x.startswith("--")]
    cmd = a[0] if a else "help"
    if cmd == "setup": setup()
    elif cmd == "list": list_cmd(a[1] if len(a) > 1 else "")
    elif cmd == "kit": kit_cmd(a[1]) if len(a) > 1 else die('Usage: python3 editor.py kit "<CapCut project name>"')
    elif cmd == "start": start(a[1] if len(a) > 1 else None, a[2] if len(a) > 2 else None)
    elif cmd == "inspo": inspo()
    elif cmd == "pull": pull(a[1:])
    elif cmd == "captions": captions(pick_project(a[1] if len(a) > 1 else None))
    elif cmd == "build": build(pick_project(a[1] if len(a) > 1 else None))
    elif cmd == "final": build(pick_project(a[1] if len(a) > 1 else None), final=True)
    elif cmd == "wait": wait(pick_project(a[1] if len(a) > 1 else None))
    elif cmd == "dashboard":
        import dashboard
        dashboard.serve()
    else:
        print(__doc__)


if __name__ == "__main__":
    main()
