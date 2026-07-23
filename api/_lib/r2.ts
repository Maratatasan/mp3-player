import { S3Client } from '@aws-sdk/client-s3';
import { env } from './env.js';

// R2 speaks the S3 wire protocol; only the endpoint points at Cloudflare.
export const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});
