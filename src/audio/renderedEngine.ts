import SignalsmithStretch from 'signalsmith-stretch';
import type { PlaybackEngine } from './playbackEngine';
import { loadRender, saveRender } from './renderCache';
import { encodeWav } from './wav';

// iOS playback engine: Signalsmith quality AND lock-screen survival.
// The stretch runs OFFLINE (OfflineAudioContext renders faster than
// realtime), and a plain <audio> element plays the rendered WAV at 1.0x —
// iOS never suspends an honestly-playing media element. Tempo changes
// re-render in the background (debounced) and swap at the same position.
// Renders persist in an LRU IndexedDB cache (AAC via WebCodecs), so a page
// reload — iOS loves evicting background tabs — resumes without re-render.
// The element's timeline is OUTPUT time (input/rate); this class converts
// so callers only ever see track-seconds.

const RERENDER_DEBOUNCE_MS = 700;

type ReadyRender = {
  url: string;
  rate: number;
  sourceDurationSeconds: number;
};

async function renderStretched(source: AudioBuffer, rate: number): Promise<AudioBuffer> {
  const frames = Math.ceil((source.duration / rate) * source.sampleRate) + source.sampleRate;
  const offline = new OfflineAudioContext(2, frames, source.sampleRate);
  const stretch = await SignalsmithStretch(offline as unknown as AudioContext);
  stretch.connect(offline.destination);
  const channels: Float32Array[] = [];
  for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
    channels.push(source.getChannelData(channel));
  }
  await stretch.addBuffers(channels);
  await stretch.schedule({ input: 0, rate, active: true, output: 0 });
  return offline.startRendering();
}

async function decode(bytes: ArrayBuffer): Promise<AudioBuffer> {
  const context = new OfflineAudioContext(2, 1, 44100);
  return context.decodeAudioData(bytes.slice(0));
}

export class RenderedEngine implements PlaybackEngine {
  private element: HTMLAudioElement;
  // Rate the CURRENT element source was rendered at (position math uses this).
  private appliedRate = 1;
  // Rate the most recent setRate asked for (renders target this).
  private targetRate = 1;
  // Source bytes/key of the current track. The decoded buffer is NOT kept —
  // re-renders re-decode on demand, keeping resident memory small (less
  // reason for iOS to evict the page).
  private currentBytes: ArrayBuffer | null = null;
  private currentTrackKey: string | null = null;
  private rerenderTimer: number | null = null;
  private renderGeneration = 0;
  private onRendering: ((isRendering: boolean) => void) | null = null;
  // Pre-rendered upcoming track, keyed by bytes identity.
  private prepared = new Map<ArrayBuffer, ReadyRender>();

  constructor() {
    this.element = new Audio();
  }

  setOnEnded(callback: () => void): void {
    this.element.onended = callback;
  }

  setOnRenderingChange(callback: (isRendering: boolean) => void): void {
    this.onRendering = callback;
  }

  // Cache-first: persisted render → live render (which then populates the
  // cache in the background).
  private async obtainRender(
    bytes: ArrayBuffer,
    rate: number,
    trackKey: string | null,
  ): Promise<ReadyRender> {
    if (trackKey !== null) {
      const cached = await loadRender(trackKey, rate);
      if (cached) {
        return {
          url: URL.createObjectURL(encodeWav(cached.buffer)),
          rate,
          sourceDurationSeconds: cached.sourceDurationSeconds,
        };
      }
    }
    this.onRendering?.(true);
    try {
      const source = await decode(bytes);
      const rendered = await renderStretched(source, rate);
      if (trackKey !== null) {
        saveRender(trackKey, rate, rendered, source.duration).catch(() => {
          // Cache write failures are invisible; next load renders live.
        });
      }
      return {
        url: URL.createObjectURL(encodeWav(rendered)),
        rate,
        sourceDurationSeconds: source.duration,
      };
    } finally {
      this.onRendering?.(false);
    }
  }

  private swapSource(url: string, rate: number, positionTrackSeconds: number, resume: boolean) {
    const previousUrl = this.element.src;
    this.element.src = url;
    this.appliedRate = rate;
    this.element.currentTime = positionTrackSeconds / rate;
    if (resume) {
      this.element.play().catch(() => {
        // Autoplay rejection surfaces as silence; the next tap fixes it.
      });
    }
    if (previousUrl.startsWith('blob:')) {
      URL.revokeObjectURL(previousUrl);
    }
  }

  async setTrack(bytes: ArrayBuffer, rate: number, trackKey?: string): Promise<number> {
    this.cancelPendingRerender();
    this.targetRate = rate;
    this.currentBytes = bytes;
    this.currentTrackKey = trackKey ?? null;

    const prepared = this.prepared.get(bytes);
    this.prepared.delete(bytes);
    let ready: ReadyRender;
    if (prepared && prepared.rate === rate) {
      ready = prepared;
    } else {
      if (prepared) {
        URL.revokeObjectURL(prepared.url);
      }
      ready = await this.obtainRender(bytes, rate, this.currentTrackKey);
    }
    this.renderGeneration += 1;
    this.swapSource(ready.url, rate, 0, false);
    this.element.pause();
    return ready.sourceDurationSeconds;
  }

  // Renders an upcoming track ahead of time so track changes (including
  // locked-screen auto-advance) are a source swap, not a live render.
  async prepare(bytes: ArrayBuffer, rate: number, trackKey?: string): Promise<void> {
    const existing = this.prepared.get(bytes);
    if (existing?.rate === rate || bytes === this.currentBytes) {
      return;
    }
    if (existing) {
      URL.revokeObjectURL(existing.url);
      this.prepared.delete(bytes);
    }
    const ready = await this.obtainRender(bytes, rate, trackKey ?? null);
    // Keep the in-memory preparation cache tiny — most recent only.
    for (const [key, value] of this.prepared) {
      URL.revokeObjectURL(value.url);
      this.prepared.delete(key);
    }
    this.prepared.set(bytes, ready);
  }

  async play(fromSeconds?: number): Promise<void> {
    if (fromSeconds !== undefined) {
      this.element.currentTime = fromSeconds / this.appliedRate;
    }
    await this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  seek(toSeconds: number): void {
    this.element.currentTime = toSeconds / this.appliedRate;
  }

  setRate(rate: number): void {
    this.targetRate = rate;
    this.cancelPendingRerender();
    if (rate === this.appliedRate || this.currentBytes === null) {
      return;
    }
    // Debounced: the slider fires continuously; render once it settles.
    this.rerenderTimer = window.setTimeout(() => {
      this.rerenderTimer = null;
      void this.rerenderCurrent();
    }, RERENDER_DEBOUNCE_MS);
  }

  positionSeconds(): number {
    return this.element.currentTime * this.appliedRate;
  }

  private cancelPendingRerender(): void {
    if (this.rerenderTimer !== null) {
      clearTimeout(this.rerenderTimer);
      this.rerenderTimer = null;
    }
  }

  private async rerenderCurrent(): Promise<void> {
    const bytes = this.currentBytes;
    if (bytes === null) {
      return;
    }
    const rate = this.targetRate;
    const generation = this.renderGeneration;
    const ready = await this.obtainRender(bytes, rate, this.currentTrackKey);
    // A track change or newer render superseded this one.
    if (generation !== this.renderGeneration || rate !== this.targetRate) {
      URL.revokeObjectURL(ready.url);
      return;
    }
    const position = this.positionSeconds();
    const resume = !this.element.paused;
    this.swapSource(ready.url, rate, position, resume);
  }
}
