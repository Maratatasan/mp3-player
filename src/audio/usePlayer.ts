import { useEffect, useRef, useState } from 'react';
import { AuthRequiredError, fetchTrackUrl, fetchTracks, storePassphrase } from '../api/client';
import { TempoEngine, prepareTrack, type LoadedTrack } from './engine';
import { cacheBpm, cacheBytes, getCachedBpm, getCachedBytes } from './trackCache';

export const DEFAULT_TARGET_BPM = 120;
export const MIN_TARGET_BPM = 60;
export const MAX_TARGET_BPM = 200;

const LAST_TRACK_STORAGE_KEY = 'mp3-player-last-track';
const TARGET_BPM_STORAGE_KEY = 'mp3-player-target-bpm';

function initialTargetBpm(): number {
  const stored = Number(localStorage.getItem(TARGET_BPM_STORAGE_KEY));
  if (Number.isFinite(stored) && stored >= MIN_TARGET_BPM && stored <= MAX_TARGET_BPM) {
    return stored;
  }
  return DEFAULT_TARGET_BPM;
}

export type QueueEntry = {
  key: string;
  title: string;
  artist: string;
  // null until the track has been loaded (or its BPM found in the cache)
  originalBpm: number | null;
};

// Listing titles look like "Artist - Track Title"; fall back to no artist.
function entryFromListing(key: string, listingTitle: string): QueueEntry {
  const separatorIndex = listingTitle.indexOf(' - ');
  if (separatorIndex === -1) {
    return { key, title: listingTitle, artist: '', originalBpm: null };
  }
  return {
    key,
    title: listingTitle.slice(separatorIndex + 3),
    artist: listingTitle.slice(0, separatorIndex),
    originalBpm: null,
  };
}

type PlayerSingleton = {
  engine: TempoEngine;
  context: AudioContext;
  entries: QueueEntry[];
};

// Module-level so React StrictMode's dev double-mount doesn't init twice.
let singletonPromise: Promise<PlayerSingleton> | null = null;

async function buildEntries(): Promise<QueueEntry[]> {
  const listing = await fetchTracks();
  return Promise.all(
    listing.map(async (remote) => {
      const entry = entryFromListing(remote.key, remote.title);
      const cachedBpm = await getCachedBpm(remote.key);
      return cachedBpm === undefined ? entry : { ...entry, originalBpm: cachedBpm };
    }),
  );
}

function initPlayer(): Promise<PlayerSingleton> {
  if (!singletonPromise) {
    singletonPromise = (async () => {
      const entries = await buildEntries();
      const context = new AudioContext();
      const engine = new TempoEngine(context);
      if (import.meta.env.DEV) {
        (window as unknown as { __tempoEngine?: TempoEngine }).__tempoEngine = engine;
      }
      return { engine, context, entries };
    })().catch((error: unknown) => {
      // Allow a retry (e.g. after the user enters the passphrase).
      singletonPromise = null;
      throw error;
    });
  }
  return singletonPromise;
}

// One in-flight/settled load per track key; decoded tracks stay in memory
// for the session, encoded bytes + BPM persist in IndexedDB across visits.
const loadedTracks = new Map<string, Promise<LoadedTrack>>();

