import SignalsmithStretch from 'signalsmith-stretch';
import type { PlaybackEngine } from './playbackEngine';
import { encodeWav } from './wav';

// iOS playback engine: Signalsmith quality AND lock-screen survival.
// The stretch runs OFFLINE (OfflineAudioContext renders faster than
// realtime), and a plain <audio> element plays the rendered WAV at 1.0x —
// iOS never suspends an honestly-playing media element. Tempo changes
// re-render in the background (debounced) and swap at the same position.
// The element's timeline is OUTPUT time (input/rate); this class converts
// so callers only ever see track-seconds.

const RERENDER_DEBOUNCE_MS = 700;

type RenderResult = {
  url: string;
  rate: number;
};

async function renderStretched(
  source: AudioBuffer,
  rate: number,
): Promise<string> {
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
  const rendered = await offline.startRendering();
  return URL.createObjectURL(encodeWav(rendered));
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
  private sourceBuffer: AudioBuffer | null = null;
  private currentBytes: ArrayBuffer | null = null;
  private rerenderTimer: number | null = null;
  private renderGeneration = 0;
  private onRendering: ((isRendering: boolean) => void) | null = null;
  // Pre-rendered next tracks, keyed by bytes identity + rate.
  private prepared = new Map<ArrayBuffer, RenderResult>();

  constructor() {
    this.element = new Audio();
  }

  setOnEnded(callback: () => void): void {
    this.element.onended = callback;
  }

  setOnRenderingChange(callback: (isRendering: boolean) => void): void {
    this.onRendering = callback;
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

  async setTrack(bytes: ArrayBuffer, rate: number): Promise<number> {
    this.cancelPendingRerender();
    this.targetRate = rate;
    this.sourceBuffer = await decode(bytes);
    this.currentBytes = bytes;

    const prepared = this.prepared.get(bytes);
    this.prepared.delete(bytes);
    let url: string;
    if (prepared && prepared.rate === rate) {
      url = prepared.url;
    } else {
      if (prepared) {
        URL.revokeObjectURL(prepared.url);
      }
      this.onRendering?.(true);
      try {
        url = await renderStretched(this.sourceBuffer, rate);
      } finally {
        this.onRendering?.(false);
      }
    }
    this.renderGeneration += 1;
    this.swapSource(url, rate, 0, false);
    this.element.pause();
    return this.sourceBuffer.duration;
  }

  // Renders an upcoming track ahead of time so track changes (including
  // locked-screen auto-advance) are a source swap, not a live render.
  async prepare(bytes: ArrayBuffer, rate: number): Promise<void> {
    const existing = this.prepared.get(bytes);
    if (existing?.rate === rate || bytes === this.currentBytes) {
      return;
    }
    if (existing) {
      URL.revokeObjectURL(existing.url);
      this.prepared.delete(bytes);
    }
    const source = await decode(bytes);
    const url = await renderStretched(source, rate);
    // Keep the cache tiny — only the most recent preparation.
    for (const [key, value] of this.prepared) {
      URL.revokeObjectURL(value.url);
      this.prepared.delete(key);
    }
    this.prepared.set(bytes, { url, rate });
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
    if (rate === this.appliedRate || !this.sourceBuffer) {
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
    const source = this.sourceBuffer;
    if (!source) {
      return;
    }
    const rate = this.targetRate;
    const generation = this.renderGeneration;
    this.onRendering?.(true);
    try {
      const url = await renderStretched(source, rate);
      // A track change or newer render superseded this one.
      if (generation !== this.renderGeneration || rate !== this.targetRate) {
        URL.revokeObjectURL(url);
        return;
      }
      const position = this.positionSeconds();
      const resume = !this.element.paused;
      this.swapSource(url, rate, position, resume);
    } finally {
      this.onRendering?.(false);
    }
  }
}
