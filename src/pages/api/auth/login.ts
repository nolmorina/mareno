import type { APIRoute } from 'astro';
import bcrypt from 'bcryptjs';
import { connectDB } from '../../../lib/db';
import { AdminUser, Log } from '../../../lib/models';
import { signToken, sessionCookie } from '../../../lib/auth';

export const POST: APIRoute = async ({ request }) => {
  try {
    const { username, password } = await request.json();

    if (!username || !password) {
      return new Response(JSON.stringify({ error: 'Username and password required' }), { status: 400 });
    }

    await connectDB();
    const user = await AdminUser.findOne({ username: username.toLowerCase().trim(), active: true });

    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      return new Response(JSON.stringify({ error: 'Invalid credentials' }), { status: 401 });
    }

    const token = signToken(user._id.toString(), user.username);

    // Log the login
    await Log.create({
      username: user.username,
      action: 'login',
      detail: `Logged in`,
      ip: request.headers.get('x-forwarded-for') ?? '',
    });

    return new Response(JSON.stringify({ ok: true, username: user.username }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': sessionCookie(token),
      },
    });
  } catch (err) {
    console.error('[login]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
