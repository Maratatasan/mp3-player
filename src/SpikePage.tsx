import { useState } from 'react';
import SignalsmithStretch from 'signalsmith-stretch';
import { fetchTrackUrl, fetchTracks } from './api/client';
import { getCachedBytes } from './audio/trackCache';

// Feasibility spike for iOS pre-rendering: does the Signalsmith worklet run
// inside an OfflineAudioContext, how fast does it render, and is the output
// real audio? Open the app with ?spike to use. Throwaway page.

const RENDER_SECONDS = 30;
const RATE = 120 / 128;

type SpikeResult = {
  supported: boolean;
  renderMs: number;
  timesRealtime: number;
  rms: number;
  error?: string;
};

function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const dataSize = frames * channels * bytesPerSample;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  function writeString(offset: number, text: string) {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  }
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame]));
      view.setInt16(offset, sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

async function loadFirstTrackBytes(): Promise<ArrayBuffer> {
  const listing = await fetchTracks();
  if (listing.length === 0) {
    throw new Error('library is empty');
  }
  const key = listing[0].key;
  const cached = await getCachedBytes(key);
  if (cached !== undefined) {
    return cached;
  }
  const url = await fetchTrackUrl(key);
  const response = await fetch(url);
  return response.arrayBuffer();
}

async function runSpike(): Promise<{ result: SpikeResult; wavUrl: string | null }> {
  try {
    const bytes = await loadFirstTrackBytes();
    const decodeContext = new AudioContext();
    const source = await decodeContext.decodeAudioData(bytes.slice(0));
    void decodeContext.close();

    const sampleRate = source.sampleRate;
    const offline = new OfflineAudioContext(2, RENDER_SECONDS * sampleRate, sampleRate);
    const stretch = await SignalsmithStretch(offline as unknown as AudioContext);
    stretch.connect(offline.destination);
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < source.numberOfChannels; channel += 1) {
      channels.push(source.getChannelData(channel));
    }
    await stretch.addBuffers(channels);
    await stretch.schedule({ input: 0, rate: RATE, active: true, output: 0 });

    const startedAt = performance.now();
    const rendered = await offline.startRendering();
    const renderMs = performance.now() - startedAt;

    let sumSquares = 0;
    const probe = rendered.getChannelData(0);
    for (let index = 0; index < probe.length; index += 1) {
      sumSquares += probe[index] * probe[index];
    }
    const rms = Math.sqrt(sumSquares / probe.length);

    const result: SpikeResult = {
      supported: rms > 0.001,
      renderMs: Math.round(renderMs),
      timesRealtime: Math.round((RENDER_SECONDS * 1000) / renderMs),
      rms: Number(rms.toFixed(4)),
    };
    const wavUrl = result.supported ? URL.createObjectURL(encodeWav(rendered)) : null;
    return { result, wavUrl };
  } catch (error) {
    return {
      result: {
        supported: false,
        renderMs: 0,
        timesRealtime: 0,
        rms: 0,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      },
      wavUrl: null,
    };
  }
}

export function SpikePage() {
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState<SpikeResult | null>(null);
  const [wavUrl, setWavUrl] = useState<string | null>(null);

  function start() {
    setStatus('running — decoding + rendering 30s at 0.94×…');
    runSpike()
      .then((outcome) => {
        setResult(outcome.result);
        setWavUrl(outcome.wavUrl);
        setStatus('done');
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'failed');
      });
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-zinc-950 p-6 text-zinc-100">
      <h1 className="text-xl font-semibold">Pre-render spike</h1>
      <p className="max-w-90 text-center text-sm text-zinc-400">
        Renders 30s of the first library track through Signalsmith in an
        OfflineAudioContext, then lets you play the result.
      </p>
      <button
        type="button"
        onClick={start}
        className="rounded-lg bg-emerald-400 px-6 py-3 font-semibold text-zinc-950"
      >
        Run spike
      </button>
      <p className="text-sm text-zinc-400">{status}</p>
      {result && (
        <pre className="rounded-lg bg-zinc-900 p-4 text-left text-sm">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      {wavUrl && (
        <audio controls src={wavUrl}>
          <track kind="captions" />
        </audio>
      )}
    </main>
  );
}
