const PASSPHRASE_STORAGE_KEY = 'mp3-player-passphrase';

export class AuthRequiredError extends Error {
  constructor() {
    super('passphrase missing or rejected');
    this.name = 'AuthRequiredError';
  }
}

export function getStoredPassphrase(): string | null {
  return localStorage.getItem(PASSPHRASE_STORAGE_KEY);
}

export function storePassphrase(passphrase: string): void {
  localStorage.setItem(PASSPHRASE_STORAGE_KEY, passphrase);
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const passphrase = getStoredPassphrase();
  if (passphrase === null) {
    throw new AuthRequiredError();
  }
  const response = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${passphrase}` },
  });
  if (response.status === 401) {
    throw new AuthRequiredError();
  }
  if (!response.ok) {
    throw new Error(`${path} failed: HTTP ${response.status}`);
  }
  return response;
}

export type RemoteTrack = {
  key: string;
  title: string;
  sizeBytes: number;
};

export async function fetchTracks(): Promise<RemoteTrack[]> {
  const response = await apiFetch('/api/tracks');
  const body = (await response.json()) as { tracks: RemoteTrack[] };
  return body.tracks;
}

export async function fetchTrackUrl(key: string): Promise<string> {
  const response = await apiFetch(`/api/track-url?key=${encodeURIComponent(key)}`);
  const body = (await response.json()) as { url: string };
  return body.url;
}

// Kicks off the sync-library GitHub Actions workflow; resolves when the run
// is accepted (the sync itself takes minutes — refresh the library later).
export async function triggerLibrarySync(): Promise<void> {
  await apiFetch('/api/sync', { method: 'POST' });
}

export type SyncStatus = {
  status: 'none' | 'queued' | 'in_progress' | 'completed';
  conclusion: string | null;
  startedAt: string | null;
};

export async function fetchSyncStatus(): Promise<SyncStatus> {
  const response = await apiFetch('/api/sync');
  return (await response.json()) as SyncStatus;
}
