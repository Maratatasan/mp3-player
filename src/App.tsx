import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from './lib/cn';
import {
  DEFAULT_TARGET_BPM,
  MAX_TARGET_BPM,
  MIN_TARGET_BPM,
  usePlayer,
} from './audio/usePlayer';

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

type TempoBoxProps = {
  value: number | string;
  label: string;
  sublabel: string;
  isActive: boolean;
  onSelect: () => void;
  children?: ReactNode;
};

function TempoBox({ value, label, sublabel, isActive, onSelect, children }: TempoBoxProps) {
  // The whole box selects its mode. It can't be a <button> itself because the
  // tempo controls (slider, steppers) are nested inside; the inner button
  // carries the accessible toggle, the div click is the convenience target.
  return (
    <div
      onClick={onSelect}
      className={cn(
        'flex flex-1 cursor-pointer flex-col gap-2 rounded-xl p-4',
        isActive ? 'bg-emerald-400/15 ring-2 ring-emerald-400' : 'bg-zinc-800 hover:bg-zinc-700/70',
      )}
    >
      <button
        type="button"
        aria-pressed={isActive}
        onClick={onSelect}
        className="flex flex-col items-center gap-2"
      >
        <span
          className={cn(
            'text-3xl font-bold tabular-nums',
            isActive ? 'text-emerald-400' : 'text-zinc-400',
          )}
        >
          {value}
        </span>
        <span className="text-xs uppercase tracking-widest text-zinc-400">{label}</span>
        <span className="text-xs text-zinc-500">{sublabel}</span>
      </button>
      {children}
    </div>
  );
}

type PassphraseGateProps = {
  onSubmit: (passphrase: string) => void;
};

function PassphraseGate({ onSubmit }: PassphraseGateProps) {
  const [value, setValue] = useState('');
  return (
    <main className="flex min-h-svh items-center justify-center bg-zinc-950 p-6 text-zinc-100">
      <form
        className="flex w-full flex-col gap-4 sm:w-90"
        onSubmit={(event) => {
          event.preventDefault();
          if (value.length > 0) {
            onSubmit(value);
          }
        }}
      >
        <h1 className="text-center text-xl font-semibold">Tempo Player</h1>
        <p className="text-center text-sm text-zinc-400">Enter the passphrase to unlock your library.</p>
        <input
          type="password"
          value={value}
          autoFocus
          onChange={(event) => {
            setValue(event.target.value);
          }}
          className="rounded-lg bg-zinc-800 px-4 py-3 outline-none ring-emerald-400 focus:ring-2"
          aria-label="Passphrase"
        />
        <button
          type="submit"
          className="rounded-lg bg-emerald-400 py-3 font-semibold text-zinc-950 hover:bg-emerald-300"
        >
          Unlock
        </button>
      </form>
    </main>
  );
}

