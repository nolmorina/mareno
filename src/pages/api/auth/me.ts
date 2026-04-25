import type { APIRoute } from 'astro';
import { getAuthUser } from '../../../lib/auth';

export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthenticated' }), { status: 401 });
  }
  return new Response(JSON.stringify({ username: user.username }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
