// Renders a storyboard with Remotion.
//   node scripts/render.mjs draft [project]   half-resolution draft + stills for the dashboard
//   node scripts/render.mjs final [project]   full-resolution export into exports/ (needs every beat approved, or --force)
//   node scripts/render.mjs still [project] <seconds> [out.jpg]   one test frame at an output time
//   node scripts/render.mjs check             renders one frame to prove the renderer works
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { P, brand, pickProject, projectDir, readJSON, reviewFile, run, writeJSON } from './lib.mjs';
import { normCuts, toOut, totalFrames } from '../shared/time.js';

const [mode = 'draft', ...rest] = process.argv.slice(2);
const force = rest.includes('--force');
const args = rest.filter((a) => !a.startsWith('--'));

// Use a Chrome that is already on the machine when there is one; otherwise Remotion downloads its own.
function browser() {
  if (process.env.REMOTION_BROWSER) return process.env.REMOTION_BROWSER;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (fs.existsSync(base)) {
    for (const d of fs.readdirSync(base).filter((x) => x.startsWith('chromium_headless_shell')).sort().reverse()) {
      for (const sub of fs.readdirSync(path.join(base, d))) {
        for (const bin of ['headless_shell', 'chrome-headless-shell']) {
          const f = path.join(base, d, sub, bin);
          if (fs.existsSync(f)) return f;
        }
      }
    }
  }
  return undefined;
}

function link(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.rmSync(dest, { force: true });
  try { fs.linkSync(src, dest); } catch { fs.copyFileSync(src, dest); }
}

async function prepare(slug) {
  // Only the current project's footage and assets go into public/, so bundling stays quick.
  fs.rmSync(P('public', 'footage'), { recursive: true, force: true });
  fs.rmSync(P('public', 'assets'), { recursive: true, force: true });
  fs.mkdirSync(P('public', 'sfx'), { recursive: true });
  let inputProps = { storyboard: { source: { file: '', width: 1080, height: 1920, fps: 30, duration: 1 }, beats: [] }, words: [], brand: brand() };
  if (slug) {
    const dir = projectDir(slug);
    const sb = readJSON(path.join(dir, 'storyboard.json'));
    link(path.join(dir, 'source.mp4'), P('public', sb.source.file));
    const assets = path.join(dir, 'assets');
    if (fs.existsSync(assets)) for (const f of fs.readdirSync(assets)) link(path.join(assets, f), P('public', 'assets', slug, f));
    for (const b of sb.beats) for (const s of b.sfx || []) {
      if (!fs.existsSync(P('public', 'sfx', s.name))) throw new Error(`Beat ${b.id} uses sound "${s.name}" but public/sfx/${s.name} does not exist`);
    }
    inputProps = { storyboard: sb, words: readJSON(path.join(dir, 'transcript.json')).words, brand: brand() };
  }
  const serveUrl = await bundle({ entryPoint: P('src', 'index.ts'), publicDir: P('public') });
  const browserExecutable = browser();
  const chromiumOptions = { gl: 'swangle' };
  const logLevel = 'error';
  const composition = await selectComposition({ serveUrl, id: 'Edit', inputProps, browserExecutable, chromiumOptions, logLevel });
  return { serveUrl, composition, inputProps, browserExecutable, chromiumOptions, logLevel };
}

const progress = (label) => {
  let last = -1;
  return ({ progress: p }) => {
    const pct = Math.floor(p * 100);
    if (pct !== last && pct % 10 === 0) { last = pct; console.log(`  ${label} ${pct}%`); }
  };
};

if (mode === 'check') {
  const ctx = await prepare(null);
  const out = path.join(os.tmpdir(), 'a818-render-check.jpg');
  await renderStill({ ...ctx, frame: 0, output: out, imageFormat: 'jpeg' });
  console.log('Renderer OK:', out);
  process.exit(0);
}

const slug = pickProject(args[0]);
const dir = projectDir(slug);
const sbFile = path.join(dir, 'storyboard.json');

