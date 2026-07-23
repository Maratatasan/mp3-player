# mp3-player

A private, tempo-locked MP3 player. Point it at a playlist of steady-tempo tracks (DJ-style, ~110–140 BPM), set a target BPM, and every track plays at that tempo — pitch untouched, adjustable live mid-song.

Built with Vite + React + TypeScript + Tailwind v4. Deployed on Vercel. Music library lives in a private Cloudflare R2 bucket (in progress).

## Architecture

Three layers plus a backend. Dependencies point **down**, never up — the engine has zero React in it.

```
┌────────────────────────────────────────────────┐
│  UI            src/App.tsx                     │  what you SEE
│                (TempoBox, buttons, sliders)    │
├────────────────────────────────────────────────┤
│  STATE         src/audio/usePlayer.ts          │  what the app KNOWS
│                (trackIndex, isPlaying,         │
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
| `src/tracks.ts` | Hardcoded track manifest — temporary "library" until R2 replaces it |
| `src/lib/cn.ts` | Tailwind class composition (clsx + tailwind-merge) |
| `src/audio/signalsmith-stretch.d.ts` | Hand-written types for the untyped stretch library |
| `public/audio/` | Local dev MP3s — git-ignored, served statically by Vite |
| `api/_lib/` | Backend plumbing: validated env (t3-env + zod), R2 client, passphrase check |

## The audio pipeline

_To be written — next lesson._

## API & storage (R2)

_To be written — being built._

## Getting started

_To be written._
