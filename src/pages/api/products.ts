import type { APIRoute } from 'astro';
import { connectDB } from '../../lib/db';
import { Product, Log } from '../../lib/models';
import { getAuthUser } from '../../lib/auth';

const VALID_CATS = new Set([
  'Shirts','Short-Sleeve','Trousers','Shorts','Knitwear','Jackets','Accessories',
]);

/** Strip to known fields and basic types — no arbitrary keys reach MongoDB */
function sanitizeProduct(raw: any): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null) return null;

  const id    = Number(raw.id);
  const order = Number(raw.order ?? 0);
  if (!Number.isFinite(id) || !Number.isFinite(order)) return null;

  const name = String(raw.name ?? '').trim().slice(0, 200);
  if (!name) return null;

  const cat = String(raw.cat ?? '');
  if (!VALID_CATS.has(cat)) return null;

  const colors = Array.isArray(raw.colors)
    ? raw.colors.slice(0, 10).map((c: any) => ({
        bg:    String(c?.bg    ?? '#000000').slice(0, 20),
        title: String(c?.title ?? '').slice(0, 50),
      }))
    : [];

  const specs = Array.isArray(raw.specs)
    ? raw.specs.slice(0, 20)
        .filter((s: any) => Array.isArray(s) && s.length >= 2)
        .map((s: any) => [String(s[0]).slice(0, 100), String(s[1]).slice(0, 200)])
    : [];

  const sizes = Array.isArray(raw.sizes)
    ? raw.sizes.slice(0, 10).map((s: any) => String(s).slice(0, 10))
    : [];
  const avail = Array.isArray(raw.avail)
    ? raw.avail.slice(0, 10).map((s: any) => String(s).slice(0, 10))
    : [];

  return {
    id,
    order,
    hidden:   Boolean(raw.hidden),
    name,
    cat,
    cats:     String(raw.cats     ?? '').slice(0, 200),
    price:    String(raw.price    ?? '').slice(0, 30),
    priceOld: String(raw.priceOld ?? '').slice(0, 30),
    badge:    String(raw.badge    ?? '').slice(0, 50),
    img:      String(raw.img      ?? '').slice(0, 500),
    desc:     String(raw.desc     ?? '').slice(0, 2000),
    colors,
    specs,
    sizes,
    avail,
  };
}

/* GET — public */
export const GET: APIRoute = async () => {
  try {
    await connectDB();
    const docs = await Product.find({}).sort({ order: 1 }).lean();
    return new Response(JSON.stringify(docs), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET /api/products]', err);
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
    if (!Array.isArray(body)) {
      return new Response(JSON.stringify({ error: 'Expected array' }), { status: 400 });
    }
    if (body.length > 500) {
      return new Response(JSON.stringify({ error: 'Too many products' }), { status: 400 });
    }

    const products = body.map(sanitizeProduct).filter(Boolean) as Record<string, unknown>[];

    await connectDB();
    await Promise.all(products.map(p =>
      Product.findOneAndUpdate({ id: p.id }, p, { upsert: true, returnDocument: 'after' })
    ));

    const ids = products.map(p => p.id);
    await Product.deleteMany({ id: { $nin: ids } });

    await Log.create({
      username: user.username,
      action: 'save_products',
      detail: `Saved ${products.length} product(s)`,
      ip: request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '',
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[PUT /api/products]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
