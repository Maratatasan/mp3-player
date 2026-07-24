import { del, get, set } from 'idb-keyval';

// Persistent cache of tempo-rendered audio, so page reloads (notably iOS
// evicting the app) don't force a re-render. Entries are AAC/Opus encoded
// with the browser's native WebCodecs encoder (~150x realtime, verified on
// iPhone + desktop): ~3.5 MB per track instead of ~30 MB as WAV. LRU-capped.
// This cache is an accelerator, never a source of truth — every read
// failure silently falls back to a live render.

const INDEX_KEY = 'render-index';
const MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const BITRATE = 160_000;

type StoredChunk = {
  data: ArrayBuffer;
  timestamp: number;
  duration: number | undefined;
  type: 'key' | 'delta';
};

type StoredRender = {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description: ArrayBuffer | null;
  chunks: StoredChunk[];
  sourceDurationSeconds: number;
};

type IndexEntry = {
  sizeBytes: number;
  lastUsed: number;
};

export type CachedRender = {
  buffer: AudioBuffer;
  sourceDurationSeconds: number;
};

function cacheKey(trackKey: string, rate: number): string {
  return `render:${trackKey}@${rate.toFixed(4)}`;
}

function isSupported(): boolean {
  return typeof AudioEncoder !== 'undefined' && typeof AudioDecoder !== 'undefined';
}

async function readIndex(): Promise<Record<string, IndexEntry>> {
  return (await get<Record<string, IndexEntry>>(INDEX_KEY)) ?? {};
}

async function pickCodec(sampleRate: number): Promise<string | null> {
  const aac = await AudioEncoder.isConfigSupported({
    codec: 'mp4a.40.2',
    sampleRate,
    numberOfChannels: 2,
    bitrate: BITRATE,
  });
  if (aac.supported) {
    return 'mp4a.40.2';
  }
  const opus = await AudioEncoder.isConfigSupported({
    codec: 'opus',
    sampleRate,
    numberOfChannels: 2,
    bitrate: BITRATE,
  });
  return opus.supported ? 'opus' : null;
}

function toArrayBuffer(source: AllowSharedBufferSource): ArrayBuffer {
  if (source instanceof ArrayBuffer) {
    return source.slice(0);
  }
  const view = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

export async function saveRender(
  trackKey: string,
  rate: number,
  rendered: AudioBuffer,
  sourceDurationSeconds: number,
): Promise<void> {
  if (!isSupported()) {
    return;
  }
  const codec = await pickCodec(rendered.sampleRate);
  if (codec === null) {
    return;
  }
  const chunks: StoredChunk[] = [];
  let description: ArrayBuffer | null = null;
  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const data = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        data,
        timestamp: chunk.timestamp,
        duration: chunk.duration ?? undefined,
        type: chunk.type,
      });
      if (metadata?.decoderConfig?.description) {
        description = toArrayBuffer(metadata.decoderConfig.description);
      }
    },
    error: () => {},
  });
  encoder.configure({
    codec,
    sampleRate: rendered.sampleRate,
    numberOfChannels: 2,
    bitrate: BITRATE,
  });
  const framesPerPush = rendered.sampleRate;
  const left = rendered.getChannelData(0);
  const right = rendered.numberOfChannels > 1 ? rendered.getChannelData(1) : left;
  for (let offset = 0; offset < rendered.length; offset += framesPerPush) {
    const frames = Math.min(framesPerPush, rendered.length - offset);
    const planar = new Float32Array(frames * 2);
    planar.set(left.subarray(offset, offset + frames), 0);
    planar.set(right.subarray(offset, offset + frames), frames);
    encoder.encode(
      new AudioData({
        format: 'f32-planar',
        sampleRate: rendered.sampleRate,
        numberOfFrames: frames,
        numberOfChannels: 2,
        timestamp: (offset / rendered.sampleRate) * 1_000_000,
        data: planar,
      }),
    );
  }
  await encoder.flush();
  encoder.close();

  const record: StoredRender = {
    codec,
    sampleRate: rendered.sampleRate,
    numberOfChannels: 2,
    description,
    chunks,
    sourceDurationSeconds,
  };
  const sizeBytes = chunks.reduce((total, chunk) => total + chunk.data.byteLength, 0);
  const key = cacheKey(trackKey, rate);
  await set(key, record);

  const index = await readIndex();
  index[key] = { sizeBytes, lastUsed: Date.now() };
  // Evict least-recently-used entries beyond the cap.
  let total = Object.values(index).reduce((sum, entry) => sum + entry.sizeBytes, 0);
  const byAge = Object.entries(index).sort((a, b) => a[1].lastUsed - b[1].lastUsed);
  for (const [staleKey] of byAge) {
    if (total <= MAX_TOTAL_BYTES || staleKey === key) {
      continue;
    }
    total -= index[staleKey].sizeBytes;
    delete index[staleKey];
    await del(staleKey);
  }
  await set(INDEX_KEY, index);
}

export type RenderStats = {
  entries: number;
  totalMB: number;
};

export async function getRenderStats(): Promise<RenderStats> {
  const index = await readIndex();
  const values = Object.values(index);
  return {
    entries: values.length,
    totalMB: values.reduce((sum, entry) => sum + entry.sizeBytes, 0) / 1e6,
  };
}

export async function clearRenders(): Promise<void> {
  const { keys } = await import('idb-keyval');
  const allKeys = await keys();
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith('render:')) {
      await del(key);
    }
  }
  await del(INDEX_KEY);
}

export async function loadRender(trackKey: string, rate: number): Promise<CachedRender | null> {
  if (!isSupported()) {
    return null;
  }
  try {
    const key = cacheKey(trackKey, rate);
    const record = await get<StoredRender>(key);
    if (!record) {
      return null;
    }
    const outputs: AudioData[] = [];
    const decoder = new AudioDecoder({
      output: (data) => {
        outputs.push(data);
      },
      error: () => {},
    });
    decoder.configure({
      codec: record.codec,
      sampleRate: record.sampleRate,
      numberOfChannels: record.numberOfChannels,
      ...(record.description ? { description: record.description } : {}),
    });
    for (const chunk of record.chunks) {
      decoder.decode(
        new EncodedAudioChunk({
          data: chunk.data,
          timestamp: chunk.timestamp,
          ...(chunk.duration === undefined ? {} : { duration: chunk.duration }),
          type: chunk.type,
        }),
      );
    }
    await decoder.flush();
    decoder.close();

    const totalFrames = outputs.reduce((sum, data) => sum + data.numberOfFrames, 0);
    if (totalFrames === 0) {
      return null;
    }
    const buffer = new AudioBuffer({
      length: totalFrames,
      numberOfChannels: record.numberOfChannels,
      sampleRate: record.sampleRate,
    });
    let offset = 0;
    for (const data of outputs) {
      for (let channel = 0; channel < record.numberOfChannels; channel += 1) {
        const plane = new Float32Array(data.numberOfFrames);
        data.copyTo(plane, { planeIndex: channel, format: 'f32-planar' });
        buffer.copyToChannel(plane, channel, offset);
      }
      offset += data.numberOfFrames;
      data.close();
    }

    const index = await readIndex();
    if (index[key]) {
      index[key].lastUsed = Date.now();
      await set(INDEX_KEY, index);
    }
    return { buffer, sourceDurationSeconds: record.sourceDurationSeconds };
  } catch {
    // Any failure means "cache miss" — the caller renders live.
    return null;
  }
}
