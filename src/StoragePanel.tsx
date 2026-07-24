import { useEffect, useState } from 'react';
import { clearRenders, getRenderStats, type RenderStats } from './audio/renderCache';
import { clearTrackCache, getTrackCacheStats, type TrackCacheStats } from './audio/trackCache';
import { cn } from './lib/cn';

type StoragePanelProps = {
  refreshLibrary: () => Promise<number>;
};

type Stats = {
  tracks: TrackCacheStats;
  renders: RenderStats;
};

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-zinc-800 px-4 py-3 text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function StoragePanel({ refreshLibrary }: StoragePanelProps) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [status, setStatus] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isClearAllArmed, setIsClearAllArmed] = useState(false);

  function loadStats() {
    Promise.all([getTrackCacheStats(), getRenderStats()])
      .then(([tracks, renders]) => {
        setStats({ tracks, renders });
      })
      .catch(() => {
        setStatus('failed to read cache stats');
      });
  }

  useEffect(() => {
    loadStats();
  }, []);

  function run(action: () => Promise<string>) {
    setIsBusy(true);
    setStatus('working…');
    action()
      .then((message) => {
        setStatus(message);
        loadStats();
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : 'action failed');
      })
      .finally(() => {
        setIsBusy(false);
      });
  }

  function handleGetLatest() {
    run(async () => {
      const added = await refreshLibrary();
      return added > 0 ? `${added} new track${added === 1 ? '' : 's'} added` : 'no new tracks';
    });
  }

  function handleClearRenders() {
    run(async () => {
      await clearRenders();
      return 'renders cleared — tracks re-render on next play';
    });
  }

  function handleClearAll() {
    if (!isClearAllArmed) {
      setIsClearAllArmed(true);
      setStatus('tap again to clear everything — originals re-download from the cloud');
      return;
    }
    setIsClearAllArmed(false);
    run(async () => {
      await clearRenders();
      await clearTrackCache();
      return 'all caches cleared';
    });
  }

  const buttonClass =
    'rounded-xl bg-zinc-800 px-4 py-3 text-sm text-zinc-300 hover:bg-zinc-700 disabled:opacity-40';

  return (
    <section aria-label="Storage" className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto text-left">
      <h2 className="text-xs uppercase tracking-widest text-zinc-500">Storage</h2>
      {stats === null ? (
        <p className="animate-pulse text-sm text-zinc-500">reading caches…</p>
      ) : (
        <>
          <StatRow
            label="downloaded tracks"
            value={`${stats.tracks.tracks} · ${stats.tracks.tracksMB.toFixed(0)} MB`}
          />
          <StatRow label="analyzed BPMs" value={String(stats.tracks.bpms)} />
          <StatRow
            label="tempo renders"
            value={`${stats.renders.entries} · ${stats.renders.totalMB.toFixed(0)} MB`}
          />
        </>
      )}
      <div className="mt-1 flex flex-col gap-2">
        <button type="button" disabled={isBusy} className={buttonClass} onClick={handleGetLatest}>
          ↻ get latest tracks
        </button>
        <button type="button" disabled={isBusy} className={buttonClass} onClick={handleClearRenders}>
          clear tempo renders
        </button>
        <button
          type="button"
          disabled={isBusy}
          className={cn(buttonClass, isClearAllArmed && 'ring-1 ring-red-400 text-red-300')}
          onClick={handleClearAll}
        >
          {isClearAllArmed ? 'tap again to confirm' : 'clear everything'}
        </button>
      </div>
      {status !== '' && <p className="text-xs text-zinc-500">{status}</p>}
    </section>
  );
}
