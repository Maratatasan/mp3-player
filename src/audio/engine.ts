import SignalsmithStretch, { type StretchNode } from 'signalsmith-stretch';
import type { PlaybackEngine } from './playbackEngine';

// Signalsmith-stretch playback: highest quality tempo change. Output goes
// straight to the context destination (single clock — never route it through
// a MediaStream element, that causes pitch wobble). A silent looping element
// runs alongside so the OS treats the tab as media playback (background
// survival on Android + a Media Session anchor). Not used on iOS, which
// suspends Web Audio on screen lock.
export class WorkletEngine implements PlaybackEngine {
  private context: AudioContext;
  private stretch: StretchNode | null = null;
  private currentRate = 1;
  private durationSeconds = 0;
  private isActive = false;
  private onEnded: (() => void) | null = null;
  private endWatcher: number | null = null;
  private keepAliveElement: HTMLAudioElement;

  constructor(context: AudioContext) {
    this.context = context;
    this.keepAliveElement = new Audio('/silence.mp3');
    this.keepAliveElement.loop = true;
  }

  setOnEnded(callback: () => void): void {
    this.onEnded = callback;
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

  async setTrack(bytes: ArrayBuffer, rate: number): Promise<number> {
    // decodeAudioData detaches its input — callers keep the original bytes.
    const buffer = await this.context.decodeAudioData(bytes.slice(0));
    const stretch = await this.ensureStretch();
    this.stopEndWatcher();
    this.isActive = false;
    this.keepAliveElement.pause();
    await stretch.stop();
    await stretch.dropBuffers();
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      channels.push(buffer.getChannelData(channel));
    }
    await stretch.addBuffers(channels);
    this.currentRate = rate;
    this.durationSeconds = buffer.duration;
    await stretch.schedule({ input: 0, rate, active: false });
    return buffer.duration;
  }

  async play(fromSeconds?: number): Promise<void> {
    // Kick the keep-alive synchronously so it stays inside the user gesture
    // that (first) triggered playback.
    this.keepAliveElement.play().catch(() => {
      // Keep-alive rejection only affects background survival, not audio.
    });
    const stretch = await this.ensureStretch();
    if (this.context.state === 'suspended') {
      await this.context.resume();
    }
    await stretch.schedule({
      active: true,
      rate: this.currentRate,
      ...(fromSeconds === undefined ? {} : { input: fromSeconds }),
    });
    this.isActive = true;
    this.startEndWatcher();
  }

  pause(): void {
    this.isActive = false;
    this.stopEndWatcher();
    void this.stretch?.schedule({ active: false });
    this.keepAliveElement.pause();
  }

  seek(toSeconds: number): void {
    void this.stretch?.schedule({ input: toSeconds, rate: this.currentRate });
  }

  setRate(rate: number): void {
    this.currentRate = rate;
    void this.stretch?.schedule({ rate });
  }

  positionSeconds(): number {
    return this.stretch?.inputTime ?? 0;
  }

  // The worklet has no `ended` event — watch the input position instead.
  private startEndWatcher(): void {
    this.stopEndWatcher();
    this.endWatcher = window.setInterval(() => {
      if (this.isActive && this.durationSeconds > 0 && this.positionSeconds() >= this.durationSeconds) {
        this.isActive = false;
        this.stopEndWatcher();
        this.onEnded?.();
      }
    }, 200);
  }

  private stopEndWatcher(): void {
    if (this.endWatcher !== null) {
      clearInterval(this.endWatcher);
      this.endWatcher = null;
    }
  }
}
