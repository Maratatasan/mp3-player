import { get, set } from 'idb-keyval';

// Persists encoded audio bytes (~3 MB/track) and detected BPM per track key,
// so each track downloads and gets analyzed at most once per device.
// Decoded AudioBuffers are deliberately NOT cached — 10x the size.

function bytesKey(trackKey: string): string {
  return `bytes:${trackKey}`;
}

function bpmKey(trackKey: string): string {
  return `bpm:${trackKey}`;
}

export async function getCachedBytes(trackKey: string): Promise<ArrayBuffer | undefined> {
  return get<ArrayBuffer>(bytesKey(trackKey));
}

export async function cacheBytes(trackKey: string, bytes: ArrayBuffer): Promise<void> {
  await set(bytesKey(trackKey), bytes);
}

export async function getCachedBpm(trackKey: string): Promise<number | undefined> {
  return get<number>(bpmKey(trackKey));
}

export async function cacheBpm(trackKey: string, bpm: number): Promise<void> {
  await set(bpmKey(trackKey), bpm);
}
