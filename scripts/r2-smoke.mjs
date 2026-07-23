// R2 connection smoke test. Run with:
//   node --env-file=.env scripts/r2-smoke.mjs [path-to-file-to-upload]
// Lists the bucket; if a file path is given, uploads it first and
// verifies it can be fetched back through a presigned URL.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  S3Client,
  ListObjectsV2Command,
  PutObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing env: ${missing.join(', ')}`);
  process.exit(1);
}

const bucket = process.env.R2_BUCKET_NAME;
const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const uploadPath = process.argv[2];
if (uploadPath) {
  const body = await readFile(uploadPath);
  const key = basename(uploadPath);
  console.log(`Uploading ${key} (${(body.length / 1e6).toFixed(1)} MB)…`);
  await r2.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'audio/mpeg' }),
  );
  console.log('Upload done.');

  const url = await getSignedUrl(r2, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn: 300,
  });
  // NB: the URL is signed for GET only — a HEAD request would 403.
  const probe = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
  console.log(
    `Presigned fetch: HTTP ${probe.status}, content-range ${probe.headers.get('content-range')}`,
  );
}

const listing = await r2.send(new ListObjectsV2Command({ Bucket: bucket }));
console.log(`\nBucket "${bucket}" contents (${listing.KeyCount ?? 0} objects):`);
for (const object of listing.Contents ?? []) {
  console.log(`  ${object.Key}  (${((object.Size ?? 0) / 1e6).toFixed(1)} MB)`);
}
