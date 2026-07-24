// Contract both playback engines fulfill. Two implementations exist because
// no single one wins everywhere:
// - WorkletEngine (engine.ts): Signalsmith stretch via Web Audio. Best sound
//   quality, but iOS suspends Web Audio when the screen locks.
// - ElementEngine (elementEngine.ts): <audio> playbackRate + preservesPitch.
//   Survives iOS screen lock; stretch quality is the browser's own.
export type PlaybackEngine = {
  setOnEnded: (callback: () => void) => void;
  // Loads a track; resolves with its duration in seconds.
  setTrack: (bytes: ArrayBuffer, rate: number) => Promise<number>;
  play: (fromSeconds?: number) => Promise<void>;
  pause: () => void;
  seek: (toSeconds: number) => void;
  setRate: (rate: number) => void;
  positionSeconds: () => number;
};
