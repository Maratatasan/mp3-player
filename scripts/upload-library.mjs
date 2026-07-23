// Uploads every audio file in a local folder to the R2 bucket, skipping
// files already present with the same byte size. Never deletes remote files.
// Run with: node --env-file=.env scripts/upload-library.mjs <folder>
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';

const AUDIO_PATTERN = /\.(mp3|m4a|flac|ogg|wav)$/i;

const folder = process.argv[2];
if (!folder) {
  console.error('Usage: node --env-file=.env scripts/upload-library.mjs <folder>');
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

const remote = new Map();
let continuationToken;
do {
  const page = await r2.send(
    new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
  );
  for (const object of page.Contents ?? []) {
    remote.set(object.Key, object.Size ?? 0);
  }
  continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (continuationToken);

const localFiles = (await readdir(folder)).filter((name) => AUDIO_PATTERN.test(name));
if (localFiles.length === 0) {
  console.log(`No audio files found in ${folder}`);
  process.exit(0);
}

let uploaded = 0;
let skipped = 0;
for (const name of localFiles) {
  const path = join(folder, name);
  const { size } = await stat(path);
  if (remote.get(name) === size) {
    skipped += 1;
    continue;
  }
  console.log(`Uploading ${name} (${(size / 1e6).toFixed(1)} MB)…`);
  await r2.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: name,
      Body: await readFile(path),
      ContentType: 'audio/mpeg',
    }),
  );
  uploaded += 1;
}

console.log(`\nDone: ${uploaded} uploaded, ${skipped} already up to date.`);
console.log(`Bucket now has ${remote.size + uploaded} object(s) (before dedupe).`);
