import type { APIRoute } from 'astro';
import { connectDB } from '../../../lib/db';
import { Product, Log, Inventory, StockLog } from '../../../lib/models';
import { getAuthUser } from '../../../lib/auth';

/* POST — admin only
 * Body: { productId: number, size: string, qty: number, note?: string }
 * Decrements stock for the given size (floors at 0), appends a StockLog
 * entry, re-derives product.avail, and writes to the activity log.
 */
export const POST: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body      = await request.json();
    const productId = Number(body.productId);
    const size      = String(body.size ?? '').trim().slice(0, 10);
    const qty       = Math.max(1, Math.floor(Number(body.qty) || 1));
    const note      = String(body.note ?? '').slice(0, 300);

    if (!Number.isFinite(productId) || !size) {
      return new Response(JSON.stringify({ error: 'productId and size are required' }), { status: 400 });
    }

    await connectDB();

    const product = await Product.findOne({ id: productId }).lean() as any;
    if (!product) {
      return new Response(JSON.stringify({ error: 'Product not found' }), { status: 404 });
    }

    // Get or create an Inventory document
    let inv = await Inventory.findOne({ productId });
    if (!inv) {
      inv = new (Inventory as any)({ productId, productName: product.name, stock: [] });
    }

    // Find or initialise the size line
    const stockArr: any[] = (inv as any).stock;
    let line = stockArr.find((l: any) => l.size === size);
    if (!line) {
      stockArr.push({ size, qty: 0 });
      line = stockArr[stockArr.length - 1];
    }

    const qtyBefore = line.qty;
    const deduct    = Math.min(qty, qtyBefore); // never go below 0
    const qtyAfter  = qtyBefore - deduct;
    line.qty        = qtyAfter;
    (inv as any).updatedAt = new Date();
    await (inv as any).save();

    // Append StockLog
    await StockLog.create({
      productId,
      productName: product.name,
      size,
      delta:     -deduct,
      reason:    'sale',
      note,
      adminUser: user.username,
      qtyBefore,
      qtyAfter,
    });

    // Re-derive product.avail from current inventory
    const updatedInv = await Inventory.findOne({ productId }).lean() as any;
    const newAvail = ((updatedInv?.stock ?? []) as any[])
      .filter((l: any) => l.qty > 0 && (product.sizes ?? []).includes(l.size))
      .map((l: any) => l.size);
    await Product.updateOne({ id: productId }, { avail: newAvail });

    // Activity log
    const oosNote = qtyAfter === 0 ? ' — now out of stock' : '';
    await Log.create({
      username: user.username,
      action:   'record_sale',
      detail:   `Sold ${deduct}× ${size} of "${product.name}"${oosNote}`,
      ip:       request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '',
    });

    return new Response(
      JSON.stringify({ ok: true, qtyBefore, qtyAfter, deduct }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (err) {
    console.error('[POST /api/inventory/sale]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};

/* PATCH — admin only
 * Body: { id: string, qty: number, note?: string }
 * Edits an existing sale log entry, adjusting inventory by the delta
 * between the old and new qty.
 */
export const PATCH: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body   = await request.json();
    const id     = String(body.id ?? '').trim();
    const newQty = Math.max(1, Math.floor(Number(body.qty) || 1));
    const note   = String(body.note ?? '').slice(0, 300);

    if (!id) {
      return new Response(JSON.stringify({ error: 'id is required' }), { status: 400 });
    }

    await connectDB();

    const entry = await StockLog.findById(id) as any;
    if (!entry || entry.reason !== 'sale') {
      return new Response(JSON.stringify({ error: 'Sale log not found' }), { status: 404 });
    }

    const oldDeduct = Math.abs(entry.delta); // original units sold
    const diff      = newQty - oldDeduct;    // positive = sold more, negative = sold fewer

    // Adjust inventory
    const inv = await Inventory.findOne({ productId: entry.productId });
    if (inv) {
      const stockArr: any[] = (inv as any).stock;
      let line = stockArr.find((l: any) => l.size === entry.size);
      if (!line) {
        stockArr.push({ size: entry.size, qty: 0 });
        line = stockArr[stockArr.length - 1];
      }
      line.qty = Math.max(0, line.qty - diff);
      (inv as any).updatedAt = new Date();
      await (inv as any).save();

      // Re-derive avail
      const product = await Product.findOne({ id: entry.productId }).lean() as any;
      if (product) {
        const newAvail = ((inv as any).stock as any[])
          .filter((l: any) => l.qty > 0 && (product.sizes ?? []).includes(l.size))
          .map((l: any) => l.size);
        await Product.updateOne({ id: entry.productId }, { avail: newAvail });
      }
    }

    // Update the log entry
    entry.delta    = -newQty;
    entry.qtyAfter = entry.qtyBefore - newQty;
    entry.note     = note;
    await entry.save();

    await Log.create({
      username: user.username,
      action:   'edit_sale',
      detail:   `Edited sale log for "${entry.productName}" ${entry.size}: ${oldDeduct} → ${newQty}`,
      ip:       request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '',
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[PATCH /api/inventory/sale]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};

/* DELETE — admin only
 * Body: { id: string }
 * Deletes a sale log entry and reverses the inventory deduction.
 */
export const DELETE: APIRoute = async ({ request }) => {
  const user = getAuthUser(request);
  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  try {
    const body = await request.json();
    const id   = String(body.id ?? '').trim();

    if (!id) {
      return new Response(JSON.stringify({ error: 'id is required' }), { status: 400 });
    }

    await connectDB();

    const entry = await StockLog.findById(id) as any;
    if (!entry || entry.reason !== 'sale') {
      return new Response(JSON.stringify({ error: 'Sale log not found' }), { status: 404 });
    }

    const deduct = Math.abs(entry.delta);

    // Restore inventory
    const inv = await Inventory.findOne({ productId: entry.productId });
    if (inv) {
      const stockArr: any[] = (inv as any).stock;
      let line = stockArr.find((l: any) => l.size === entry.size);
      if (!line) {
        stockArr.push({ size: entry.size, qty: 0 });
        line = stockArr[stockArr.length - 1];
      }
      line.qty += deduct;
      (inv as any).updatedAt = new Date();
      await (inv as any).save();

      // Re-derive avail
      const product = await Product.findOne({ id: entry.productId }).lean() as any;
      if (product) {
        const newAvail = ((inv as any).stock as any[])
          .filter((l: any) => l.qty > 0 && (product.sizes ?? []).includes(l.size))
          .map((l: any) => l.size);
        await Product.updateOne({ id: entry.productId }, { avail: newAvail });
      }
    }

    await StockLog.deleteOne({ _id: id });

    await Log.create({
      username: user.username,
      action:   'delete_sale',
      detail:   `Deleted sale log for "${entry.productName}" ${entry.size} ×${deduct} (restored stock)`,
      ip:       request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? '',
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[DELETE /api/inventory/sale]', err);
    return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
  }
};
