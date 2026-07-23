import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requirePassphrase } from './_lib/auth';
import { env } from './_lib/env';

// Fires the sync-library GitHub Actions workflow via workflow_dispatch.
// The GitHub token never leaves the server.
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'method not allowed' });
    return;
  }
  if (!requirePassphrase(request, response)) {
    return;
  }
  if (!env.GITHUB_PAT) {
    response.status(501).json({ error: 'sync not configured: GITHUB_PAT env is missing' });
    return;
  }
  const dispatch = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/sync-library.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GITHUB_PAT}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mp3-player',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  );
  if (dispatch.status === 204) {
    response.status(202).json({ started: true });
    return;
  }
  const detail = await dispatch.text();
  response.status(502).json({ error: `github responded ${dispatch.status}: ${detail.slice(0, 200)}` });
}
