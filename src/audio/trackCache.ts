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

export type TrackCacheStats = {
  tracks: number;
  tracksMB: number;
  bpms: number;
};

// Walks idb-keyval's store with a cursor so sizes are summed one record at a
// time — never the whole 300MB library in memory at once.
export async function getTrackCacheStats(): Promise<TrackCacheStats> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('keyval-store');
    open.onerror = () => {
      reject(open.error ?? new Error('indexedDB open failed'));
    };
    open.onsuccess = () => {
      const db = open.result;
      const store = db.transaction('keyval').objectStore('keyval');
      let tracks = 0;
      let bytes = 0;
      let bpms = 0;
      const request = store.openCursor();
      request.onerror = () => {
        db.close();
        reject(request.error ?? new Error('cursor failed'));
      };
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          db.close();
          resolve({ tracks, tracksMB: bytes / 1e6, bpms });
          return;
        }
        const key = String(cursor.key);
        if (key.startsWith('bytes:')) {
          tracks += 1;
          bytes += (cursor.value as ArrayBuffer).byteLength ?? 0;
        } else if (key.startsWith('bpm:')) {
          bpms += 1;
        }
        cursor.continue();
      };
    };
  });
}

export async function clearTrackCache(): Promise<void> {
  const { keys, del } = await import('idb-keyval');
  const allKeys = await keys();
  for (const key of allKeys) {
    if (typeof key === 'string' && (key.startsWith('bytes:') || key.startsWith('bpm:'))) {
      await del(key);
    }
  }
}
