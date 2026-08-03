// Deletes bucket objects that no longer exist in the local library folder —
// i.e. tracks you removed from the playlist. The local folder is the source of
// truth here: after `spotdl sync` it mirrors the playlist exactly, so any
// top-level bucket key without a matching local file is an orphan to delete.
//
// This is the *only* script that deletes from the bucket. `upload-library.mjs`
// never deletes, so the documented one-off upload path stays safe.
//
// Run with: node --env-file=.env scripts/prune-library.mjs <folder> [--dry-run] [--force]
//
// Safety guards (both abort unless --force):
//   * the folder has zero audio files (a bad/empty sync would otherwise wipe
//     the whole bucket), or
//   * pruning would remove more than MAX_FRACTION of the bucket.
// --dry-run prints what would be deleted and removes nothing.
import { readdir } from 'node:fs/promises';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const AUDIO_PATTERN = /\.(mp3|m4a|flac|ogg|wav)$/i;
const MAX_FRACTION = 0.5; // refuse to prune >50% of the bucket without --force

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const folder = args.find((a) => !a.startsWith('--'));

if (!folder) {
  console.error(
    'Usage: node --env-file=.env scripts/prune-library.mjs <folder> [--dry-run] [--force]',
  );
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

// Keep-set: every audio filename present locally, regardless of size. Zero-byte
// placeholders (CI bucket-first flow) count as "keep", so prune is a no-op there.
const keep = new Set(
  (await readdir(folder)).filter((name) => AUDIO_PATTERN.test(name)),
);

// All top-level bucket keys (skip anything nested under a prefix).
const remoteKeys = [];
let continuationToken;
do {
  const page = await r2.send(
    new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
  );
  for (const object of page.Contents ?? []) {
    if (object.Key && !object.Key.includes('/')) remoteKeys.push(object.Key);
  }
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (continuationToken);

const orphans = remoteKeys.filter((key) => !keep.has(key));

if (orphans.length === 0) {
  console.log(`Prune: nothing to remove (bucket matches ${keep.size} local track(s)).`);
  process.exit(0);
}

console.log(`Prune: ${orphans.length} bucket object(s) not in the playlist:`);
for (const key of orphans) console.log(`  - ${key}`);

// Guards.
const fraction = remoteKeys.length ? orphans.length / remoteKeys.length : 1;
if (!force) {
  if (keep.size === 0) {
    console.error(
      '\nAborting: local folder has 0 audio files — refusing to wipe the bucket. ' +
        'Run a successful sync first, or pass --force if this is intentional.',
    );
    process.exit(1);
  }
  if (fraction > MAX_FRACTION) {
    console.error(
      `\nAborting: this would remove ${(fraction * 100).toFixed(0)}% of the bucket ` +
        `(> ${(MAX_FRACTION * 100).toFixed(0)}% guard). Re-run with --force if intentional.`,
    );
    process.exit(1);
  }
}

if (dryRun) {
  console.log(`\nDry run: would delete ${orphans.length} object(s). Nothing removed.`);
  process.exit(0);
}

// DeleteObjects handles up to 1000 keys per call.
let deleted = 0;
for (let i = 0; i < orphans.length; i += 1000) {
  const batch = orphans.slice(i, i + 1000);
  const res = await r2.send(
    new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
    }),
  );
  deleted += batch.length - (res.Errors?.length ?? 0);
  for (const err of res.Errors ?? []) {
    console.error(`  ! failed to delete ${err.Key}: ${err.Message}`);
  }
}

console.log(`\nDone: pruned ${deleted} object(s). Bucket now has ${remoteKeys.length - deleted}.`);
