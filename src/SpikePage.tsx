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

type CodecResult = {
  hasAudioEncoder: boolean;
  aacSupported: boolean;
  opusSupported: boolean;
  codecUsed: string | null;
  encodeMs: number;
  encodedKB: number;
  decodeMs: number;
  roundTripOk: boolean;
  error?: string;
};

// Can the browser's NATIVE encoder compress rendered audio (for the render
// cache), and decode it back? Tests WebCodecs AudioEncoder/AudioDecoder.
async function runCodecSpike(): Promise<CodecResult> {
  const result: CodecResult = {
    hasAudioEncoder: typeof AudioEncoder !== 'undefined',
    aacSupported: false,
    opusSupported: false,
    codecUsed: null,
    encodeMs: 0,
    encodedKB: 0,
    decodeMs: 0,
    roundTripOk: false,
  };
  try {
    if (!result.hasAudioEncoder) {
      return result;
    }
    const aac = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate: 44100,
      numberOfChannels: 2,
      bitrate: 160_000,
    });
    const opus = await AudioEncoder.isConfigSupported({
      codec: 'opus',
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: 160_000,
    });
    result.aacSupported = aac.supported === true;
    result.opusSupported = opus.supported === true;
    if (!result.aacSupported && !result.opusSupported) {
      return result;
    }
    const codec = result.aacSupported ? 'mp4a.40.2' : 'opus';
    const sampleRate = result.aacSupported ? 44100 : 48000;
    result.codecUsed = codec;

    // 30s of real audio, resampled to the codec's rate.
    const bytes = await loadFirstTrackBytes();
    const decodeContext = new OfflineAudioContext(2, 1, sampleRate);
    const source = await decodeContext.decodeAudioData(bytes.slice(0));
    const resampler = new OfflineAudioContext(2, RENDER_SECONDS * sampleRate, sampleRate);
    const node = resampler.createBufferSource();
    node.buffer = source;
    node.connect(resampler.destination);
    node.start();
    const pcm = await resampler.startRendering();

    const chunks: EncodedAudioChunk[] = [];
    let decoderConfig: AudioDecoderConfig | null = null;
    const encoder = new AudioEncoder({
      output: (chunk, metadata) => {
        chunks.push(chunk);
        if (metadata?.decoderConfig) {
          decoderConfig = metadata.decoderConfig;
        }
      },
      error: () => {},
    });
    encoder.configure({ codec, sampleRate, numberOfChannels: 2, bitrate: 160_000 });

    const encodeStart = performance.now();
    const framesPerPush = sampleRate;
    for (let offset = 0; offset < pcm.length; offset += framesPerPush) {
      const frames = Math.min(framesPerPush, pcm.length - offset);
      const planar = new Float32Array(frames * 2);
      planar.set(pcm.getChannelData(0).subarray(offset, offset + frames), 0);
      planar.set(pcm.getChannelData(1).subarray(offset, offset + frames), frames);
      encoder.encode(
        new AudioData({
          format: 'f32-planar',
          sampleRate,
          numberOfFrames: frames,
          numberOfChannels: 2,
          timestamp: (offset / sampleRate) * 1_000_000,
          data: planar,
        }),
      );
    }
    await encoder.flush();
    result.encodeMs = Math.round(performance.now() - encodeStart);
    result.encodedKB = Math.round(
      chunks.reduce((total, chunk) => total + chunk.byteLength, 0) / 1024,
    );

    // Round trip: a cache read must decode these chunks back to PCM.
    let decodedFrames = 0;
    const decoder = new AudioDecoder({
      output: (data) => {
        decodedFrames += data.numberOfFrames;
        data.close();
      },
      error: () => {},
    });
    decoder.configure(
      decoderConfig ?? { codec, sampleRate, numberOfChannels: 2 },
    );
    const decodeStart = performance.now();
    for (const chunk of chunks) {
      decoder.decode(chunk);
    }
    await decoder.flush();
    result.decodeMs = Math.round(performance.now() - decodeStart);
    result.roundTripOk = decodedFrames >= pcm.length * 0.95;
    return result;
  } catch (error) {
    result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return result;
  }
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
  const [codecResult, setCodecResult] = useState<CodecResult | null>(null);
  const [wavUrl, setWavUrl] = useState<string | null>(null);

  function startCodec() {
    setStatus('running codec spike — encode + decode 30s…');
    runCodecSpike()
      .then((outcome) => {
        setCodecResult(outcome);
        setStatus('done');
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'failed');
      });
  }

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
      <div className="flex gap-3">
        <button
          type="button"
          onClick={start}
          className="rounded-lg bg-emerald-400 px-6 py-3 font-semibold text-zinc-950"
        >
          Run render spike
        </button>
        <button
          type="button"
          onClick={startCodec}
          className="rounded-lg bg-sky-400 px-6 py-3 font-semibold text-zinc-950"
        >
          Run codec spike
        </button>
      </div>
      <p className="text-sm text-zinc-400">{status}</p>
      {result && (
        <pre className="rounded-lg bg-zinc-900 p-4 text-left text-sm">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
      {codecResult && (
        <pre className="rounded-lg bg-zinc-900 p-4 text-left text-sm">
          {JSON.stringify(codecResult, null, 2)}
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
