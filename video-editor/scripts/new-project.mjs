// Step 4: drop in your rough cut.
// Usage: npm run new -- "raw-footage/clip.mov" [project-name]
// Makes projects/<name>/ with a working copy, a word-timed transcript, contact sheets
// and a starter storyboard.json for Claude to fill in.
import fs from 'node:fs';
import path from 'node:path';
import { P, probe, projectDir, run, sh, slugify, writeJSON, readJSON } from './lib.mjs';

const [src, name] = process.argv.slice(2);
if (!src || !fs.existsSync(src)) {
  console.error('Usage: npm run new -- "raw-footage/your-clip.mp4" [project-name]');
  process.exit(1);
}
const slug = slugify(name || path.basename(src));
const dir = projectDir(slug);
fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
fs.mkdirSync(path.join(dir, 'sheets'), { recursive: true });

// 1. Working copy: same resolution and frame rate as the recording, constant frame rate,
//    rotation baked in, so every later step counts frames the same way.
const info = probe(src);
const fps = Math.round(info.fps);
const work = path.join(dir, 'source.mp4');
console.log(`Source ${info.width}x${info.height} @ ${info.fps}fps, ${info.duration.toFixed(1)}s (${info.codec}${info.hdr ? ', HDR' : ''})`);
const filters = sh('ffmpeg', ['-hide_banner', '-filters']);
const vf = [];
if (info.hdr && /zscale/.test(filters)) {
  vf.push('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=hable,zscale=t=bt709:m=bt709:r=tv');
} else if (info.hdr) {
  console.log('Note: HDR footage and this ffmpeg has no zscale filter, colours may look flat.');
}
vf.push(`fps=${fps}`, 'format=yuv420p');
run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', vf.join(','), '-c:v', 'libx264', '-preset', 'fast', '-crf', '14',
  '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-movflags', '+faststart', work]);
const w = probe(work);

// 2. Transcript with word timings
run('python3', [P('scripts', 'transcribe.py'), work, path.join(dir, 'transcript.json')]);
const tr = readJSON(path.join(dir, 'transcript.json'));

// 3. Contact sheets (one frame per second, timestamped) so Claude can look at the footage
const sheetVf = `fps=1,scale=270:-2,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=20:fontcolor=white:box=1:boxcolor=black@0.6,tile=6x4`;
try {
  run('ffmpeg', ['-v', 'error', '-y', '-i', work, '-vf', sheetVf, path.join(dir, 'sheets', 'sheet-%02d.jpg')]);
} catch {
  run('ffmpeg', ['-v', 'error', '-y', '-i', work, '-vf', 'fps=1,scale=270:-2,tile=6x4', path.join(dir, 'sheets', 'sheet-%02d.jpg')]);
}

// 4. Starter storyboard: one beat per sentence. Claude rewrites this into the real plan.
const beats = tr.segments.map((s, i) => ({
  id: `b${i + 1}`,
  label: i === 0 ? 'Hook' : `Beat ${i + 1}`,
  from: i === 0 ? 0 : s.s,
  to: i === tr.segments.length - 1 ? w.duration : tr.segments[i + 1].s,
  youSay: s.text,
  visual: '',
  animation: '',
  zoom: 1,
  treatments: [],
  sfx: [],
  lastNote: '',
  whatChanged: '',
}));
const sbFile = path.join(dir, 'storyboard.json');
if (fs.existsSync(sbFile)) fs.copyFileSync(sbFile, sbFile + '.bak');
writeJSON(sbFile, {
  project: slug,
  title: name || path.basename(src).replace(/\.[^.]+$/, ''),
  draft: 0,
  original: path.resolve(src),
  source: { file: `footage/${slug}.mp4`, width: w.width, height: w.height, fps, duration: w.duration },
  cuts: [{ from: 0, to: w.duration }],
  captions: { emphasis: [], hide: [] },
  beats,
});
console.log(`\nProject ready: projects/${slug}/`);
console.log(`  transcript.json   ${tr.words.length} words`);
console.log(`  sheets/           contact sheets, 1 frame per second`);
console.log(`  storyboard.json   ${beats.length} starter beats (draft 0)`);
console.log(`Next: Claude plans the edit in storyboard.json, then: npm run draft -- ${slug}`);
