import { Composition } from 'remotion';
import { ChonkFu, totalFrames, FPS } from './Video';

export const Root = () => (
  <Composition id="ChonkFu" component={ChonkFu} durationInFrames={totalFrames} fps={FPS} width={1920} height={1080} />
);
