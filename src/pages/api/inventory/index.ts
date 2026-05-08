import type { APIRoute } from 'astro';
import { connectDB } from '../../../lib/db';
import { Product, Log, Inventory, StockLog } from '../../../lib/models';
import { getAuthUser } from '../../../lib/auth';

/* GET — admin only
 * Returns all (non-hidden) products enriched with their inventory state.
 * Products without an Inventory doc get an empty stock array so the UI
 * can prompt the admin to set initial quantities.
 */
export const GET: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    await connectDB();

    const [products, inventoryDocs] = await Promise.all([
      Product.find({}).sort({ order: 1 }).lean(),
      Inventory.find({}).lean(),
    ]);

    const invMap: Record<number, any> = {};
    (inventoryDocs as any[]).forEach(inv => { invMap[inv.productId] = inv; });

    const result = (products as any[]).map(p => {
      const inv = invMap[p.id];
      return {
        productId:   p.id,
        productName: p.name,
        cat:         p.cat,
        img:         p.img ?? '',
        sizes:       p.sizes ?? [],
        stock:       inv?.stock ?? [],
        lowStockAt:  inv?.lowStockAt ?? 2,
        updatedAt:   inv?.updatedAt ?? null,
      };
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[GET /api/inventory]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};

/* PUT — admin only
 * Body: { productId: number, stock: [{size, qty}], note?: string }
 * Sets absolute quantities for every size, creates StockLog entries for
 * changed sizes, and re-derives product.avail from the new stock.
 */
export const PUT: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const productId = Number(body.productId);
    if (!Number.isFinite(productId)) {
      return new Response(JSON.stringify({ error: 'Invalid productId' }), { status: 400 });
    }

    const rawStock = Array.isArray(body.stock) ? body.stock : [];
    const stock = rawStock
      .slice(0, 30)
      .map((s: any) => ({
        size: String(s.size ?? '').trim().slice(0, 10),
        qty:  Math.max(0, Math.floor(Number(s.qty) || 0)),
      }))
      .filter((s: any) => s.size);

    const note = String(body.note ?? '').slice(0, 300);

    await connectDB();

    const product = await Product.findOne({ id: productId }).lean() as any;
    if (!product) {
      return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404 });
    }

    // Read old quantities for delta logging
    const existing = await Inventory.findOne({ productId }).lean() as any;
    const oldMap: Record<string, number> = {};
    (existing?.stock ?? []).forEach((l: any) => { oldMap[l.size] = l.qty; });

    // Upsert inventory document
    await Inventory.findOneAndUpdate(
      { productId },
      { productId, productName: product.name, stock, updatedAt: new Date() },
      { upsert: true },
    );

    // Append StockLog entries only for sizes whose qty actually changed
    const logEntries = stock
      .filter((s: any) => s.qty !== (oldMap[s.size] ?? 0))
      .map((s: any) => ({
        productId,
        productName: product.name,
        size:       s.size,
        delta:      s.qty - (oldMap[s.size] ?? 0),
        reason:     'restock',
        note,
        adminUser:  user.username,
        qtyBefore:  oldMap[s.size] ?? 0,
        qtyAfter:   s.qty,
      }));

    if (logEntries.length) {
      await StockLog.insertMany(logEntries);
    }

    // Re-derive avail: sizes whose qty > 0 AND are in the product's sizes list
    const newAvail = stock
      .filter((s: any) => s.qty > 0 && (product.sizes ?? []).includes(s.size))
      .map((s: any) => s.size);
    await Product.updateOne({ id: productId }, { avail: newAvail });

    await Log.create({
      username: user.username,
      action:   'restock',
      detail:   `Restocked "${product.name}": ${stock.map((s: any) => `${s.size}×${s.qty}`).join(', ')}`,
      ip:       request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '',
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[PUT /api/inventory]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
