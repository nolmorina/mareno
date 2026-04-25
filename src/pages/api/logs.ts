import type { APIRoute } from 'astro';
import { connectDB } from '../../lib/db';
import { Log } from '../../lib/models';
import { getAuthUser } from '../../lib/auth';

/* Escape special regex characters so user input is treated as a literal string */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* GET — admin only
 * Query params:
 *   username  — filter by username (literal substring, case-insensitive)
 *   action    — filter by action (literal substring, case-insensitive)
 *   from      — ISO date string, start of range
 *   to        — ISO date string, end of range
 *   limit     — default 50, max 200
 *   page      — 1-based, max 1000
 */
export const GET: APIRoute = async ({ request, url }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    await connectDB();

    const p = url.searchParams;
    const filter: Record<string, unknown> = {};

    // Force string coercion + escape → no operator injection via $regex
    const username = p.get('username');
    if (username) {
      filter.username = { $regex: escapeRegex(String(username)), $options: 'i' };
    }

    const action = p.get('action');
    if (action) {
      filter.action = { $regex: escapeRegex(String(action)), $options: 'i' };
    }

    const from = p.get('from');
    const to   = p.get('to');
    if (from || to) {
      const fromDate = from ? new Date(from) : null;
      const toDate   = to   ? new Date(to)   : null;
      // Reject invalid dates
      if ((fromDate && isNaN(fromDate.getTime())) || (toDate && isNaN(toDate.getTime()))) {
        return new Response(JSON.stringify({ error: 'Invalid date format' }), { status: 400 });
      }
      const ts: Record<string, Date> = {};
      if (fromDate) ts.$gte = fromDate;
      if (toDate)   ts.$lte = toDate;
      filter.createdAt = ts;
    }

    const limit = Math.min(Math.max(parseInt(p.get('limit') ?? '50', 10) || 50, 1), 200);
    const page  = Math.min(Math.max(parseInt(p.get('page')  ?? '1',  10) || 1,  1), 1000);
    const skip  = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      Log.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Log.countDocuments(filter),
    ]);

    return new Response(JSON.stringify({ logs, total, page, limit }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET /api/logs]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
