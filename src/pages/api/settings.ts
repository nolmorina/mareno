import type { APIRoute } from 'astro';
import { connectDB } from '../../lib/db';
import { Settings, Log } from '../../lib/models';
import { getAuthUser } from '../../lib/auth';

// Only these keys are allowed — prevents arbitrary key injection
const ALLOWED_KEYS = new Set(['hero', 'editorial']);

const DEFAULTS: Record<string, unknown> = {
  hero:      { img: '' },
  editorial: { img: '' },
};

function sanitizeSettingValue(key: string, value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;

  if (key === 'hero' || key === 'editorial') {
    const img = String(v.img ?? '').trim().slice(0, 1000);
    return { img };
  }

  return null;
}

/* GET — public */
export const GET: APIRoute = async ({ url }) => {
  try {
    await connectDB();
    const key = url.searchParams.get('key');

    if (key) {
      if (!ALLOWED_KEYS.has(key)) {
        return new Response(JSON.stringify(DEFAULTS[key] ?? {}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const doc = await Settings.findOne({ key }).lean() as any;
      const val = doc?.value ?? DEFAULTS[key] ?? {};
      return new Response(JSON.stringify(val), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Return all settings
    const docs = await Settings.find({ key: { $in: [...ALLOWED_KEYS] } }).lean() as any[];
    const result: Record<string, unknown> = { ...DEFAULTS };
    docs.forEach((d: any) => { result[d.key] = d.value; });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET /api/settings]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};

/* PUT — admin only */
export const PUT: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const key  = String(body?.key ?? '');

    if (!ALLOWED_KEYS.has(key)) {
      return new Response(JSON.stringify({ error: 'Invalid settings key' }), { status: 400 });
    }

    const value = sanitizeSettingValue(key, body?.value);
    if (!value) {
      return new Response(JSON.stringify({ error: 'Invalid settings value' }), { status: 400 });
    }

    await connectDB();
    await Settings.findOneAndUpdate({ key }, { key, value }, { upsert: true, returnDocument: 'after' });

    await Log.create({
      username: user.username,
      action: `save_settings_${key}`,
      detail: `Updated ${key} image`,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '',
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[PUT /api/settings]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
