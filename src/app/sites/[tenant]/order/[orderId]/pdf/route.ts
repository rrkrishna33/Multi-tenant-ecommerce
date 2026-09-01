import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db";
import { orders, orderItems, tenants } from "@/db/schema";
import { getTenantByKey } from "@/lib/tenant-db";
import { buildEstimatePdf, estimateFilename } from "@/lib/estimate-pdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Downloadable estimate.
 *
 * Exists so a shop can attach the estimate to an email or send it on WhatsApp
 * as a file. The HTML page at the parent route stays the primary surface --
 * this is the version that survives being forwarded.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ tenant: string; orderId: string }> },
) {
  const { tenant: key, orderId } = await params;

  const resolved = await getTenantByKey(key);
  if (!resolved) return new NextResponse("Not found", { status: 404 });

  const data = await withTenant(getDb(), resolved.id, async (tx) => {
    // RLS scopes these reads, so an order id belonging to another shop is
    // simply not visible here -- the same boundary the HTML page relies on.
    const [order] = await tx.select().from(orders).where(eq(orders.id, orderId));
    if (!order) return null;
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
    const [shop] = await tx.select().from(tenants).where(eq(tenants.id, resolved.id));
    return { order, items, shop };
  });

  if (!data) return new NextResponse("Not found", { status: 404 });
  const { order, items, shop } = data;

  const pdf = await buildEstimatePdf({
    shop: {
      shopName: shop.shopName,
      addressLine: shop.addressLine,
      city: shop.city,
      state: shop.state,
      pincode: shop.pincode,
      phone: shop.phone,
      whatsapp: shop.whatsapp,
      email: shop.email,
      gstin: shop.gstin,
      licenseNumber: shop.licenseNumber,
      upiId: shop.upiId,
      bankAccountName: shop.bankAccountName,
      bankAccountNumber: shop.bankAccountNumber,
      bankIfsc: shop.bankIfsc,
    },
    order: {
      orderNumber: order.orderNumber,
      createdAt: order.createdAt,
      status: order.status,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      addressLine: order.addressLine,
      city: order.city,
      state: order.state,
      pincode: order.pincode,
      notes: order.notes,
      subtotal: order.subtotal,
      transportName: order.transportName,
      transportLrNumber: order.transportLrNumber,
      paymentRef: order.paymentRef,
    },
    items: items.map((i: any) => ({
      productName: i.productName,
      unit: i.unit,
      mrp: i.mrp,
      discountPct: i.discountPct,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
  });

  const filename = estimateFilename(shop.shopName, order.orderNumber);

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(pdf.length),
      "Content-Disposition": `attachment; filename="${filename}"`,
      // An estimate changes when the shop records payment or dispatch, so it
      // must never be cached.
      "Cache-Control": "no-store",
    },
  });
}
