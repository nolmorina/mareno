import jwt from 'jsonwebtoken';
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'path';

if (!process.env.JWT_SECRET) {
  dotenvConfig({ path: resolve(process.cwd(), '.env') });
}

const SECRET = process.env.JWT_SECRET ?? (import.meta.env?.JWT_SECRET as string) ?? 'fallback-dev-secret';
const COOKIE = 'mareno_session';

export interface TokenPayload {
  userId: string;
  username: string;
  iat?: number;
  exp?: number;
}

export function signToken(userId: string, username: string): string {
  return jwt.sign({ userId, username }, SECRET, { expiresIn: '12h' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as TokenPayload;
  } catch {
    return null;
  }
}

export function getTokenFromRequest(request: Request): string | null {
  // Check Authorization header first (Bearer <token>)
  const auth = request.headers.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7);

  // Fall back to cookie
  const cookieHeader = request.headers.get('cookie') ?? '';
  const match = cookieHeader.match(new RegExp(`(?:^|;)\\s*${COOKIE}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function getAuthUser(request: Request): TokenPayload | null {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

export function sessionCookie(token: string): string {
  // httpOnly, Secure in production, SameSite=Strict, 12h max-age
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=43200`;
}

export function clearCookie(): string {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`;
}
