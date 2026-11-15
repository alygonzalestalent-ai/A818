import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const P = (...a) => path.join(ROOT, ...a);
export const projectDir = (slug) => P('projects', slug);

export const readJSON = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw e; }
};
export const writeJSON = (f, data) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f + '.tmp', JSON.stringify(data, null, 2) + '\n');
  fs.renameSync(f + '.tmp', f);
};

export const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28, ...opts });
export const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} exited with ${r.status}`);
};

export const slugify = (s) => s.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'video';

export function probe(file) {
  const j = JSON.parse(sh('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]));
  const v = j.streams.find((s) => s.codec_type === 'video');
  if (!v) throw new Error('No video stream in ' + file);
  const [n, d] = (v.avg_frame_rate && v.avg_frame_rate !== '0/0' ? v.avg_frame_rate : v.r_frame_rate).split('/').map(Number);
  let rot = Number(v.tags?.rotate || 0);
  for (const sd of v.side_data_list || []) if (sd.rotation != null) rot = Number(sd.rotation);
  const swap = Math.abs(rot) % 180 === 90;
  return {
    width: swap ? v.height : v.width,
    height: swap ? v.width : v.height,
    fps: Math.round((n / d) * 1000) / 1000,
    duration: Number(j.format.duration),
    codec: v.codec_name,
    hdr: ['arib-std-b67', 'smpte2084'].includes(v.color_transfer),
    hasAudio: j.streams.some((s) => s.codec_type === 'audio'),
  };
}

// The newest project, or the one named on the command line.
export function pickProject(arg) {
  if (arg) {
    if (!fs.existsSync(projectDir(arg))) throw new Error(`No project "${arg}" in projects/`);
    return arg;
  }
  const all = listProjects();
  if (!all.length) throw new Error('No projects yet. Run: npm run new -- "raw-footage/your-clip.mp4"');
  return all[0];
}

export function listProjects() {
  if (!fs.existsSync(P('projects'))) return [];
  return fs.readdirSync(P('projects'))
    .filter((d) => fs.existsSync(P('projects', d, 'storyboard.json')))
    .map((d) => ({ d, t: fs.statSync(P('projects', d, 'storyboard.json')).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map((x) => x.d);
}

export const reviewFile = (slug, draft) => P('projects', slug, 'review', `draft-${draft}.json`);
export const brand = () => readJSON(P('brand', 'brand.json'), {});
