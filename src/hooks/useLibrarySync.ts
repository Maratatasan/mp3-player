import { useEffect, useState } from 'react';
import { fetchSyncStatus, triggerLibrarySync } from '../api/client';

const SYNC_STARTED_STORAGE_KEY = 'mp3-player-sync-started-at';
// The workflow reliably takes ~5 minutes; don't bother polling before that.
const SYNC_WAIT_MS = 5 * 60_000;
const POLL_INTERVAL_MS = 60_000;

export type SyncPhase = 'idle' | 'waiting' | 'polling';

export type LibrarySyncState = {
  phase: SyncPhase;
  // 0..1 fill of the initial wait window; only meaningful while 'waiting'
  progress: number;
  message: string;
  startSync: () => void;
};

function readStartedAt(): number | null {
  const stored = Number(localStorage.getItem(SYNC_STARTED_STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : null;
}

export function useLibrarySync(onFinished: () => void): LibrarySyncState {
  const [startedAt, setStartedAt] = useState<number | null>(readStartedAt);
  const [now, setNow] = useState(() => Date.now());
  const [message, setMessage] = useState('');

  const elapsed = startedAt === null ? 0 : now - startedAt;
  const phase: SyncPhase =
    startedAt === null ? 'idle' : elapsed < SYNC_WAIT_MS ? 'waiting' : 'polling';

  function finish(finalMessage: string) {
    localStorage.removeItem(SYNC_STARTED_STORAGE_KEY);
    setStartedAt(null);
    setMessage(finalMessage);
  }

  // Drive the fill bar while waiting.
  useEffect(() => {
    if (phase !== 'waiting') {
      return;
    }
    const interval = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [phase]);

  // After the wait window, ask GitHub whether the run is done — once a minute.
  useEffect(() => {
    if (phase !== 'polling') {
      return;
    }
    let cancelled = false;
    function check() {
      fetchSyncStatus()
        .then((status) => {
          if (cancelled) {
            return;
          }
          if (status.status === 'completed' || status.status === 'none') {
            const failed = status.status === 'completed' && status.conclusion !== 'success';
            finish(failed ? `sync finished: ${status.conclusion}` : 'sync finished');
            onFinished();
          }
        })
        .catch((error: unknown) => {
          if (!cancelled) {
            finish(error instanceof Error ? error.message : 'sync status check failed');
          }
        });
    }
    check();
    const interval = setInterval(check, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
    // finish/onFinished are stable enough for this lifecycle; re-subscribing
    // on phase change is the behavior we want.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function startSync() {
    setMessage('starting cloud sync…');
    triggerLibrarySync()
      .then(() => {
        const timestamp = Date.now();
        localStorage.setItem(SYNC_STARTED_STORAGE_KEY, String(timestamp));
        setStartedAt(timestamp);
        setNow(timestamp);
        setMessage('');
      })
      .catch((error: unknown) => {
        setMessage(error instanceof Error ? error.message : 'sync failed to start');
      });
  }

  return {
    phase,
    progress: Math.min(1, elapsed / SYNC_WAIT_MS),
    message,
    startSync,
  };
}
