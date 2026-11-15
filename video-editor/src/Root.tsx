import React from 'react';
import { Composition } from 'remotion';
import { Edit, EditProps } from './Edit';
import { normCuts, totalFrames } from '../shared/time.js';
import './fonts';

const empty: EditProps = {
  storyboard: { source: { file: '', width: 1080, height: 1920, fps: 30, duration: 1 }, beats: [] },
  words: [],
  brand: {},
};

export const Root: React.FC = () => (
  <Composition
    id="Edit"
    component={Edit as any}
    defaultProps={empty as any}
    width={1080}
    height={1920}
    fps={30}
    durationInFrames={30}
    calculateMetadata={({ props }: any) => {
      const s = props.storyboard.source;
      return {
        width: s.width,
        height: s.height,
        fps: s.fps,
        durationInFrames: Math.max(1, totalFrames(normCuts(props.storyboard))),
      };
    }}
  />
);