function App() {
  const player = usePlayer();
  const activeRowRef = useRef<HTMLLIElement | null>(null);
  const entry = player.queue[player.trackIndex];

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [player.trackIndex, player.queue.length]);
  const track = player.currentTrack;
  const originalBpm = track?.originalBpm ?? entry?.originalBpm ?? null;

  if (player.needsPassphrase) {
    return <PassphraseGate onSubmit={player.submitPassphrase} />;
  }

  if (player.loadError) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-zinc-950 p-6 text-red-400">
        <p>Failed to load tracks: {player.loadError}</p>
      </main>
    );
  }

  if (player.isLoading || !entry) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-zinc-950 text-zinc-400">
        <p className="animate-pulse">Loading library…</p>
      </main>
    );
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-zinc-950 text-zinc-100">
      <main className="flex max-h-svh w-full min-h-svh flex-col gap-7 bg-zinc-900 px-5 py-8 text-center sm:min-h-0 sm:max-h-[90svh] sm:w-105 sm:rounded-2xl sm:p-8 sm:shadow-2xl">
        <header>
          <h1 className="text-2xl font-semibold">{entry.title}</h1>
          <p className="mt-1 text-zinc-400">
            {entry.artist}
            {player.isTrackLoading ? ' · loading…' : ''}
          </p>
        </header>

        <section aria-label="Tempo" className="flex gap-4">
          <TempoBox
            value={player.isOriginalTempo ? (originalBpm ?? '—') : player.targetBpm}
            label="current BPM"
            sublabel={
              player.isOriginalTempo
                ? 'following original'
                : originalBpm === null
                  ? 'target'
                  : `target · at ${(player.targetBpm / originalBpm).toFixed(2)}×`
            }
            isActive={!player.isOriginalTempo}
            onSelect={() => {
              if (player.isOriginalTempo) {
                player.toggleOriginalTempo();
              }
            }}
          >
            <div className="-mx-2 flex items-center gap-1.5">
              <button
                type="button"
                className="h-12 w-7 shrink-0 rounded-full bg-zinc-700 text-lg hover:bg-zinc-600"
                onClick={() => {
                  player.setTargetBpm(player.targetBpm - 1);
                }}
                aria-label="Decrease tempo"
              >
                −
              </button>
              <input
                type="range"
                min={MIN_TARGET_BPM}
                max={MAX_TARGET_BPM}
                value={player.targetBpm}
                onChange={(event) => {
                  player.setTargetBpm(Number(event.target.value));
                }}
                className="h-11 w-full accent-emerald-400"
                aria-label="Target BPM"
              />
              <button
                type="button"
                className="h-12 w-7 shrink-0 rounded-full bg-zinc-700 text-lg hover:bg-zinc-600"
                onClick={() => {
                  player.setTargetBpm(player.targetBpm + 1);
                }}
                aria-label="Increase tempo"
              >
                +
              </button>
            </div>
            <button
              type="button"
              className="self-center rounded-full bg-zinc-700/60 px-3 py-1.5 text-xs text-zinc-400 hover:bg-zinc-600/60 hover:text-zinc-200"
              onClick={() => {
                player.setTargetBpm(DEFAULT_TARGET_BPM);
              }}
            >
              reset to {DEFAULT_TARGET_BPM}
            </button>
          </TempoBox>
          <TempoBox
            value={originalBpm ?? '—'}
            label="original BPM"
            sublabel={player.isOriginalTempo ? 'playing original tempo' : 'tap to play original'}
            isActive={player.isOriginalTempo}
            onSelect={() => {
              if (!player.isOriginalTempo) {
                player.toggleOriginalTempo();
              }
            }}
          />
        </section>

        <section aria-label="Track position" className="flex items-center gap-3">
          <span className="min-w-10 text-sm tabular-nums text-zinc-400">
            {formatTime(player.positionSeconds)}
          </span>
          <input
            type="range"
            min={0}
            max={track ? Math.floor(track.durationSeconds) : 1}
            value={track ? Math.min(player.positionSeconds, track.durationSeconds) : 0}
            disabled={!track}
            onChange={(event) => {
              player.seek(Number(event.target.value));
            }}
            className="h-11 w-full accent-emerald-400 disabled:opacity-40"
            aria-label="Seek"
          />
          <span className="min-w-10 text-sm tabular-nums text-zinc-400">
            {track ? formatTime(track.durationSeconds) : '–:––'}
          </span>
        </section>

        <section
          aria-label="Playback controls"
          className="flex items-center justify-center gap-6"
        >
          <button
            type="button"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-xl hover:bg-zinc-700"
            onClick={player.back}
            aria-label="Previous track"
          >
            ⏮
          </button>
          <button
            type="button"
            className="flex h-18 w-18 items-center justify-center rounded-full bg-emerald-400 text-2xl text-zinc-950 hover:bg-emerald-300"
            onClick={player.playPause}
            aria-label={player.isPlaying ? 'Pause' : 'Play'}
          >
            {player.isPlaying ? '⏸' : '▶'}
          </button>
          <button
            type="button"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-xl hover:bg-zinc-700"
            onClick={player.next}
            aria-label="Next track"
          >
            ⏭
          </button>
        </section>

        <section aria-label="Queue" className="min-h-0 flex-1 overflow-y-auto text-left">
          <h2 className="mb-2 text-xs uppercase tracking-widest text-zinc-500">
            Queue · {player.queue.length} tracks
          </h2>
          <ul className="flex flex-col gap-1">
            {player.queue.map((queued, index) => {
              const isActive = index === player.trackIndex;
              return (
                <li key={queued.key} ref={isActive ? activeRowRef : null}>
                  <button
                    type="button"
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm',
                      isActive
                        ? 'bg-zinc-800 text-emerald-400'
                        : 'text-zinc-300 hover:bg-zinc-800/60',
                    )}
                    onClick={() => {
                      player.selectTrack(index);
                    }}
                  >
                    <span className="truncate">
                      {queued.artist === '' ? queued.title : `${queued.artist} — ${queued.title}`}
                    </span>
                    <span className="ml-3 shrink-0 tabular-nums text-zinc-500">
                      {queued.originalBpm === null ? '—' : `${queued.originalBpm} bpm`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </main>
    </div>
  );
}

export default App;
