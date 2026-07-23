// Bucket-first dedupe for CI: drops a zero-byte placeholder file into the
// library folder for every object already in the bucket, so spotDL skips
// re-downloading them ("file already exists"). The upload script ignores
// empty files, so placeholders never travel back to the bucket.
// Run with R2_* env set: node scripts/prepare-library-placeholders.mjs <folder>
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: node scripts/prepare-library-placeholders.mjs <folder>');
  process.exit(1);
}

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

await mkdir(folder, { recursive: true });

let count = 0;
let continuationToken;
do {
  const page = await r2.send(
    new ListObjectsV2Command({
      Bucket: process.env.R2_BUCKET_NAME,
      ContinuationToken: continuationToken,
    }),
  );
  for (const object of page.Contents ?? []) {
    if (object.Key && !object.Key.includes('/')) {
      await writeFile(join(folder, object.Key), '');
      count += 1;
    }
  }
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (continuationToken);

console.log(`Placed ${count} placeholder(s) for existing bucket objects.`);
