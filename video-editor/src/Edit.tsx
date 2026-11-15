import React from 'react';
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { buildCaptions, normCuts, toOut, totalFrames } from '../shared/time.js';
import { Captions } from './Captions';
import { Treatment } from './treatments';

export type EditProps = { storyboard: any; words: any[]; brand: any };

export const DEFAULT_BRAND = {
  colors: { pink: '#F59CC5', pinkBox: '#F7A9D6', cream: '#F2E6A8', ink: '#1D1B1A', white: '#FFFFFF', paper: '#FFFDF8' },
  fonts: {
    serif: 'Instrument Serif', sans: 'Inter', hand: 'Caveat', script: 'Dancing Script',
    round: 'Fredoka', condensed: 'Anton', italic: 'Playfair Display',
  },
  captions: { style: 'phrase', font: 'serif', size: 92, y: 1600, wordsPerPhrase: 4, highlight: 'box' },
  layout: { topY: 150, chestY: 1250 },
};

export const mergeBrand = (b: any) => ({
  ...DEFAULT_BRAND,
  ...b,
  colors: { ...DEFAULT_BRAND.colors, ...(b?.colors || {}) },
  fonts: { ...DEFAULT_BRAND.fonts, ...(b?.fonts || {}) },
  captions: { ...DEFAULT_BRAND.captions, ...(b?.captions || {}) },
  layout: { ...DEFAULT_BRAND.layout, ...(b?.layout || {}) },
});

// The punch-in for the footage at a given source time: the zoom of the beat that contains it.
const zoomAt = (beats: any[], tSrc: number) => {
  const b = beats.find((x) => tSrc >= x.from && tSrc < x.to);
  return b?.zoom || 1;
};

const Footage: React.FC<{ sb: any; cut: any }> = ({ sb, cut }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSrc = cut.from + frame / fps;
  const z = zoomAt(sb.beats, tSrc);
  return (
    <AbsoluteFill style={{ transform: `scale(${z})`, transformOrigin: `50% ${sb.zoomOriginY ?? 38}%` }}>
      <OffthreadVideo src={staticFile(sb.source.file)} startFrom={cut.srcFrame} style={{ width: '100%', height: '100%' }} />
    </AbsoluteFill>
  );
};

export const Edit: React.FC<EditProps> = ({ storyboard: sb, words, brand: rawBrand }) => {
  const { fps, width } = useVideoConfig();
  const brand = mergeBrand(rawBrand);
  if (!sb.source.file) return <AbsoluteFill style={{ background: '#111' }} />;
  const cuts = normCuts(sb);
  const total = totalFrames(cuts);
  const S = width / 1080; // every graphic is designed on a 1080x1920 canvas and scaled to the footage
  const F = (tSrc: number) => Math.round(toOut(cuts, fps, tSrc) * fps);
  const captions = buildCaptions(sb, words || [], brand);

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {cuts.map((c: any, i: number) => (
        <Sequence key={i} from={c.outFrame} durationInFrames={c.frames}>
          <Footage sb={sb} cut={c} />
        </Sequence>
      ))}

      {sb.beats.flatMap((b: any) =>
        (b.treatments || []).map((t: any, i: number) => {
          const from = F(t.at ?? b.from);
          const to = Math.min(total, F(t.until ?? b.to));
          if (to - from < 2) return null;
          // item times become frames relative to the treatment's own start
          const rel = (tSrc?: number) => (tSrc == null ? 0 : Math.max(0, F(tSrc) - from));
          return (
            <Sequence key={`${b.id}-${i}`} from={from} durationInFrames={to - from}>
              <Treatment t={t} brand={brand} S={S} rel={rel} project={sb.project} />
            </Sequence>
          );
        }),
      )}

      <Captions phrases={captions} brand={brand} sb={sb} S={S} />

      {sb.beats.flatMap((b: any) =>
        (b.sfx || []).map((s: any, i: number) => (
          <Sequence key={`sfx-${b.id}-${i}`} from={Math.max(0, F(s.at ?? b.from) - Math.round((s.peak || 0) * fps))}>
            <Audio src={staticFile(`sfx/${s.name}`)} volume={s.volume ?? 0.5} />
          </Sequence>
        )),
      )}
    </AbsoluteFill>
  );
};
