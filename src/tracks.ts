export type TrackManifestEntry = {
  id: string;
  title: string;
  artist: string;
  url: string;
};

// Drop new MP3s into public/audio/ and add one entry per file here.
export const TRACK_MANIFEST: TrackManifestEntry[] = [
  {
    id: 'light-dance',
    title: 'Light Dance',
    artist: 'DanieL Bazz',
    url: '/audio/DanieL Bazz 0 - Light Dance.mp3',
  },
  {
    id: 'my-personal-sunshine',
    title: 'My personal Sunshine',
    artist: 'DanieL Bazz',
    url: '/audio/DanieL Bazz - My personal Sunshine.mp3',
  },
];
