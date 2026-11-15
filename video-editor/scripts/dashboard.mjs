// Step 5: the storyboard dashboard. Approve each beat or leave a change request, then send it back.
//   npm run dashboard            -> http://localhost:4818
// Reviews are saved to projects/<name>/review/draft-N.json, which Claude reads to make the next draft.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { P, brand, listProjects, projectDir, readJSON, reviewFile, writeJSON } from './lib.mjs';
import { buildCaptions, fmt, normCuts, onScreenText, toOut, totalFrames } from '../shared/time.js';

const PORT = Number(process.env.PORT || 4818);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };

function state(slug) {
  const projects = listProjects();
  const project = slug && projects.includes(slug) ? slug : projects[0];
  const out = { projects, project, brand: brand() };
  if (!project) return out;
  const dir = projectDir(project);
  const sb = readJSON(path.join(dir, 'storyboard.json'));
  const words = readJSON(path.join(dir, 'transcript.json'), { words: [] }).words;
  const cuts = normCuts(sb);
  const fps = sb.source.fps;
  const total = totalFrames(cuts) / fps;
  const o = (t) => toOut(cuts, fps, t);
  const draftFile = path.join(dir, 'drafts', `draft-${sb.draft}.mp4`);
  const rendered = fs.existsSync(draftFile);
  const review = readJSON(reviewFile(project, sb.draft), { draft: sb.draft, beats: {}, submittedAt: null });
  const beats = sb.beats
    .map((b) => ({ ...b, start: o(b.from), end: o(b.to) }))
    .filter((b) => b.end - b.start > 0.03)
    .map((b, i, all) => ({
      id: b.id, n: i + 1, of: all.length, label: b.label || b.id,
      start: b.start, end: b.end, range: `${fmt(b.start)} – ${fmt(b.end)}`,
      youSay: b.youSay || '', onScreen: b.onScreenText || onScreenText(b),
      visual: b.visual || '', animation: b.animation || '', zoom: b.zoom || 1,
      sfx: (b.sfx || []).map((s) => s.name),
      lastNote: b.lastNote || '', whatChanged: b.whatChanged || '',
      status: review.beats?.[b.id]?.status || 'pending', note: review.beats?.[b.id]?.note || '',
      thumb: fs.existsSync(path.join(dir, 'drafts', `draft-${sb.draft}`, `${b.id}.jpg`)) ? `/media/${project}/drafts/draft-${sb.draft}/${b.id}.jpg` : null,
    }));
  const titles = sb.beats.flatMap((b) => (b.treatments || []).map((t) => ({ start: o(t.at ?? b.from), end: o(t.until ?? b.to), type: t.type })));
  const zoom = sb.beats.filter((b) => (b.zoom || 1) > 1).map((b) => ({ start: o(b.from), end: o(b.to) }));
  const captions = buildCaptions(sb, words, out.brand).map((p) => ({ start: p.s, end: p.e }));
  return {
    ...out,
    title: sb.title, draft: sb.draft, rendered, total,
    renderedAt: rendered ? fs.statSync(draftFile).mtimeMs : null,
    video: rendered ? `/media/${project}/drafts/draft-${sb.draft}.mp4?v=${Math.round(fs.statSync(draftFile).mtimeMs)}` : null,
    size: `${sb.source.width}x${sb.source.height} @ ${fps}fps`,
    beats,
    timeline: { titles, zoom, captions, cuts: cuts.slice(1).map((c) => c.outFrame / fps) },
    submittedAt: review.submittedAt || null, exportRequested: !!review.exportRequested,
    export: readJSON(path.join(dir, 'export.json'), null),
  };
}

const body = (req) => new Promise((res) => {
  let s = '';
  req.on('data', (c) => (s += c));
  req.on('end', () => { try { res(JSON.parse(s || '{}')); } catch { res({}); } });
});

function sendFile(req, res, file) {
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); return res.end('Not found'); }
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] ? Number(m[1]) : 0;
    const end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

const inside = (base, rel) => {
  const f = path.resolve(base, rel);
  return f.startsWith(path.resolve(base) + path.sep) ? f : null;
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (data, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  try {
    if (req.method === 'GET' && url.pathname === '/') return sendFile(req, res, P('dashboard', 'index.html'));
    if (req.method === 'GET' && url.pathname === '/api/state') return json(state(url.searchParams.get('project')));
    if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
      const [slug, ...rest] = decodeURIComponent(url.pathname.slice(7)).split('/');
      const f = listProjects().includes(slug) && inside(projectDir(slug), rest.join('/'));
      return f ? sendFile(req, res, f) : json({ error: 'not found' }, 404);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/fonts/')) {
      const f = inside(P('node_modules', '@fontsource'), decodeURIComponent(url.pathname.slice(7)));
      return f ? sendFile(req, res, f) : json({ error: 'not found' }, 404);
    }
    if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
      const b = await body(req);
      if (!listProjects().includes(b.project)) return json({ error: 'unknown project' }, 400);
      const sb = readJSON(path.join(projectDir(b.project), 'storyboard.json'));
      const file = reviewFile(b.project, sb.draft);
      const review = readJSON(file, { draft: sb.draft, beats: {}, submittedAt: null, exportRequested: false });
      if (review.submittedAt) return json({ error: 'This draft was already sent. Wait for the next draft.' }, 409);
      if (url.pathname === '/api/beat') {
        if (!sb.beats.some((x) => x.id === b.id)) return json({ error: 'unknown beat' }, 400);
        const status = ['approved', 'changes', 'pending'].includes(b.status) ? b.status : 'pending';
        review.beats[b.id] = { status, note: String(b.note || '').slice(0, 2000) };
        writeJSON(file, review);
        return json({ ok: true });
      }
      if (url.pathname === '/api/send') {
        review.submittedAt = new Date().toISOString();
        review.exportRequested = !!b.export;
        writeJSON(file, review);
        return json({ ok: true });
      }
    }
    json({ error: 'not found' }, 404);
  } catch (e) {
    json({ error: String(e.message || e) }, 500);
  }
});

server.listen(PORT, () => console.log(`Storyboard dashboard: http://localhost:${PORT}`));
