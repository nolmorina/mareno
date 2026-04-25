import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

if (!process.env.R2_ACCOUNT_ID) {
  dotenvConfig({ path: resolve(process.cwd(), '.env') });
}

const ACCOUNT_ID  = process.env.R2_ACCOUNT_ID  ?? (import.meta.env?.R2_ACCOUNT_ID  as string);
const ACCESS_KEY  = process.env.R2_ACCESS_KEY_ID ?? (import.meta.env?.R2_ACCESS_KEY_ID as string);
const SECRET_KEY  = process.env.R2_SECRET_ACCESS_KEY ?? (import.meta.env?.R2_SECRET_ACCESS_KEY as string);
const BUCKET      = process.env.R2_BUCKET      ?? (import.meta.env?.R2_BUCKET      as string) ?? 'mareno';
const PUBLIC_BASE = (process.env.R2_PUBLIC_URL ?? (import.meta.env?.R2_PUBLIC_URL as string) ?? '').replace(/\/$/, '');

function getClient() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId:     ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
    },
  });
}

/** R2_PUBLIC_URL must be a public CDN/custom domain, not the private API endpoint. */
function isPublicDomain(url: string): boolean {
  return Boolean(url) && !url.includes('.r2.cloudflarestorage.com');
}

/**
 * Upload a file to R2.
 * - If R2_PUBLIC_URL is a real public domain → returns the public URL directly.
 * - Otherwise → returns `/api/image/<key>` (served by the proxy route).
 */
export async function uploadToR2(
  key: string,
  body: Uint8Array | Buffer,
  contentType: string,
): Promise<string> {
  const client = getClient();

  await client.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
  }));

  if (isPublicDomain(PUBLIC_BASE)) {
    return `${PUBLIC_BASE}/${key}`;
  }

  // Serve through the server-side proxy — no expiry, works with private buckets.
  return `/api/image/${key}`;
}

/** Fetch an object from R2 and return its stream + content-type. */
export async function getFromR2(key: string) {
  const client = getClient();
  const res = await client.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return res;
}

export function isR2Configured(): boolean {
  return Boolean(ACCESS_KEY && SECRET_KEY && ACCOUNT_ID);
}