function ensureLoaded(context: AudioContext, entry: QueueEntry): Promise<LoadedTrack> {
  const existing = loadedTracks.get(entry.key);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    let bytes = await getCachedBytes(entry.key);
    if (bytes === undefined) {
      const url = await fetchTrackUrl(entry.key);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch audio for ${entry.key}: ${response.status}`);
      }
      bytes = await response.arrayBuffer();
      await cacheBytes(entry.key, bytes);
    }
    const knownBpm = (await getCachedBpm(entry.key)) ?? null;
    // decodeAudioData detaches its input — hand it a copy, keep the original.
    const track = await prepareTrack(context, entry, bytes.slice(0), knownBpm);
    if (knownBpm === null) {
      await cacheBpm(entry.key, track.originalBpm);
    }
    return track;
  })().catch((error: unknown) => {
    loadedTracks.delete(entry.key);
    throw error;
  });
  loadedTracks.set(entry.key, promise);
  return promise;
}

export type PlayerState = {
  isLoading: boolean;
  loadError: string | null;
  needsPassphrase: boolean;
  submitPassphrase: (passphrase: string) => void;
  queue: QueueEntry[];
  trackIndex: number;
  currentTrack: LoadedTrack | null;
  isTrackLoading: boolean;
  isPlaying: boolean;
  positionSeconds: number;
  targetBpm: number;
  isOriginalTempo: boolean;
  selectTrack: (index: number) => void;
  playPause: () => void;
  next: () => void;
  back: () => void;
  seek: (seconds: number) => void;
  setTargetBpm: (bpm: number) => void;
  toggleOriginalTempo: () => void;
  refreshLibrary: () => Promise<number>;
};

function rateFor(originalBpm: number, targetBpm: number, isOriginalTempo: boolean): number {
  return isOriginalTempo ? 1 : targetBpm / originalBpm;
}

export function usePlayer(): PlayerState {
  const engineRef = useRef<TempoEngine | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [trackIndex, setTrackIndex] = useState(0);
  const [currentTrack, setCurrentTrack] = useState<LoadedTrack | null>(null);
  const [isTrackLoading, setIsTrackLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [targetBpm, setTargetBpmState] = useState(initialTargetBpm);
  const [isOriginalTempo, setIsOriginalTempo] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initPlayer()
      .then(({ engine, context, entries }) => {
        if (cancelled) {
          return;
        }
        engineRef.current = engine;
        contextRef.current = context;
        setQueue(entries);
        // Resume on the track that was playing before the last refresh.
        const lastKey = localStorage.getItem(LAST_TRACK_STORAGE_KEY);
        const lastIndex = entries.findIndex((queued) => queued.key === lastKey);
        if (lastIndex > 0) {
          setTrackIndex(lastIndex);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof AuthRequiredError) {
          setNeedsPassphrase(true);
        } else {
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  // Load the active track (and prefetch the next) whenever the selection
  // or the queue changes.
  useEffect(() => {
    const engine = engineRef.current;
    const context = contextRef.current;
    const entry = queue[trackIndex];
    if (!engine || !context || !entry) {
      return;
    }
    let cancelled = false;
    setPositionSeconds(0);
    setCurrentTrack(null);
    setIsTrackLoading(true);
    localStorage.setItem(LAST_TRACK_STORAGE_KEY, entry.key);
    ensureLoaded(context, entry)
      .then(async (track) => {
        if (cancelled) {
          return;
        }
        await engine.setTrack(track, rateFor(track.originalBpm, targetBpm, isOriginalTempo));
        if (cancelled) {
          return;
        }
        setCurrentTrack(track);
        setIsTrackLoading(false);
        setQueue((previous) =>
          previous.map((queued) =>
            queued.key === track.key && queued.originalBpm === null
              ? { ...queued, originalBpm: track.originalBpm }
              : queued,
          ),
        );
        if (isPlaying) {
          void engine.play(0);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setIsTrackLoading(false);
          setLoadError(error instanceof Error ? error.message : String(error));
        }
      });

    const nextEntry = queue[(trackIndex + 1) % queue.length];
    if (nextEntry && nextEntry.key !== entry.key) {
      ensureLoaded(context, nextEntry)
        .then((track) => {
          if (!cancelled) {
            setQueue((previous) =>
              previous.map((queued) =>
                queued.key === track.key && queued.originalBpm === null
                  ? { ...queued, originalBpm: track.originalBpm }
                  : queued,
              ),
            );
          }
        })
        .catch(() => {
          // Prefetch failures surface when the track is actually selected.
        });
    }

    return () => {
      cancelled = true;
    };
    // targetBpm / tempo-mode / isPlaying changes are handled by their own
    // paths; this effect must only run on selection or queue-shape changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackIndex, queue.length, loadAttempt]);

  useEffect(() => {
    if (!isPlaying || !currentTrack) {
      return;
    }
    const interval = setInterval(() => {
      const engine = engineRef.current;
      if (!engine) {
        return;
      }
      const position = engine.positionSeconds();
      if (position >= currentTrack.durationSeconds) {
        setPositionSeconds(0);
        setTrackIndex((prev) => (prev + 1) % queue.length);
      } else {
        setPositionSeconds(position);
      }
    }, 200);
    return () => {
      clearInterval(interval);
    };
  }, [isPlaying, currentTrack, queue.length]);

  function selectTrack(index: number) {
    setTrackIndex(index);
  }

  function playPause() {
    const engine = engineRef.current;
    if (isPlaying) {
      void engine?.pause();
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
    // If the track is still loading, playback starts when the load effect
    // finishes; otherwise start now.
    if (engine && currentTrack) {
      void engine.play();
    }
  }

  function next() {
    if (queue.length > 0) {
      setTrackIndex((prev) => (prev + 1) % queue.length);
    }
  }

  function back() {
    if (queue.length === 0) {
      return;
    }
    if (positionSeconds > 3 && currentTrack) {
      setPositionSeconds(0);
      void engineRef.current?.seek(0);
      return;
    }
    setTrackIndex((prev) => (prev - 1 + queue.length) % queue.length);
  }

  function seek(seconds: number) {
    if (!currentTrack) {
      return;
    }
    setPositionSeconds(seconds);
    void engineRef.current?.seek(seconds);
  }

  // Adjusting the target tempo always re-engages the lock.
  function setTargetBpm(bpm: number) {
    const clamped = Math.min(MAX_TARGET_BPM, Math.max(MIN_TARGET_BPM, bpm));
    setTargetBpmState(clamped);
    localStorage.setItem(TARGET_BPM_STORAGE_KEY, String(clamped));
    setIsOriginalTempo(false);
    if (currentTrack) {
      void engineRef.current?.setRate(rateFor(currentTrack.originalBpm, clamped, false));
    }
  }

  function toggleOriginalTempo() {
    const nextIsOriginal = !isOriginalTempo;
    setIsOriginalTempo(nextIsOriginal);
    if (currentTrack) {
      void engineRef.current?.setRate(
        rateFor(currentTrack.originalBpm, targetBpm, nextIsOriginal),
      );
    }
  }

  // Re-fetches the bucket listing (e.g. after a cloud sync) without touching
  // playback. Returns how many tracks were added. Keeps the current track
  // selected by key.
  async function refreshLibrary(): Promise<number> {
    const entries = await buildEntries();
    const currentKey = queue[trackIndex]?.key;
    const added = entries.length - queue.length;
    setQueue(entries);
    const newIndex = entries.findIndex((queued) => queued.key === currentKey);
    setTrackIndex(newIndex === -1 ? 0 : newIndex);
    return added;
  }

  function submitPassphrase(passphrase: string) {
    storePassphrase(passphrase);
    setNeedsPassphrase(false);
    setLoadError(null);
    setLoadAttempt((attempt) => attempt + 1);
  }

  return {
    isLoading: queue.length === 0 && loadError === null && !needsPassphrase,
    loadError,
    needsPassphrase,
    submitPassphrase,
    queue,
    trackIndex,
    currentTrack,
    isTrackLoading,
    isPlaying,
    positionSeconds,
    targetBpm,
    isOriginalTempo,
    selectTrack,
    playPause,
    next,
    back,
    seek,
    setTargetBpm,
    toggleOriginalTempo,
    refreshLibrary,
  };
}
