import React from 'react';
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

// Two caption looks, picked on the brand sheet (storyboard.captions can override per video):
//  - "phrase": 3-4 words at a time, a coloured box on the word being spoken
//  - "word":   one word at a time, emphasis words in the accent colour
export const Captions: React.FC<{ phrases: any[]; brand: any; sb: any; S: number }> = ({ phrases, brand, sb, S }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cfg = { ...brand.captions, ...(sb.captions || {}) };
  const p = phrases.find((x) => t >= x.s && t < x.e);
  if (!p) return null;
  const font = brand.fonts[cfg.font] || cfg.font;
  const size = cfg.size * S;
  const pop = interpolate(t - p.s, [0, 0.08], [0.92, 1], { extrapolateRight: 'clamp' });
  const shadow = `0 ${3 * S}px ${14 * S}px rgba(0,0,0,.55), 0 0 ${3 * S}px rgba(0,0,0,.5)`;
  const accent = cfg.highlightColor || brand.colors.pinkBox;
  const emphColor = cfg.emphasisColor || brand.colors.cream;

  return (
    <AbsoluteFill>
      <div
        style={{
          position: 'absolute', left: 60 * S, right: 60 * S, top: cfg.y * S,
          transform: `translateY(-50%) scale(${pop})`, textAlign: 'center',
          fontFamily: `"${font}"`, fontSize: size, lineHeight: 1.18, color: cfg.color || '#fff',
          fontWeight: cfg.weight || 400, fontStyle: cfg.italic ? 'italic' : 'normal',
          letterSpacing: cfg.tracking || 0,
        }}
      >
        {p.words.map((w: any, i: number) => {
          const active = t >= w.s && (i === p.words.length - 1 || t < p.words[i + 1].s);
          const boxed = cfg.style !== 'word' && cfg.highlight === 'box' && active;
          return (
            <span
              key={i}
              style={{
                display: 'inline-block', margin: `0 ${0.03 * size}px`, padding: `0 ${0.1 * size}px`,
                borderRadius: 0.16 * size,
                background: boxed ? accent : 'transparent',
                color: w.emph || (cfg.highlight === 'color' && active) ? emphColor : undefined,
                textShadow: boxed ? 'none' : shadow,
              }}
            >
              {cfg.uppercase ? w.text.toUpperCase() : w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
