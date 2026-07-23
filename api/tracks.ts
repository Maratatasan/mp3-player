import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requirePassphrase } from './_lib/auth';
import { env } from './_lib/env';
import { r2 } from './_lib/r2';

export type TrackListing = {
  key: string;
  title: string;
  sizeBytes: number;
};

function titleFromKey(key: string): string {
  const basename = key.split('/').pop() ?? key;
  return basename.replace(/\.[^.]+$/, '');
}

export default async function handler(request: VercelRequest, response: VercelResponse) {
  if (!requirePassphrase(request, response)) {
    return;
  }
  const result = await r2.send(
    new ListObjectsV2Command({ Bucket: env.R2_BUCKET_NAME, MaxKeys: 1000 }),
  );
  const tracks: TrackListing[] = (result.Contents ?? [])
    .filter((object) => object.Key !== undefined && /\.(mp3|m4a|flac|ogg|wav)$/i.test(object.Key))
    .map((object) => ({
      key: object.Key as string,
      title: titleFromKey(object.Key as string),
      sizeBytes: object.Size ?? 0,
    }));
  response.status(200).json({ tracks });
}
