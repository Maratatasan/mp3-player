import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requirePassphrase } from './_lib/auth.js';
import { env } from './_lib/env.js';
import { r2 } from './_lib/r2.js';

const URL_TTL_SECONDS = 60 * 15;

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!requirePassphrase(request, response)) {
    return;
  }
  const key = typeof request.query.key === 'string' ? request.query.key : '';
  if (key === '') {
    response.status(400).json({ error: 'missing key' });
    return;
  }
  const url = await getSignedUrl(
    r2,
    new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    { expiresIn: URL_TTL_SECONDS },
  );
  response.status(200).json({ url, expiresInSeconds: URL_TTL_SECONDS });
}
