import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

// Server-only env — consumed exclusively by the /api functions.
// Values come from .env locally and from Vercel project env vars in deploys.
export const env = createEnv({
  server: {
    R2_ACCOUNT_ID: z.string().min(1),
    R2_ACCESS_KEY_ID: z.string().min(1),
    R2_SECRET_ACCESS_KEY: z.string().min(1),
    R2_BUCKET_NAME: z.string().min(1),
    APP_PASSPHRASE: z.string().min(8),
    // Optional: enables the in-app "Sync" button (fine-grained PAT with
    // Actions read+write on the repo). Without it /api/sync returns 501.
    GITHUB_PAT: z.string().min(1).optional(),
    GITHUB_REPO: z.string().default('Maratatasan/mp3-player'),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
