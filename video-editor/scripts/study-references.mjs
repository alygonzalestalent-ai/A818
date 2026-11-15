// Step 3: teach it your style. Measures every video in references/ so Claude can write the brand sheet.
//   npm run study
// For each reel it writes brand/study/<name>/: contact sheets, a colour palette, cut rate, and the
// speaking pace from a transcript. Claude then looks at the sheets and updates brand/brand.json.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { P, probe, run, sh, slugify, writeJSON, readJSON } from './lib.mjs';

const dir = P('references');
const vids = fs.readdirSync(dir).filter((f) => /\.(mp4|mov|m4v|webm)$/i.test(f));
if (!vids.length) {
  console.error('references/ is empty. Add 3-5 reels (yours or ones you love), or pull them: npm run pull -- <url>');
  process.exit(1);
}
const summary = [];
for (const v of vids) {
  const src = path.join(dir, v);
  const name = slugify(v);
  const out = P('brand', 'study', name);
  fs.mkdirSync(out, { recursive: true });
  const info = probe(src);
  console.log(`Studying ${v} (${info.duration.toFixed(1)}s)`);

  // contact sheets: 2 frames per second for the first 12s (hook and titles), then 1 every 2s
  run('ffmpeg', ['-v', 'error', '-y', '-t', '12', '-i', src, '-vf', 'fps=2,scale=360:-2,tile=6x4', '-frames:v', '1', path.join(out, 'hook.jpg')]);
  run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', 'fps=1/2,scale=360:-2,tile=6x4', path.join(out, 'body-%02d.jpg')]);

  // palette: the 8 most common colours across the video
  run('ffmpeg', ['-v', 'error', '-y', '-i', src, '-vf', 'fps=1,scale=160:-2,palettegen=max_colors=8:reserve_transparent=0:stats_mode=full', '-frames:v', '1', path.join(out, 'palette.png')]);
  const raw = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(out, 'palette.png'), '-vf', 'crop=8:1:0:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 }).stdout;
  const palette = [];
  for (let i = 0; i + 2 < raw.length; i += 3) palette.push('#' + [raw[i], raw[i + 1], raw[i + 2]].map((x) => x.toString(16).padStart(2, '0')).join(''));

  // pacing: hard cuts per minute (scene changes)
  const sc = spawnSync('ffmpeg', ['-v', 'info', '-i', src, '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const cuts = (sc.stderr.match(/pts_time:/g) || []).length;

  // speaking pace and caption density from the transcript
  let wpm = null, words = 0, longestPause = null;
  if (info.hasAudio) {
    try {
      sh('python3', [P('scripts', 'transcribe.py'), src, path.join(out, 'transcript.json')]);
      const tr = readJSON(path.join(out, 'transcript.json'));
      words = tr.words.length;
      if (words > 1) {
        const span = tr.words[words - 1].e - tr.words[0].s;
        wpm = Math.round((words / span) * 60);
        longestPause = Math.max(...tr.words.slice(1).map((w, i) => w.s - tr.words[i].e));
      }
    } catch (e) { console.log('  (no transcript: ' + String(e.message).split('\n')[0] + ')'); }
  }
  const row = { file: v, seconds: Math.round(info.duration * 10) / 10, size: `${info.width}x${info.height}`, fps: info.fps, palette, cutsPerMinute: Math.round((cuts / info.duration) * 600) / 10, wordsPerMinute: wpm, words, longestPauseSeconds: longestPause && Math.round(longestPause * 100) / 100, sheets: `brand/study/${name}/` };
  writeJSON(path.join(out, 'study.json'), row);
  summary.push(row);
}
writeJSON(P('brand', 'study', 'summary.json'), summary);
console.table(summary.map(({ file, seconds, cutsPerMinute, wordsPerMinute, palette }) => ({ file, seconds, cutsPerMinute, wordsPerMinute, palette: palette.slice(0, 4).join(' ') })));
console.log('\nNext: Claude reads brand/study/*/hook.jpg and body-*.jpg (fonts, caption style, layouts) plus summary.json,');
console.log('then writes the fonts, colours, captions and pacing into brand/brand.json.');
