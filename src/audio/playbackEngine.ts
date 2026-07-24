// Contract every playback engine fulfills. Implementations:
// - WorkletEngine (engine.ts): live Signalsmith stretch via Web Audio. Best
//   quality + instant tempo response, but iOS suspends Web Audio on screen
//   lock. Used on desktop + Android.
// - RenderedEngine (renderedEngine.ts): Signalsmith rendered OFFLINE, played
//   through an <audio> element. Same quality, survives iOS screen lock;
//   tempo changes cost a debounced re-render. Used on iOS.
// - ElementEngine (elementEngine.ts): <audio> playbackRate + preservesPitch.
//   Kept as a fallback — the browser's own stretcher audibly smears.
export type PlaybackEngine = {
  setOnEnded: (callback: () => void) => void;
  // Loads a track; resolves with its duration in seconds (track time).
  // trackKey enables engine-level persistent caches (e.g. rendered audio).
  setTrack: (bytes: ArrayBuffer, rate: number, trackKey?: string) => Promise<number>;
  play: (fromSeconds?: number) => Promise<void>;
  pause: () => void;
  seek: (toSeconds: number) => void;
  setRate: (rate: number) => void;
  positionSeconds: () => number;
  // Optional: pre-render/pre-load an upcoming track so switching is instant.
  prepare?: (bytes: ArrayBuffer, rate: number, trackKey?: string) => Promise<void>;
  // Optional: reports when a background render is in progress.
  setOnRenderingChange?: (callback: (isRendering: boolean) => void) => void;
};