if (mode === 'still') {
  const ctx = await prepare(slug);
  const t = Number(args[1] || 0);
  const out = args[2] || path.join(dir, 'drafts', `still-${t}.jpg`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  await renderStill({ ...ctx, frame: Math.min(ctx.composition.durationInFrames - 1, Math.round(t * ctx.composition.fps)), output: out, imageFormat: 'jpeg', scale: 0.5 });
  console.log(out);
  process.exit(0);
}

if (mode === 'draft') {
  const sb = readJSON(sbFile);
  // A new draft number whenever the last draft has been reviewed (or there is none yet).
  const prev = readJSON(reviewFile(slug, sb.draft), null);
  if (sb.draft === 0 || (prev && prev.submittedAt)) {
    sb.draft += 1;
    writeJSON(sbFile, sb);
  }
  const n = sb.draft;
  const ctx = await prepare(slug);
  const { fps, width, durationInFrames } = ctx.composition;
  const outDir = path.join(dir, 'drafts');
  fs.mkdirSync(outDir, { recursive: true });
  const out = path.join(outDir, `draft-${n}.mp4`);
  const scale = width > 1080 ? 540 / width : 0.5;
  console.log(`Rendering draft ${n} of "${slug}" (${(durationInFrames / fps).toFixed(1)}s, preview size)`);
  await renderMedia({ ...ctx, codec: 'h264', outputLocation: out, scale, crf: 24, imageFormat: 'jpeg', jpegQuality: 80, onProgress: progress('draft') });

  // One still per beat, taken where its graphics are fully on screen.
  const cuts = normCuts(sb);
  const thumbs = path.join(outDir, `draft-${n}`);
  fs.rmSync(thumbs, { recursive: true, force: true });
  fs.mkdirSync(thumbs, { recursive: true });
  for (const b of sb.beats) {
    const a = toOut(cuts, fps, b.from), z = toOut(cuts, fps, b.to);
    if (z - a < 0.05) continue;
    const t = Math.min(a + Math.max(0.6, (z - a) * 0.6), z - 0.05);
    run('ffmpeg', ['-v', 'error', '-y', '-ss', t.toFixed(3), '-i', out, '-frames:v', '1', '-vf', 'scale=360:-2', '-q:v', '4', path.join(thumbs, `${b.id}.jpg`)]);
  }
  writeJSON(path.join(outDir, `draft-${n}.json`), { draft: n, renderedAt: new Date().toISOString(), seconds: totalFrames(cuts) / fps });
  // fresh review sheet for this draft; approvals carry over for beats that were not changed
  const old = readJSON(reviewFile(slug, n - 1), { beats: {} });
  const review = { draft: n, beats: {}, submittedAt: null, exportRequested: false };
  for (const b of sb.beats) {
    const was = old.beats?.[b.id];
    review.beats[b.id] = { status: was?.status === 'approved' && !b.whatChanged ? 'approved' : 'pending', note: '' };
  }
  if (!fs.existsSync(reviewFile(slug, n)) || !readJSON(reviewFile(slug, n)).submittedAt) writeJSON(reviewFile(slug, n), review);
  console.log(`Draft ${n} ready: ${path.relative(process.cwd(), out)}`);
  console.log('Open the storyboard dashboard: npm run dashboard');
  process.exit(0);
}

if (mode === 'final') {
  const sb = readJSON(sbFile);
  const review = readJSON(reviewFile(slug, sb.draft), { beats: {} });
  const open = sb.beats.filter((b) => review.beats?.[b.id]?.status !== 'approved').map((b) => b.label || b.id);
  if (open.length && !force) {
    console.error(`Not exporting: ${open.length} beat(s) are not approved yet (${open.join(', ')}).\nApprove them in the dashboard, or run again with --force.`);
    process.exit(2);
  }
  const ctx = await prepare(slug);
  fs.mkdirSync(P('exports'), { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const name = `${day} ${String(sb.title || slug).replace(/[\\/:*?"<>|]/g, '').trim()}`;
  const raw = path.join(dir, 'drafts', 'final-raw.mp4');
  fs.mkdirSync(path.dirname(raw), { recursive: true });
  console.log(`Exporting "${name}" at ${ctx.composition.width}x${ctx.composition.height} @ ${ctx.composition.fps}fps`);
  await renderMedia({ ...ctx, codec: 'h264', outputLocation: raw, crf: 16, imageFormat: 'jpeg', jpegQuality: 95, audioBitrate: '256k', onProgress: progress('export') });
  // even out loudness for social (-14 LUFS), picture untouched
  const out = P('exports', `${name}.mp4`);
  run('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-c:v', 'copy', '-af', 'loudnorm=I=-14:TP=-1.5:LRA=11', '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out]);
  fs.rmSync(raw, { force: true });
  writeJSON(path.join(dir, 'export.json'), { file: out, draft: sb.draft, exportedAt: new Date().toISOString() });
  console.log(`Exported: ${path.relative(process.cwd(), out)}`);
  process.exit(0);
}

console.error('Unknown mode. Use: draft | final | still | check');
process.exit(1);
