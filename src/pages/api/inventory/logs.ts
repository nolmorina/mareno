import type { APIRoute } from 'astro';
import { connectDB } from '../../../lib/db';
import { StockLog } from '../../../lib/models';
import { getAuthUser } from '../../../lib/auth';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* GET — admin only
 * Query params:
 *   product  — filter by productName (substring, case-insensitive)
 *   size     — exact size match
 *   reason   — exact reason match (sale|restock|correction|return|damage)
 *   from     — ISO date string, start of range
 *   to       — ISO date string, end of range
 *   limit    — default 20, max 200
 *   page     — 1-based, max 1000
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

    const product = p.get('product');
    if (product) {
      filter.productName = { $regex: escapeRegex(String(product)), $options: 'i' };
    }

    const size = p.get('size');
    if (size) filter.size = String(size).trim().slice(0, 10);

    const reason = p.get('reason');
    const VALID_REASONS = new Set(['sale', 'restock', 'correction', 'return', 'damage']);
    if (reason && VALID_REASONS.has(reason)) filter.reason = reason;

    const from = p.get('from');
    const to   = p.get('to');
    if (from || to) {
      const fromDate = from ? new Date(from) : null;
      const toDate   = to   ? new Date(to)   : null;
      if (
        (fromDate && isNaN(fromDate.getTime())) ||
        (toDate   && isNaN(toDate.getTime()))
      ) {
        return new Response(JSON.stringify({ error: 'Invalid date format' }), { status: 400 });
      }
      const ts: Record<string, Date> = {};
      if (fromDate) ts.$gte = fromDate;
      if (toDate)   ts.$lte = toDate;
      filter.createdAt = ts;
    }

    const limit = Math.min(Math.max(parseInt(p.get('limit') ?? '20', 10) || 20, 1), 200);
    const page  = Math.min(Math.max(parseInt(p.get('page')  ?? '1',  10) || 1,  1), 1000);
    const skip  = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      StockLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      StockLog.countDocuments(filter),
    ]);

    return new Response(JSON.stringify({ logs, total, page, limit }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET /api/inventory/logs]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
