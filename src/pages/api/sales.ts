import type { APIRoute } from 'astro';
import { connectDB } from '../../lib/db';
import { StockLog, Product } from '../../lib/models';
import { getAuthUser } from '../../lib/auth';

/** Strip currency symbols and parse to float. Returns 0 on failure. */
function parsePrice(raw: unknown): number {
  const n = parseFloat(String(raw ?? '0').replace(/[€£$,\s]/g, ''));
  return isNaN(n) ? 0 : n;
}

/** "2026-03" → "Mar 2026" */
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('default', { month: 'short', year: 'numeric' });
}

/* GET — admin only
 * Query params:
 *   year   — 4-digit year, e.g. "2026"  (omit for all-time)
 * Returns aggregated sales analytics derived from StockLog + Product prices.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    await connectDB();

    const yearParam = url.searchParams.get('year');
    const yearInt   = yearParam ? parseInt(yearParam) : null;

    // Build date filter for StockLog query
    const dateFilter: Record<string, any> = {};
    if (yearInt && !isNaN(yearInt)) {
      dateFilter.createdAt = {
        $gte: new Date(`${yearInt}-01-01T00:00:00.000Z`),
        $lt:  new Date(`${yearInt + 1}-01-01T00:00:00.000Z`),
      };
    }

    const [saleLogs, products, yearBuckets] = await Promise.all([
      StockLog.find({ reason: 'sale', ...dateFilter }).sort({ createdAt: -1 }).lean(),
      Product.find({}).lean(),
      // Available years for the selector
      StockLog.aggregate([
        { $match: { reason: 'sale' } },
        { $group: { _id: { $year: '$createdAt' } } },
        { $sort:  { _id: -1 } },
      ]),
    ]);

    // Build lookup maps from products
    const priceMap: Record<number, number> = {};
    const imgMap:   Record<number, string> = {};
    const catMap:   Record<number, string> = {};

    for (const p of products as any[]) {
      // Effective selling price: priceOld (discounted) if set, else regular price
      priceMap[p.id] = parsePrice(p.priceOld || p.price);
      imgMap[p.id]   = p.img  ?? '';
      catMap[p.id]   = p.cat  ?? '';
    }

    // ── Accumulate ──────────────────────────────────────────────
    let totalUnits   = 0;
    let totalRevenue = 0;

    const byProduct: Record<number, {
      productId: number; productName: string; img: string; cat: string;
      price: number; units: number; revenue: number;
      bySizeUnits: Record<string, number>;
    }> = {};

    const bySizeUnits: Record<string, number> = {};
    const byCat:       Record<string, { units: number; revenue: number }> = {};
    const byMonth:     Record<string, { units: number; revenue: number; transactions: number }> = {};

    for (const log of saleLogs as any[]) {
      const units   = Math.abs(log.delta);
      const price   = priceMap[log.productId] ?? 0;
      const revenue = units * price;

      totalUnits   += units;
      totalRevenue += revenue;

      // By product
      if (!byProduct[log.productId]) {
        byProduct[log.productId] = {
          productId: log.productId,
          productName: log.productName,
          img:    imgMap[log.productId]  ?? '',
          cat:    catMap[log.productId]  ?? '',
          price,
          units:   0,
          revenue: 0,
          bySizeUnits: {},
        };
      }
      const pp = byProduct[log.productId];
      pp.units   += units;
      pp.revenue += revenue;
      pp.bySizeUnits[log.size] = (pp.bySizeUnits[log.size] ?? 0) + units;

      // By size
      bySizeUnits[log.size] = (bySizeUnits[log.size] ?? 0) + units;

      // By category
      const cat = catMap[log.productId] || 'Other';
      if (!byCat[cat]) byCat[cat] = { units: 0, revenue: 0 };
      byCat[cat].units   += units;
      byCat[cat].revenue += revenue;

      // By month (YYYY-MM key)
      const d        = new Date(log.createdAt);
      const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[monthKey]) byMonth[monthKey] = { units: 0, revenue: 0, transactions: 0 };
      byMonth[monthKey].units        += units;
      byMonth[monthKey].revenue      += revenue;
      byMonth[monthKey].transactions += 1;
    }

    const totalTransactions = (saleLogs as any[]).length;
    const avgOrderValue     = totalTransactions > 0 ? totalRevenue / totalTransactions : 0;

    // ── Shape output arrays ──────────────────────────────────────
    const byProductArr = Object.values(byProduct)
      .sort((a, b) => b.units - a.units);

    const bySizeArr = Object.entries(bySizeUnits)
      .map(([size, units]) => ({
        size,
        units,
        pct: totalUnits > 0 ? Math.round(units / totalUnits * 100) : 0,
      }))
      .sort((a, b) => b.units - a.units);

    const byCatArr = Object.entries(byCat)
      .map(([cat, d]) => ({
        cat,
        units:   d.units,
        revenue: d.revenue,
        pct: totalUnits > 0 ? Math.round(d.units / totalUnits * 100) : 0,
      }))
      .sort((a, b) => b.units - a.units);

    // Build monthly array — if year filter, fill all 12 months
    let monthlyArr: any[];
    if (yearInt && !isNaN(yearInt)) {
      monthlyArr = Array.from({ length: 12 }, (_, i) => {
        const key  = `${yearInt}-${String(i + 1).padStart(2, '0')}`;
        const data = byMonth[key] ?? { units: 0, revenue: 0, transactions: 0 };
        return { month: key, label: monthLabel(key), ...data };
      });
    } else {
      monthlyArr = Object.entries(byMonth)
        .map(([month, d]) => ({ month, label: monthLabel(month), ...d }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-18); // cap at last 18 months for all-time view
    }

    // Recent transactions (latest 20)
    const recentSales = (saleLogs as any[]).slice(0, 20).map((l: any) => ({
      productName: l.productName,
      size:        l.size,
      qty:         Math.abs(l.delta),
      revenue:     Math.abs(l.delta) * (priceMap[l.productId] ?? 0),
      note:        l.note    ?? '',
      adminUser:   l.adminUser ?? '',
      createdAt:   l.createdAt,
    }));

    const availableYears = (yearBuckets as any[])
      .map((b: any) => b._id)
      .filter(Boolean);

    return new Response(JSON.stringify({
      summary: {
        totalUnits,
        totalRevenue,
        totalTransactions,
        avgOrderValue,
        bestSelling:  byProductArr[0]?.productName ?? '—',
        topSize:      bySizeArr[0]?.size ?? '—',
        topSizePct:   bySizeArr[0]?.pct  ?? 0,
      },
      monthly:        monthlyArr,
      byProduct:      byProductArr,
      bySize:         bySizeArr,
      byCategory:     byCatArr,
      recentSales,
      availableYears,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET /api/sales]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
