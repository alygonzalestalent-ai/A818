import React from 'react';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';

// One component per on-screen treatment. Everything is laid out on a 1080x1920 canvas
// and multiplied by S, so the same storyboard renders at any footage resolution.
// `rel(sourceSeconds)` gives the frame, relative to this treatment's start, when a row/item appears.

type P = { t: any; brand: any; S: number; rel: (tSrc?: number) => number; project?: string };

const shadow = (S: number) => `0 ${3 * S}px ${16 * S}px rgba(0,0,0,.5), 0 0 ${3 * S}px rgba(0,0,0,.45)`;
const cardShadow = (S: number) => `0 ${10 * S}px ${40 * S}px rgba(0,0,0,.28)`;

// Shared enter/exit: pop or slide in on the first frames, quick fade at the end.
const useInOut = (delay = 0) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const enter = spring({ frame: frame - delay, fps, config: { damping: 14, stiffness: 170, mass: 0.6 } });
  const exit = interpolate(frame, [durationInFrames - 6, durationInFrames - 1], [1, 0], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  return { frame, fps, enter, exit, shown: frame >= delay };
};

const topOf = (t: any, brand: any, S: number) => {
  if (typeof t.y === 'number') return t.y * S;
  if (t.position === 'chest') return brand.layout.chestY * S;
  if (t.position === 'center') return 960 * S;
  return brand.layout.topY * S;
};

const color = (brand: any, c: string | undefined, fallback: string) => (c ? brand.colors[c] || c : fallback);

/* hook: stacked title lockup ("I BUILT MY OWN" / big serif line / small line) */
const Hook: React.FC<P> = ({ t, brand, S }) => {
  const { enter, exit } = useInOut();
  const y = typeof t.y === 'number' ? t.y * S : 300 * S;
  return (
    <div style={{ position: 'absolute', left: 50 * S, right: 50 * S, top: y, textAlign: 'center', opacity: exit, transform: `scale(${0.9 + 0.1 * enter})` }}>
      {t.kicker && (
        <div style={{ fontFamily: brand.fonts.sans, fontWeight: 800, fontSize: 44 * S, letterSpacing: 3 * S, color: '#fff', textShadow: shadow(S) }}>
          {t.kicker.toUpperCase()}
        </div>
      )}
      <div style={{ fontFamily: `"${brand.fonts[t.font || 'serif']}"`, fontStyle: t.italic === false ? 'normal' : 'italic', fontSize: (t.size || 150) * S, lineHeight: 1.02, color: color(brand, t.color, brand.colors.cream), textShadow: shadow(S), margin: `${6 * S}px 0` }}>
        {t.title}
      </div>
      {t.sub && (
        <div style={{ fontFamily: brand.fonts.sans, fontWeight: 800, fontSize: 40 * S, letterSpacing: 3 * S, color: '#fff', textShadow: shadow(S) }}>
          {t.sub.toUpperCase()}
        </div>
      )}
    </div>
  );
};

/* header: "STEP 1  SET UP YOUR FOLDERS" strip above the head */
const Header: React.FC<P> = ({ t, brand, S }) => {
  const { enter, exit } = useInOut();
  return (
    <div style={{ position: 'absolute', left: 40 * S, right: 40 * S, top: topOf(t, brand, S), textAlign: 'center', opacity: exit * enter, transform: `translateY(${(1 - enter) * -30 * S}px)`, fontFamily: brand.fonts.sans, fontWeight: 800, fontSize: (t.size || 46) * S, letterSpacing: 2 * S, textShadow: shadow(S) }}>
      {t.step && <span style={{ color: color(brand, t.color, brand.colors.cream) }}>{t.step.toUpperCase()} </span>}
      <span style={{ color: '#fff' }}>{(t.text || '').toUpperCase()}</span>
    </div>
  );
};

