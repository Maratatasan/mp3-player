import { guess } from 'web-audio-beat-detector';
import type { PlaybackEngine } from './playbackEngine';

// iOS-only playback engine: a plain <audio> element with playbackRate +
// preservesPitch. Apple suspends Web Audio on screen lock, but keeps a media
// element playing — and Safari's native time-pitch algorithm is decent.
// Everywhere else the WorkletEngine (Signalsmith) is used: Chrome's native
// stretcher audibly glitches even at mild ratios (~0.95x).

export type TrackData = {
  key: string;
  title: string;
  artist: string;
  bytes: ArrayBuffer;
  originalBpm: number;
};

export type LoadedTrack = Omit<TrackData, 'bytes'> & {
  durationSeconds: number;
};

// Steady DJ-style material sits well inside the detector's default 90-180 window.
const TEMPO_SETTINGS = { minTempo: 90, maxTempo: 180 };

export async function detectBpm(context: AudioContext, bytes: ArrayBuffer): Promise<number> {
  const buffer = await context.decodeAudioData(bytes);
  const { bpm } = await guess(buffer, TEMPO_SETTINGS);
  return bpm;
}

export class ElementEngine implements PlaybackEngine {
  private element: HTMLAudioElement;
  private currentRate = 1;
  private objectUrl: string | null = null;

  constructor() {
    this.element = new Audio();
    this.element.preservesPitch = true;
    // iOS 17+ ignores playbackRate changes made while backgrounded (e.g. a
    // locked-screen auto-advance to a track with a different original BPM) —
    // re-assert whenever we come back to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.element.playbackRate = this.currentRate;
      }
    });
  }

  setOnEnded(callback: () => void): void {
    this.element.onended = callback;
  }

  // Loads the track into the element; resolves with its duration in seconds.
  async setTrack(bytes: ArrayBuffer, rate: number): Promise<number> {
    if (this.objectUrl !== null) {
      URL.revokeObjectURL(this.objectUrl);
    }
    this.objectUrl = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    this.element.src = this.objectUrl;
    await new Promise<void>((resolve, reject) => {
      this.element.onloadedmetadata = () => {
        resolve();
      };
      this.element.onerror = () => {
        reject(new Error('audio element failed to load track'));
      };
    });
    // A new src can reset the rate — apply after metadata is in.
    this.setRate(rate);
    return this.element.duration;
  }

  async play(fromSeconds?: number): Promise<void> {
    if (fromSeconds !== undefined) {
      this.element.currentTime = fromSeconds;
    }
    await this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  seek(toSeconds: number): void {
    this.element.currentTime = toSeconds;
  }

  setRate(rate: number): void {
    this.currentRate = rate;
    this.element.defaultPlaybackRate = rate;
    this.element.playbackRate = rate;
  }

  positionSeconds(): number {
    return this.element.currentTime;
  }
}
