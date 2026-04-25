import type { APIRoute } from 'astro';
import { clearCookie, getAuthUser } from '../../../lib/auth';
import { connectDB } from '../../../lib/db';
import { Log } from '../../../lib/models';

export const POST: APIRoute = async ({ request }) => {
  try {
    const user = getAuthUser(request);
    if (user) {
      await connectDB();
      await Log.create({
        username: user.username,
        action: 'logout',
        detail: 'Logged out',
        ip: request.headers.get('x-forwarded-for') ?? '',
      });
    }
  } catch {}

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': clearCookie(),
    },
  });
};
