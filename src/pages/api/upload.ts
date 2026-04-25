import type { APIRoute } from 'astro';
import { getAuthUser } from '../../lib/auth';
import { uploadToR2, isR2Configured } from '../../lib/r2';
import { Log } from '../../lib/models';
import { connectDB } from '../../lib/db';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// Allowed image types: magic-byte prefix → extension
const MAGIC: Array<{ sig: number[]; ext: string; mime: string }> = [
  { sig: [0xFF, 0xD8, 0xFF],             ext: 'jpg',  mime: 'image/jpeg' },
  { sig: [0x89, 0x50, 0x4E, 0x47],       ext: 'png',  mime: 'image/png'  },
  { sig: [0x47, 0x49, 0x46],             ext: 'gif',  mime: 'image/gif'  },
  { sig: [0x52, 0x49, 0x46, 0x46],       ext: 'webp', mime: 'image/webp' }, // RIFF…WEBP checked below
  { sig: [0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70], ext: 'avif', mime: 'image/avif' }, // ftyp box
];

function detectMime(buf: Buffer): { ext: string; mime: string } | null {
  for (const { sig, ext, mime } of MAGIC) {
    if (sig.every((b, i) => buf[i] === b)) {
      // Extra check for WebP: bytes 8-11 must be "WEBP"
      if (ext === 'webp' && buf.slice(8, 12).toString() !== 'WEBP') continue;
      return { ext, mime };
    }
  }
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  // Reject oversized payloads before reading the body
  const contentLength = parseInt(request.headers.get('content-length') ?? '0', 10);
  if (contentLength > MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'File too large (max 10 MB)' }), { status: 413 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: 'No file provided' }), { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    // Double-check size after reading (content-length can be missing or spoofed)
    if (buffer.byteLength > MAX_BYTES) {
      return new Response(JSON.stringify({ error: 'File too large (max 10 MB)' }), { status: 413 });
    }

    // Server-side magic-byte MIME detection — ignores client-supplied file.type
    const detected = detectMime(buffer);
    if (!detected) {
      return new Response(
        JSON.stringify({ error: 'Unsupported file type. Upload JPEG, PNG, GIF, WebP, or AVIF.' }),
        { status: 415 }
      );
    }

    if (!isR2Configured()) {
      return new Response(
        JSON.stringify({ error: 'R2 not configured — add R2 credentials to .env' }),
        { status: 503 }
      );
    }

    const key = `products/${Date.now()}-${Math.random().toString(36).slice(2)}.${detected.ext}`;
    const url = await uploadToR2(key, buffer, detected.mime);

    await connectDB();
    await Log.create({
      username: user.username,
      action: 'upload_image',
      detail: `Uploaded image (${detected.mime}, ${(buffer.byteLength / 1024).toFixed(0)} KB)`,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '',
    });

    return new Response(JSON.stringify({ ok: true, url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[POST /api/upload]', err);
    return new Response(JSON.stringify({ error: 'Upload failed' }), { status: 500 });
  }
};
