import { useEffect, useRef, useState } from 'react';
import { AuthRequiredError, fetchTrackUrl, fetchTracks, storePassphrase } from '../api/client';
import { TempoEngine, loadTrack, type LoadedTrack, type TrackSource } from './engine';

export const DEFAULT_TARGET_BPM = 120;
export const MIN_TARGET_BPM = 60;
export const MAX_TARGET_BPM = 200;

type PlayerSingleton = {
  engine: TempoEngine;
  tracks: LoadedTrack[];
};

// Listing titles look like "Artist - Track Title"; fall back to no artist.
function sourceFromListing(key: string, listingTitle: string, url: string): TrackSource {
  const separatorIndex = listingTitle.indexOf(' - ');
  if (separatorIndex === -1) {
    return { key, title: listingTitle, artist: '', url };
  }
  return {
    key,
    title: listingTitle.slice(separatorIndex + 3),
    artist: listingTitle.slice(0, separatorIndex),
    url,
  };
}

// Module-level so React StrictMode's dev double-mount doesn't decode everything twice.
let singletonPromise: Promise<PlayerSingleton> | null = null;

function initPlayer(): Promise<PlayerSingleton> {
  if (!singletonPromise) {
    singletonPromise = (async () => {
      const listing = await fetchTracks();
      const context = new AudioContext();
      const tracks = await Promise.all(
        listing.map(async (remote) => {
          const url = await fetchTrackUrl(remote.key);
          return loadTrack(context, sourceFromListing(remote.key, remote.title, url));
        }),
      );
      const engine = new TempoEngine(context);
      if (import.meta.env.DEV) {
        (window as unknown as { __tempoEngine?: TempoEngine }).__tempoEngine = engine;
      }
      return { engine, tracks };
    })().catch((error: unknown) => {
      // Allow a retry (e.g. after the user enters the passphrase).
      singletonPromise = null;
      throw error;
    });
  }
  return singletonPromise;
}

export type PlayerState = {
  isLoading: boolean;
  loadError: string | null;
  needsPassphrase: boolean;
  submitPassphrase: (passphrase: string) => void;
  tracks: LoadedTrack[];
  trackIndex: number;
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
};

function rateFor(track: LoadedTrack, targetBpm: number, isOriginalTempo: boolean): number {
  return isOriginalTempo ? 1 : targetBpm / track.originalBpm;
}

export function usePlayer(): PlayerState {
  const engineRef = useRef<TempoEngine | null>(null);
  const [tracks, setTracks] = useState<LoadedTrack[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsPassphrase, setNeedsPassphrase] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [trackIndex, setTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [targetBpm, setTargetBpmState] = useState(DEFAULT_TARGET_BPM);
  const [isOriginalTempo, setIsOriginalTempo] = useState(false);

  const track: LoadedTrack | undefined = tracks[trackIndex];

  useEffect(() => {
    let cancelled = false;
    initPlayer()
      .then(({ engine, tracks: loaded }) => {
        if (cancelled) {
          return;
        }
        engineRef.current = engine;
        setTracks(loaded);
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

  useEffect(() => {
    if (!isPlaying) {
      return;
    }
    const interval = setInterval(() => {
      const engine = engineRef.current;
      if (!engine || !track) {
        return;
      }
      const position = engine.positionSeconds();
      if (position >= track.durationSeconds) {
        setPositionSeconds(0);
        setTrackIndex((prev) => (prev + 1) % tracks.length);
      } else {
        setPositionSeconds(position);
      }
    }, 200);
    return () => {
      clearInterval(interval);
    };
  }, [isPlaying, track, tracks.length]);

  // (Re)load the engine buffer whenever the active track changes.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine || !track) {
      return;
    }
    let cancelled = false;
    setPositionSeconds(0);
    engine.setTrack(track, rateFor(track, targetBpm, isOriginalTempo)).then(() => {
      if (!cancelled && isPlaying) {
        void engine.play(0);
      }
    });
    return () => {
      cancelled = true;
    };
    // targetBpm and isPlaying changes are handled by their own paths; this
    // effect must only run on track identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  function selectTrack(index: number) {
    setTrackIndex(index);
  }

  function playPause() {
    const engine = engineRef.current;
    if (!engine || !track) {
      return;
    }
    if (isPlaying) {
      void engine.pause();
      setIsPlaying(false);
    } else {
      void engine.play();
      setIsPlaying(true);
    }
  }

  function next() {
    if (tracks.length > 0) {
      setTrackIndex((prev) => (prev + 1) % tracks.length);
    }
  }

  function back() {
    const engine = engineRef.current;
    if (!engine || tracks.length === 0) {
      return;
    }
    if (positionSeconds > 3) {
      setPositionSeconds(0);
      void engine.seek(0);
      return;
    }
    setTrackIndex((prev) => (prev - 1 + tracks.length) % tracks.length);
  }

  function seek(seconds: number) {
    setPositionSeconds(seconds);
    void engineRef.current?.seek(seconds);
  }

  // Adjusting the target tempo always re-engages the lock.
  function setTargetBpm(bpm: number) {
    const clamped = Math.min(MAX_TARGET_BPM, Math.max(MIN_TARGET_BPM, bpm));
    setTargetBpmState(clamped);
    setIsOriginalTempo(false);
    if (track) {
      void engineRef.current?.setRate(rateFor(track, clamped, false));
    }
  }

  function toggleOriginalTempo() {
    const nextIsOriginal = !isOriginalTempo;
    setIsOriginalTempo(nextIsOriginal);
    if (track) {
      void engineRef.current?.setRate(rateFor(track, targetBpm, nextIsOriginal));
    }
  }

  function submitPassphrase(passphrase: string) {
    storePassphrase(passphrase);
    setNeedsPassphrase(false);
    setLoadError(null);
    setLoadAttempt((attempt) => attempt + 1);
  }

  return {
    isLoading: tracks.length === 0 && loadError === null && !needsPassphrase,
    loadError,
    needsPassphrase,
    submitPassphrase,
    tracks,
    trackIndex,
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
  };
}