/* card: white rounded card sized to its content; rows appear when she says them */
const Card: React.FC<P> = ({ t, brand, S, rel }) => {
  const { frame, fps, enter, exit } = useInOut();
  const rows = (t.rows || t.items || []).filter((r: any) => frame >= rel(r.at));
  const check = t.type === 'checklist';
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: topOf(t, brand, S), display: 'flex', justifyContent: 'center', opacity: exit }}>
      <div style={{ background: brand.colors.paper, borderRadius: 26 * S, padding: `${30 * S}px ${40 * S}px`, minWidth: 520 * S, maxWidth: 960 * S, boxShadow: cardShadow(S), transform: `scale(${0.85 + 0.15 * enter})`, opacity: enter }}>
        {t.title && (
          <div style={{ fontFamily: brand.fonts.sans, fontWeight: 800, fontSize: 34 * S, letterSpacing: 2 * S, color: brand.colors.ink, marginBottom: rows.length ? 16 * S : 0 }}>
            {t.title.toUpperCase()}
          </div>
        )}
        {rows.map((r: any, i: number) => {
          const a = spring({ frame: frame - rel(r.at), fps, config: { damping: 14, stiffness: 200, mass: 0.5 } });
          const tick = spring({ frame: frame - rel(r.at) - 5, fps, config: { damping: 10, stiffness: 220, mass: 0.4 } });
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18 * S, padding: `${9 * S}px 0`, opacity: a, transform: `translateY(${(1 - a) * 14 * S}px)`, fontFamily: brand.fonts.sans, fontWeight: 600, fontSize: (t.size || 40) * S, color: brand.colors.ink }}>
              {check && (
                <span style={{ width: 44 * S, height: 44 * S, borderRadius: 10 * S, border: `${4 * S}px solid ${brand.colors.pink}`, background: tick > 0.5 ? brand.colors.pink : 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width={28 * S} height={28 * S} viewBox="0 0 24 24" style={{ transform: `scale(${tick})` }}>
                    <path d="M4 12.5l5 5L20 6.5" fill="none" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              )}
              <span>{r.text}</span>
              {r.note && <span style={{ fontWeight: 400, opacity: 0.55, fontSize: 30 * S }}>{r.note}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* prompt: small "PROMPT · COPY THIS" card with highlighted words */
const Prompt: React.FC<P> = ({ t, brand, S }) => {
  const { enter, exit } = useInOut();
  const hi = new Set((t.highlight || []).map((w: string) => w.toLowerCase()));
  return (
    <div style={{ position: 'absolute', left: 60 * S, right: 60 * S, top: topOf(t, brand, S), opacity: exit * enter, transform: `translateY(${(1 - enter) * 24 * S}px)` }}>
      <div style={{ background: brand.colors.paper, borderRadius: 22 * S, padding: `${24 * S}px ${32 * S}px`, boxShadow: cardShadow(S) }}>
        <div style={{ fontFamily: brand.fonts.sans, fontWeight: 800, fontSize: 22 * S, letterSpacing: 3 * S, color: brand.colors.pink, marginBottom: 10 * S }}>
          {(t.label || 'PROMPT · COPY THIS').toUpperCase()}
        </div>
        <div style={{ fontFamily: brand.fonts.sans, fontWeight: 600, fontSize: (t.size || 36) * S, lineHeight: 1.3, color: brand.colors.ink }}>
          {String(t.text).split(' ').map((w, i) => {
            const on = hi.has(w.toLowerCase().replace(/[^a-z0-9]/g, ''));
            return (
              <span key={i} style={{ background: on ? brand.colors.cream : 'transparent', borderRadius: 6 * S, padding: on ? `0 ${6 * S}px` : 0 }}>
                {w}{' '}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

/* pill: typed label with a blinking cursor ("STEP 1", "CONTENT IDEA #1") */
const Pill: React.FC<P> = ({ t, brand, S }) => {
  const { frame, exit } = useInOut();
  const n = Math.min(t.text.length, Math.floor(frame / 1.5));
  const cursor = n < t.text.length || Math.floor(frame / 8) % 2 === 0;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: topOf(t, brand, S), display: 'flex', justifyContent: 'center', opacity: exit }}>
      <div style={{ background: color(brand, t.bg, '#fff'), color: color(brand, t.color, brand.colors.ink), borderRadius: 999, padding: `${14 * S}px ${38 * S}px`, fontFamily: brand.fonts.sans, fontWeight: 800, fontSize: (t.size || 44) * S, letterSpacing: 2 * S, boxShadow: cardShadow(S) }}>
        {t.text.slice(0, n)}
        <span style={{ opacity: cursor ? 1 : 0, color: brand.colors.pink }}>|</span>
      </div>
    </div>
  );
};

/* bigText: chest-height statement, one line per row ("CLIENTS: EVERY DAY" / "ME: NEVER") */
const BigText: React.FC<P> = ({ t, brand, S, rel }) => {
  const { frame, fps, exit } = useInOut();
  const lines = (t.lines || [t.text]).map((l: any) => (typeof l === 'string' ? { text: l } : l));
  return (
    <div style={{ position: 'absolute', left: 50 * S, right: 50 * S, top: topOf({ position: 'chest', ...t }, brand, S), transform: 'translateY(-50%)', textAlign: 'center', opacity: exit }}>
      {lines.map((l: any, i: number) => {
        const a = spring({ frame: frame - rel(l.at), fps, config: { damping: 12, stiffness: 220, mass: 0.5 } });
        if (frame < rel(l.at)) return null;
        return (
          <div key={i} style={{ fontFamily: `"${brand.fonts[t.font || 'sans']}"`, fontWeight: t.font && t.font !== 'sans' ? 400 : 800, fontSize: (t.size || 84) * S, lineHeight: 1.12, color: color(brand, l.color || t.color, brand.colors.cream), textShadow: shadow(S), transform: `scale(${0.7 + 0.3 * a})`, opacity: a }}>
            {t.uppercase === false ? l.text : l.text.toUpperCase()}
          </div>
        );
      })}
    </div>
  );
};

/* hand: pink handwriting that writes on left to right */
const Hand: React.FC<P> = ({ t, brand, S }) => {
  const { frame, exit } = useInOut();
  const reveal = interpolate(frame, [0, Math.max(8, t.text.length * 1.2)], [0, 100], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 60 * S, right: 60 * S, top: topOf({ position: 'chest', ...t }, brand, S), transform: `translateY(-50%) rotate(${t.tilt ?? -3}deg)`, textAlign: 'center', opacity: exit }}>
      <span style={{ display: 'inline-block', fontFamily: `"${brand.fonts[t.font || 'hand']}"`, fontWeight: 600, fontSize: (t.size || 120) * S, color: color(brand, t.color, brand.colors.pink), textShadow: shadow(S), clipPath: `inset(-20% ${100 - reveal}% -20% -5%)` }}>
        {t.text}
      </span>
    </div>
  );
};

/* image: screenshot or cutaway from the project's assets folder; "top" card or "full" cutaway */
const Image: React.FC<P> = ({ t, brand, S, project }) => {
  const { enter, exit } = useInOut();
  const src = staticFile(`assets/${project}/${t.src}`);
  if (t.position === 'full') {
    return (
      <AbsoluteFill style={{ opacity: exit * enter, background: '#000' }}>
        <Img src={src} style={{ width: '100%', height: '100%', objectFit: t.fit || 'cover' }} />
      </AbsoluteFill>
    );
  }
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: topOf(t, brand, S), display: 'flex', justifyContent: 'center', opacity: exit, transform: `translateY(${(1 - enter) * -60 * S}px) rotate(${t.tilt || 0}deg)` }}>
      <Img src={src} style={{ width: (t.width || 760) * S, borderRadius: 24 * S, boxShadow: cardShadow(S), opacity: enter }} />
    </div>
  );
};

/* imessage: chat bubbles that pop in one at a time */
const IMessage: React.FC<P> = ({ t, brand, S, rel }) => {
  const { frame, fps, exit } = useInOut();
  return (
    <div style={{ position: 'absolute', left: 70 * S, right: 70 * S, top: topOf(t, brand, S), opacity: exit, display: 'flex', flexDirection: 'column', gap: 12 * S }}>
      {(t.messages || []).map((m: any, i: number) => {
        if (frame < rel(m.at)) return null;
        const a = spring({ frame: frame - rel(m.at), fps, config: { damping: 13, stiffness: 210, mass: 0.5 } });
        const me = m.from !== 'them';
        return (
          <div key={i} style={{ alignSelf: me ? 'flex-end' : 'flex-start', maxWidth: '78%', background: me ? '#0B84FE' : '#E9E9EB', color: me ? '#fff' : '#111', borderRadius: 38 * S, padding: `${18 * S}px ${30 * S}px`, fontFamily: brand.fonts.sans, fontWeight: 400, fontSize: (t.size || 40) * S, lineHeight: 1.25, boxShadow: cardShadow(S), transform: `scale(${0.6 + 0.4 * a})`, transformOrigin: me ? '100% 100%' : '0% 100%', opacity: a }}>
            {m.text}
          </div>
        );
      })}
    </div>
  );
};

/* comment: closing call to action, COMMENT "WORD" plus a comment bar that types the word */
const Comment: React.FC<P> = ({ t, brand, S }) => {
  const { frame, enter, exit } = useInOut();
  const n = Math.min(t.word.length, Math.max(0, Math.floor((frame - 10) / 2.5)));
  return (
    <div style={{ position: 'absolute', left: 60 * S, right: 60 * S, top: topOf(t, brand, S), opacity: exit * enter, textAlign: 'center' }}>
      <div style={{ fontFamily: brand.fonts.sans, fontWeight: 800, fontSize: 50 * S, letterSpacing: 2 * S, color: '#fff', textShadow: shadow(S), marginBottom: 22 * S }}>
        COMMENT <span style={{ color: brand.colors.cream }}>“{t.word.toUpperCase()}”</span>
      </div>
      <div style={{ background: '#fff', borderRadius: 999, padding: `${20 * S}px ${34 * S}px`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: cardShadow(S), fontFamily: brand.fonts.sans, fontSize: 38 * S }}>
        <span style={{ fontWeight: 600, color: brand.colors.ink }}>
          {t.word.toUpperCase().slice(0, n)}
          <span style={{ color: brand.colors.pink, opacity: Math.floor(frame / 8) % 2 ? 0 : 1 }}>|</span>
        </span>
        <span style={{ fontWeight: 800, color: n >= t.word.length ? brand.colors.pink : '#bbb' }}>Post</span>
      </div>
      {t.sub && (
        <div style={{ fontFamily: `"${brand.fonts.hand}"`, fontWeight: 600, fontSize: 64 * S, color: brand.colors.pink, textShadow: shadow(S), marginTop: 18 * S }}>{t.sub}</div>
      )}
    </div>
  );
};

/* sticker: tilted colour box with bold text */
const Sticker: React.FC<P> = ({ t, brand, S }) => {
  const { enter, exit } = useInOut();
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: topOf(t, brand, S), display: 'flex', justifyContent: 'center', opacity: exit }}>
      <div style={{ background: color(brand, t.bg, brand.colors.pink), color: color(brand, t.color, '#fff'), fontFamily: brand.fonts.sans, fontWeight: 800, fontSize: (t.size || 56) * S, padding: `${14 * S}px ${34 * S}px`, borderRadius: 14 * S, boxShadow: cardShadow(S), transform: `rotate(${t.tilt ?? -4}deg) scale(${enter})` }}>
        {t.text}
      </div>
    </div>
  );
};

const MAP: Record<string, React.FC<P>> = {
  hook: Hook, header: Header, card: Card, checklist: Card, prompt: Prompt, pill: Pill,
  bigText: BigText, hand: Hand, image: Image, imessage: IMessage, comment: Comment, sticker: Sticker,
};

export const TREATMENT_TYPES = Object.keys(MAP);

export const Treatment: React.FC<P> = (p) => {
  const C = MAP[p.t.type];
  if (!C) return null;
  return (
    <AbsoluteFill>
      <C {...p} />
    </AbsoluteFill>
  );
};
