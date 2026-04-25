import type { APIRoute } from 'astro';
import { getFromR2, isR2Configured } from '../../../lib/r2';

const ALLOWED_PREFIXES = ['products/', 'settings/'];

export const GET: APIRoute = async ({ params }) => {
  const key = params.path;

  // Validate key: must exist, stay within allowed prefixes, no traversal
  if (
    !key ||
    key.includes('..') ||
    key.includes('\0') ||
    !ALLOWED_PREFIXES.some(p => key.startsWith(p))
  ) {
    return new Response('Not found', { status: 404 });
  }

  if (!isR2Configured()) {
    return new Response('R2 not configured', { status: 503 });
  }

  try {
    const obj = await getFromR2(key);

    const body = obj.Body as ReadableStream | null;
    if (!body) return new Response('Not found', { status: 404 });

    const contentType = obj.ContentType ?? 'application/octet-stream';
    const contentLength = obj.ContentLength;

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      // Cache for 1 year in browser and CDN — images are content-addressed (timestamp in key)
      'Cache-Control': 'public, max-age=31536000, immutable',
    };
    if (contentLength) headers['Content-Length'] = String(contentLength);

    return new Response(body as BodyInit, { status: 200, headers });
  } catch (err: any) {
    if (err?.name === 'NoSuchKey' || err?.$metadata?.httpStatusCode === 404) {
      return new Response('Not found', { status: 404 });
    }
    console.error('[image proxy]', err);
    return new Response('Error', { status: 500 });
  }
};
