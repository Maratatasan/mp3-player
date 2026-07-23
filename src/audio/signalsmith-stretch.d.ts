declare module 'signalsmith-stretch' {
  export type StretchScheduleOptions = {
    output?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    loopStart?: number;
    loopEnd?: number;
  };

  export type StretchNode = AudioNode & {
    inputTime: number;
    schedule: (options: StretchScheduleOptions) => Promise<void>;
    start: (when?: number) => Promise<void>;
    stop: (when?: number) => Promise<void>;
    addBuffers: (channels: Float32Array[]) => Promise<number>;
    dropBuffers: (toSeconds?: number) => Promise<{ start: number; end: number } | void>;
    latency: () => Promise<number>;
    setUpdateInterval: (seconds: number, callback?: () => void) => Promise<void>;
  };

  export default function SignalsmithStretch(
    audioContext: AudioContext,
    channelOptions?: AudioWorkletNodeOptions,
  ): Promise<StretchNode>;
}
