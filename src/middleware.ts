import { defineMiddleware } from 'astro:middleware';

/* ── Login rate limiter (in-memory, per IP) ────────────────────── */
// Key: IP address → { count, resetAt }
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS  = 10;           // per window
const WINDOW_MS     = 15 * 60_000; // 15 minutes

function getClientIp(request: Request): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  );
}

function isRateLimited(ip: string): boolean {
  const now   = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }

  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

/* ── Security headers ──────────────────────────────────────────── */
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options':  'nosniff',
  'X-Frame-Options':         'DENY',
  'Referrer-Policy':         'strict-origin-when-cross-origin',
  'Permissions-Policy':      'camera=(), microphone=(), geolocation=()',
  // Tight CSP — adjust if you add third-party scripts/fonts
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",          // inline scripts used by Astro/admin
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://pub-7e7327c9d67846299cce240184808f59.r2.dev",
    "connect-src 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { request, url } = ctx;

  /* Rate-limit the login endpoint */
  if (url.pathname === '/api/auth/login' && request.method === 'POST') {
    const ip = getClientIp(request);
    if (isRateLimited(ip)) {
      return new Response(
        JSON.stringify({ error: 'Too many login attempts. Try again in 15 minutes.' }),
        { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '900' } }
      );
    }
  }

  const response = await next();

  /* Attach security headers to every response */
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(k, v);
  }

  /* HSTS — only over HTTPS in production */
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  return response;
});
