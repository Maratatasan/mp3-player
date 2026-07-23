import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requirePassphrase } from './_lib/auth';
import { env } from './_lib/env';

const GITHUB_HEADERS = (pat: string) => ({
  Authorization: `Bearer ${pat}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'mp3-player',
});

// POST fires the sync-library GitHub Actions workflow via workflow_dispatch;
// GET reports the latest run's status. The GitHub token never leaves the server.
export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (request.method !== 'POST' && request.method !== 'GET') {
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

  if (request.method === 'GET') {
    const runs = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/sync-library.yml/runs?per_page=1`,
      { headers: GITHUB_HEADERS(env.GITHUB_PAT) },
    );
    if (!runs.ok) {
      response.status(502).json({ error: `github responded ${runs.status}` });
      return;
    }
    const body = (await runs.json()) as {
      workflow_runs: Array<{ status: string; conclusion: string | null; run_started_at: string }>;
    };
    const latest = body.workflow_runs[0];
    if (!latest) {
      response.status(200).json({ status: 'none', conclusion: null, startedAt: null });
      return;
    }
    response.status(200).json({
      status: latest.status,
      conclusion: latest.conclusion,
      startedAt: latest.run_started_at,
    });
    return;
  }

  const dispatch = await fetch(
    `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/sync-library.yml/dispatches`,
    {
      method: 'POST',
      headers: { ...GITHUB_HEADERS(env.GITHUB_PAT), 'Content-Type': 'application/json' },
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
