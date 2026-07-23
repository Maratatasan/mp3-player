// Sets the bucket CORS policy so browsers can fetch presigned audio URLs.
// Run with: node --env-file=.env scripts/r2-cors.mjs
import { S3Client, PutBucketCorsCommand, GetBucketCorsCommand } from '@aws-sdk/client-s3';

const r2 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const bucket = process.env.R2_BUCKET_NAME;

await r2.send(
  new PutBucketCorsCommand({
    Bucket: bucket,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [
            'http://localhost:5173',
            'http://localhost:5199',
            'https://*.vercel.app',
          ],
          AllowedMethods: ['GET'],
          AllowedHeaders: ['range'],
          ExposeHeaders: ['content-range', 'content-length', 'accept-ranges'],
          MaxAgeSeconds: 3600,
        },
      ],
    },
  }),
);

const current = await r2.send(new GetBucketCorsCommand({ Bucket: bucket }));
console.log('CORS policy applied:');
console.log(JSON.stringify(current.CORSRules, null, 2));
