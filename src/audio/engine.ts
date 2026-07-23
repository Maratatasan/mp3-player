import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch';
import { guess } from 'web-audio-beat-detector';
import type { TrackManifestEntry } from '../tracks';

export type LoadedTrack = TrackManifestEntry & {
  buffer: AudioBuffer;
  originalBpm: number;
  durationSeconds: number;
};

// Steady DJ-style material sits well inside the detector's default 90-180 window.
const TEMPO_SETTINGS = { minTempo: 90, maxTempo: 180 };

export async function loadTrack(
  context: AudioContext,
  entry: TrackManifestEntry,
): Promise<LoadedTrack> {
  const response = await fetch(entry.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${entry.url}: ${response.status}`);
  }
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const { bpm } = await guess(buffer, TEMPO_SETTINGS);
  return { ...entry, buffer, originalBpm: bpm, durationSeconds: buffer.duration };
}

export class TempoEngine {
  private context: AudioContext;
  private stretch: StretchNode | null = null;
  private currentRate = 1;

  constructor(context: AudioContext) {
    this.context = context;
  }

  private async ensureStretch(): Promise<StretchNode> {
    if (this.stretch) {
      return this.stretch;
    }
    const stretch = await SignalsmithStretch(this.context);
    stretch.connect(this.context.destination);
    await stretch.setUpdateInterval(0.05);
    this.stretch = stretch;
    return stretch;
  }

  async setTrack(track: LoadedTrack, rate: number): Promise<void> {
    const stretch = await this.ensureStretch();
    await stretch.stop();
    await stretch.dropBuffers();
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < track.buffer.numberOfChannels; channel += 1) {
      channels.push(track.buffer.getChannelData(channel));
    }
    await stretch.addBuffers(channels);
    this.currentRate = rate;
    await stretch.schedule({ input: 0, rate, active: false });
  }

  async play(fromSeconds?: number): Promise<void> {
    const stretch = await this.ensureStretch();
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    await stretch.schedule({
      active: true,
      rate: this.currentRate,
      ...(fromSeconds === undefined ? {} : { input: fromSeconds }),
    });
  }

  async pause(): Promise<void> {
    const stretch = await this.ensureStretch();
    await stretch.schedule({ active: false });
  }

  async seek(toSeconds: number): Promise<void> {
    const stretch = await this.ensureStretch();
    await stretch.schedule({ input: toSeconds, rate: this.currentRate });
  }

  async setRate(rate: number): Promise<void> {
    this.currentRate = rate;
    const stretch = await this.ensureStretch();
    await stretch.schedule({ rate });
  }

  positionSeconds(): number {
    return this.stretch?.inputTime ?? 0;
  }
}
