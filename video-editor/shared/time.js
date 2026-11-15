// Shared by the Remotion composition, the render script and the dashboard server.
// Everything in storyboard.json is authored in SOURCE seconds (the rough cut's own clock).
// `cuts` lists the ranges that are KEPT. These helpers convert to the output timeline.

export function normCuts(sb) {
  const dur = sb.source.duration;
  const cuts = (sb.cuts && sb.cuts.length ? sb.cuts : [{ from: 0, to: dur }])
    .map((c) => ({ from: Math.max(0, c.from), to: Math.min(dur, c.to) }))
    .filter((c) => c.to > c.from)
    .sort((a, b) => a.from - b.from);
  // snap to whole frames so picture and sound are cut on the same frame numbers
  const fps = sb.source.fps;
  let out = 0;
  return cuts.map((c) => {
    const f0 = Math.round(c.from * fps);
    const f1 = Math.round(c.to * fps);
    const seg = { from: f0 / fps, to: f1 / fps, srcFrame: f0, frames: f1 - f0, outFrame: out };
    out += f1 - f0;
    return seg;
  });
}

export function totalFrames(cuts) {
  return cuts.reduce((n, c) => n + c.frames, 0);
}

// source seconds -> output seconds (times inside a removed range snap to the next kept frame)
export function toOut(cuts, fps, t) {
  for (const c of cuts) {
    if (t < c.from) return c.outFrame / fps;
    if (t <= c.to) return c.outFrame / fps + (t - c.from);
  }
  return totalFrames(cuts) / fps;
}

export function isKept(cuts, t) {
  return cuts.some((c) => t >= c.from && t < c.to);
}

// output seconds -> source seconds
export function toSrc(cuts, fps, tOut) {
  const f = tOut * fps;
  for (const c of cuts) {
    if (f < c.outFrame + c.frames) return c.from + (f - c.outFrame) / fps;
  }
  const last = cuts[cuts.length - 1];
  return last ? last.to : 0;
}

export function fmt(t) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// Group transcript words into caption phrases (output timeline).
export function buildCaptions(sb, words, brand) {
  const cuts = normCuts(sb);
  const fps = sb.source.fps;
  const cfg = { ...(brand.captions || {}), ...(sb.captions || {}) };
  if (cfg.enabled === false) return [];
  const hide = cfg.hide || [];
  const emph = new Set((cfg.emphasis || []).map((w) => w.toLowerCase()));
  const clean = (w) => w.toLowerCase().replace(/[^a-z0-9']/g, '');
  const kept = words
    .filter((w) => isKept(cuts, (w.s + w.e) / 2))
    .filter((w) => !hide.some(([a, b]) => (w.s + w.e) / 2 >= a && (w.s + w.e) / 2 < b))
    .map((w) => ({
      text: w.w.trim(),
      s: toOut(cuts, fps, w.s),
      e: toOut(cuts, fps, w.e),
      emph: emph.has(clean(w.w)),
    }))
    .filter((w) => w.text);
  const per = cfg.style === 'word' ? 1 : cfg.wordsPerPhrase || 4;
  const phrases = [];
  let cur = [];
  const flush = () => {
    if (cur.length) phrases.push({ s: cur[0].s, e: cur[cur.length - 1].e, words: cur });
    cur = [];
  };
  for (let i = 0; i < kept.length; i++) {
    const w = kept[i];
    if (cur.length && w.s - cur[cur.length - 1].e > 0.45) flush();
    cur.push(w);
    if (cur.length >= per || /[.!?]$/.test(w.text) || (/,$/.test(w.text) && cur.length >= 2)) flush();
  }
  flush();
  // hold each phrase until the next one starts when the gap is short, so captions don't flicker
  for (let i = 0; i < phrases.length - 1; i++) {
    const gap = phrases[i + 1].s - phrases[i].e;
    if (gap < 0.35) phrases[i].e = phrases[i + 1].s;
    else phrases[i].e += 0.12;
  }
  return phrases;
}

// Plain-text summary of what a beat puts on screen (shown in the dashboard).
export function onScreenText(beat) {
  const out = [];
  for (const t of beat.treatments || []) {
    const push = (v) => v && out.push(String(v));
    switch (t.type) {
      case 'hook': push(t.kicker); push(t.title); push(t.sub); break;
      case 'header': push([t.step, t.text].filter(Boolean).join(' ')); break;
      case 'card':
      case 'checklist': push(t.title); (t.rows || t.items || []).forEach((r) => push(r.text)); break;
      case 'prompt': push(t.text); break;
      case 'bigText': (t.lines || [t.text]).forEach((l) => push(l && l.text ? l.text : l)); break;
      case 'imessage': (t.messages || []).forEach((m) => push(m.text)); break;
      case 'comment': push(`COMMENT "${t.word}"`); break;
      case 'image': push(`[image] ${t.src}`); break;
      default: push(t.text);
    }
  }
  return out;
}
