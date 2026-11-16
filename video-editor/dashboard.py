"""Storyboard dashboard: approve each beat or leave a change request, then send it back.

    python3 editor.py dashboard        ->  http://localhost:4818

Reviews are saved to projects/<name>/review/draft-N.json, which Claude reads to make the next draft.
"""
import json, os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

import editor as E

PORT = int(os.environ.get("PORT", 4818))
TYPES = {".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png"}


def state(slug):
    projects = E.list_projects()
    project = slug if slug in projects else (projects[0] if projects else None)
    b = E.brand()
    out = {"projects": projects, "project": project, "brand": b, "kit": E.kit(), "folders": {k: str(v) for k, v in E.folders().items()}}
    if not project:
        return out
    pdir = E.PROJECTS / project
    sb = E.read_json(pdir / "storyboard.json")
    fps = sb["source"]["fps"]
    cuts = E.norm_cuts(sb)
    O = lambda t: E.to_out(cuts, fps, t)
    info = E.read_json(pdir / "drafts" / f"draft-{sb['draft']}.json")
    review = E.read_json(E.review_file(project, sb["draft"])) or {"beats": {}, "submittedAt": None}
    fonts = {**E.DEFAULT_FONTS, **(b.get("fonts") or {})}
    beats, titles = [], []
    live = [x for x in sb["beats"] if O(x["to"]) - O(x["from"]) > 0.03]
    for i, x in enumerate(live):
        layers = []
        for t in x.get("treatments", []):
            if t["type"] == "image":
                layers.append({"text": f"[picture] {t['src']}", "font": "", "anim": "Fade in"})
            for l in E.layers_for(x, t, b):
                layers.append({"text": l["text"], "font": fonts.get(l["font"], l["font"]), "anim": l.get("intro") or ""})
            titles.append({"start": O(t.get("at", x["from"])), "end": O(t.get("until", x["to"]))})
        thumb = next(iter(sorted((pdir / "stills").glob(f"{x['id']}-*.jpg"))), None) if (pdir / "stills").exists() else None
        r = review["beats"].get(x["id"]) or {}
        beats.append({
            "id": x["id"], "n": i + 1, "of": len(live), "label": x.get("label", x["id"]),
            "start": O(x["from"]), "end": O(x["to"]), "range": f"{E.fmt(O(x['from']))} – {E.fmt(O(x['to']))}",
            "youSay": x.get("youSay", ""), "layers": layers, "visual": x.get("visual", ""), "animation": x.get("animation", ""),
            "zoom": x.get("zoom", 1) or 1, "sfx": [s["name"] for s in x.get("sfx", [])],
            "lastNote": x.get("lastNote", ""), "whatChanged": x.get("whatChanged", ""),
            "status": r.get("status", "pending"), "note": r.get("note", ""),
            "thumb": f"/media/{project}/stills/{thumb.name}" if thumb else None})
    tr = E.read_json(pdir / "transcript.json") or {"phrases": [], "source": None}
    caps = [{"start": O(p["s"]), "end": O(p["e"])} for p in tr["phrases"] if E.kept(cuts, (p["s"] + p["e"]) / 2)]
    out.update({
        "title": sb["title"], "draft": sb["draft"], "built": bool(info), "info": info, "total": E.total(cuts, fps),
        "size": f"{sb['source']['width']}x{sb['source']['height']} @ {fps}fps",
        "beats": beats, "captionSource": tr.get("source"),
        "timeline": {"titles": titles, "captions": caps, "cuts": [c["out"] for c in cuts[1:]],
                     "zoom": [{"start": O(x["from"]), "end": O(x["to"])} for x in live if (x.get("zoom") or 1) > 1],
                     "sounds": [c["t"] for c in E.plan_sounds(sb)]},
        "submittedAt": review.get("submittedAt"), "finishRequested": bool(review.get("finishRequested")),
        "final": E.read_json(pdir / "final.json")})
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send_json(self, data, code=200):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, f):
        f = Path(f)
        if not f.is_file():
            return self.send_json({"error": "not found"}, 404)
        body = f.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", TYPES.get(f.suffix.lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/":
            return self.send_file(E.ROOT / "dashboard" / "index.html")
        if u.path == "/api/state":
            return self.send_json(state((parse_qs(u.query).get("project") or [""])[0]))
        if u.path.startswith("/media/"):
            parts = unquote(u.path[7:]).split("/")
            if len(parts) == 3 and parts[0] in E.list_projects() and parts[1] == "stills" and "/" not in parts[2] and ".." not in parts[2]:
                return self.send_file(E.PROJECTS / parts[0] / "stills" / parts[2])
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        try:
            b = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
        except Exception:
            b = {}
        slug = b.get("project")
        if slug not in E.list_projects():
            return self.send_json({"error": "unknown project"}, 400)
        sb = E.read_json(E.PROJECTS / slug / "storyboard.json")
        f = E.review_file(slug, sb["draft"])
        review = E.read_json(f) or {"draft": sb["draft"], "beats": {}, "submittedAt": None, "finishRequested": False}
        if review.get("submittedAt"):
            return self.send_json({"error": "This draft was already sent. Wait for the next draft."}, 409)
        if self.path == "/api/beat":
            if not any(x["id"] == b.get("id") for x in sb["beats"]):
                return self.send_json({"error": "unknown beat"}, 400)
            status = b.get("status") if b.get("status") in ("approved", "changes", "pending") else "pending"
            review["beats"][b["id"]] = {"status": status, "note": str(b.get("note") or "")[:2000]}
            E.write_json(f, review)
            return self.send_json({"ok": True})
        if self.path == "/api/send":
            review["submittedAt"] = datetime.now(timezone.utc).isoformat()
            review["finishRequested"] = bool(b.get("finish"))
            E.write_json(f, review)
            return self.send_json({"ok": True})
        self.send_json({"error": "not found"}, 404)


def serve():
    print(f"Storyboard dashboard: http://localhost:{PORT}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
