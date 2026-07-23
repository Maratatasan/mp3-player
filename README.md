# mp3-player

A private, tempo-locked MP3 player. Point it at a playlist of steady-tempo tracks (DJ-style, ~110–140 BPM), set a target BPM, and every track plays at that tempo — pitch untouched, adjustable live mid-song.

Built with Vite + React + TypeScript + Tailwind v4. Music library lives in a private Cloudflare R2 bucket; the player streams tracks through presigned URLs and caches them in the browser. Vercel deploy: not set up yet.

## Getting started

```bash
pnpm install
cp .env.example .env   # then fill it in — see below
pnpm dev               # http://localhost:5173 (api/ functions run inside Vite dev)
```

`.env` values (git-ignored, never committed):

| Var | Where it comes from |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare dashboard → R2 overview (32-hex id, also in the S3 endpoint URL) |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | R2 → Manage API tokens → the **account** token scoped to the bucket (Object Read & Write). If lost, rotate the token and paste new values |
| `R2_BUCKET_NAME` | `mp3-player-music` |
| `APP_PASSPHRASE` | Invented, min 8 chars. The app asks for it once per device (stored in localStorage) |

First app load asks for the passphrase, then lists the library. Tracks download on first play only — after that they come from IndexedDB (browser devtools → Application → IndexedDB → `keyval-store` to inspect; delete the DB to force re-download).

## Managing the music library

The library of record is the R2 bucket. The pipeline: **edit the Spotify playlist → run one script → refresh the app.**

```bash
# first ever run — hooks up the playlist:
./scripts/sync-library.sh "https://open.spotify.com/playlist/<id>"

# every run after (remembers the playlist):
./scripts/sync-library.sh
```

What it does: [spotDL](https://github.com/spotDL/spotify-downloader) mirrors the playlist into `~/Music/mp3-player-library/` (matches each track on YouTube Music, embeds Spotify metadata, names files `Artist - Title.mp3` — the app parses artist/title from that filename convention), then `scripts/upload-library.mjs` uploads anything new to the bucket. Nothing is ever deleted from the bucket automatically.

Tooling behind it (reinstall if missing): `uv tool install --python 3.12 spotdl` (lands in `~/.local/bin`) and `spotdl --download-ffmpeg` once. To drop a one-off file into the bucket: `node --env-file=.env scripts/upload-library.mjs <folder>`.

## API & storage (R2)

Two serverless functions (Vercel-style, in `api/`), both requiring `Authorization: Bearer <APP_PASSPHRASE>`:

- `GET /api/tracks` — lists audio files in the bucket → `{ tracks: [{ key, title, sizeBytes }] }`
- `GET /api/track-url?key=…` — returns a presigned R2 download URL (15 min TTL)

The browser never sees R2 credentials — only these endpoints hold them (from env). In local dev a plugin in `vite.config.ts` runs the same handlers inside the Vite server, loading `.env` itself.

R2 specifics to remember:

- R2 is S3-compatible; everything uses `@aws-sdk/client-s3` pointed at `https://<account-id>.r2.cloudflarestorage.com`.
- The bucket has a **CORS policy** (dashboard → bucket → Settings → CORS) allowing GET from `localhost:5173/5199` and `https://*.vercel.app` — without it, browsers refuse the presigned-URL fetch. The API token can't set CORS (object-scope only); edit it in the dashboard.
- `node --env-file=.env scripts/r2-smoke.mjs [file]` — connection check: lists the bucket, optionally uploads a file and verifies a presigned round-trip.

## Player behavior worth knowing

- **Lazy loading**: startup fetches only the track listing; the selected track loads on demand and the next in queue prefetches. Queue shows `—` for BPM until a track has been analyzed once.
- **Caching**: encoded MP3 bytes + detected BPM persist in IndexedDB per device (`src/audio/trackCache.ts`); decoded audio is memory-only by design (10× bigger).
- **Refresh restores**: last active track, target BPM (validated 60–200), and the queue scrolls to the active row. Position resets and playback starts paused (browser autoplay rules).
- **Tempo lock**: target BPM applies to every track (`rate = target / originalBpm`); "original BPM" box toggles native tempo; touching the tempo slider re-engages the lock.

## Architecture

Three layers plus a backend. Dependencies point **down**, never up — the engine has zero React in it.

```
┌────────────────────────────────────────────────┐
│  UI            src/App.tsx                     │  what you SEE
│                (TempoBox, buttons, sliders)    │
├────────────────────────────────────────────────┤
│  STATE         src/audio/usePlayer.ts          │  what the app KNOWS
│                (queue, trackIndex, isPlaying,  │
│                 targetBpm, isOriginalTempo)    │
├────────────────────────────────────────────────┤
│  ENGINE        src/audio/engine.ts             │  what you HEAR
│                (AudioContext, BPM detect,      │
│                 signalsmith time-stretch)      │
├────────────────────────────────────────────────┤
│  BACKEND       api/*.ts  →  Cloudflare R2      │  where music LIVES
│                (list tracks, sign URLs)        │
└────────────────────────────────────────────────┘
```

Debugging heuristic: *looks* wrong → `App.tsx` · *behaves* wrong → `usePlayer.ts` · *sounds* wrong → `engine.ts`.

Supporting files:

| File | Role |
| --- | --- |
| `src/api/client.ts` | Browser-side API client + passphrase storage |
| `src/audio/trackCache.ts` | IndexedDB cache for audio bytes + BPM (idb-keyval) |
| `src/lib/cn.ts` | Tailwind class composition (clsx + tailwind-merge) |
| `src/audio/signalsmith-stretch.d.ts` | Hand-written types for the untyped stretch library |
| `public/audio/` | Local dev MP3s — git-ignored, not used by the app anymore |
| `api/_lib/` | Backend plumbing: validated env (t3-env + zod), R2 client, passphrase check |
| `scripts/` | Library pipeline + R2 utilities (see sections above) |

## The audio pipeline

_To be written — next lesson (see the learning workspace in `~/localCode/agent-misc/mp3-player-learning/`)._

## Not done yet

- Vercel deploy (repo not connected; env vars need setting in the Vercel project)
- Lock-screen playback + Media Session API (needed for phone use)
- Tap-tempo correction for wrongly-detected BPMs
- Nicer track metadata (currently parsed from filenames)
