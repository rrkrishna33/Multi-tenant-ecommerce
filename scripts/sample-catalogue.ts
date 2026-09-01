/**
 * Loads a realistic Sivakasi price list into one shop.
 *
 *   npm run sample-catalogue -- <slug>        (default: rvcrackers)
 *   npm run sample-catalogue -- <slug> --clear
 *
 * This is what a shop's own price list actually looks like: ten categories in
 * the order every Sivakasi list uses, Tamil names beside the English ones,
 * prices as MRP plus a 60-85% discount, and pieces-per-unit where a customer
 * would ask. It exists so a new shop -- or a demo -- has something worth
 * scrolling through before the owner imports their real CSV.
 *
 * Inserts go through withTenant(), the same path the app uses, so row-level
 * security is in force here too. Re-running it is safe: products are keyed by
 * SKU and existing ones are left alone.
 */
import { eq, and, sql } from "drizzle-orm";
import { getDb, withTenant } from "../src/db";
import { tenants, categories, products } from "../src/db/schema";
import { parseRupeesToPaise, salePrice, formatInr } from "../src/lib/pricing";

type Item = {
  sku: string;
  name: string;
  nameTa?: string;
  /** MRP in rupees. */
  mrp: number;
  discount: number;
  unit: string;
  pieces?: number;
  stock?: number;
};

const CATALOGUE: { category: string; nameTa?: string; items: Item[] }[] = [
  {
    category: "One Sound Crackers",
    nameTa: "ஒரு சத்த வெடி",
    items: [
      { sku: "OS-001", name: "2 3/4 inch Lakshmi Deluxe", nameTa: "லட்சுமி வெடி", mrp: 180, discount: 80, unit: "packet", pieces: 10 },
      { sku: "OS-002", name: "3 1/2 inch Lakshmi Deluxe", mrp: 260, discount: 80, unit: "packet", pieces: 10 },
      { sku: "OS-003", name: "4 inch Kuruvi Special", mrp: 340, discount: 78, unit: "packet", pieces: 10 },
      { sku: "OS-004", name: "Classic Ram Bomb", mrp: 420, discount: 78, unit: "packet", pieces: 10 },
      { sku: "OS-005", name: "Hydro Bomb", mrp: 560, discount: 75, unit: "packet", pieces: 10 },
      { sku: "OS-006", name: "Digital Bomb", mrp: 690, discount: 75, unit: "packet", pieces: 10 },
    ],
  },
  {
    category: "Bijili Crackers",
    nameTa: "பிஜிலி",
    items: [
      { sku: "BJ-001", name: "Bijili 50 Pieces", nameTa: "பிஜிலி 50", mrp: 150, discount: 82, unit: "packet", pieces: 50 },
      { sku: "BJ-002", name: "Bijili 100 Pieces", mrp: 280, discount: 82, unit: "packet", pieces: 100 },
      { sku: "BJ-003", name: "Stripped Bijili 50 Pieces", mrp: 190, discount: 80, unit: "packet", pieces: 50 },
    ],
  },
  {
    category: "Ground Chakkar",
    nameTa: "தரை சக்கரம்",
    items: [
      { sku: "GC-001", name: "Ground Chakkar Small", nameTa: "சிறிய தரை சக்கரம்", mrp: 200, discount: 80, unit: "box", pieces: 10 },
      { sku: "GC-002", name: "Ground Chakkar Big", mrp: 420, discount: 78, unit: "box", pieces: 10 },
      { sku: "GC-003", name: "Ground Chakkar Special", mrp: 620, discount: 76, unit: "box", pieces: 10 },
      { sku: "GC-004", name: "Deluxe Chakkar Asoka", mrp: 880, discount: 75, unit: "box", pieces: 10 },
      { sku: "GC-005", name: "Peacock Chakkar", nameTa: "மயில் சக்கரம்", mrp: 1150, discount: 72, unit: "box", pieces: 10 },
    ],
  },
  {
    category: "Flower Pots",
    nameTa: "பூச்சட்டி",
    items: [
      { sku: "FP-001", name: "Flower Pot Small", nameTa: "சிறிய பூச்சட்டி", mrp: 180, discount: 80, unit: "box", pieces: 10 },
      { sku: "FP-002", name: "Flower Pot Big", nameTa: "பெரிய பூச்சட்டி", mrp: 500, discount: 80, unit: "box", pieces: 10 },
      { sku: "FP-003", name: "Flower Pot Special", mrp: 850, discount: 76, unit: "box", pieces: 10 },
      { sku: "FP-004", name: "Colour Koti Flower Pot", mrp: 1250, discount: 74, unit: "box", pieces: 10 },
      { sku: "FP-005", name: "Giant Flower Pot", mrp: 1900, discount: 70, unit: "box", pieces: 5 },
    ],
  },
  {
    category: "Twinkling Stars & Pencils",
    items: [
      { sku: "TS-001", name: "Twinkling Star Small", mrp: 160, discount: 80, unit: "packet", pieces: 10 },
      { sku: "TS-002", name: "Twinkling Star Big", mrp: 320, discount: 78, unit: "packet", pieces: 10 },
      { sku: "TS-003", name: "Colour Pencil 10 Pieces", mrp: 240, discount: 78, unit: "packet", pieces: 10 },
      { sku: "TS-004", name: "Photo Flash 10 Pieces", mrp: 300, discount: 76, unit: "packet", pieces: 10 },
      { sku: "TS-005", name: "Magic Whistle", mrp: 380, discount: 75, unit: "packet", pieces: 10 },
    ],
  },
  {
    category: "Sparklers",
    nameTa: "மத்தாப்பு",
    items: [
      { sku: "SP-001", name: "7cm Electric Sparklers", nameTa: "மின்சார மத்தாப்பு", mrp: 60, discount: 80, unit: "packet", pieces: 50 },
      { sku: "SP-002", name: "10cm Electric Sparklers", mrp: 90, discount: 80, unit: "packet", pieces: 50 },
      { sku: "SP-003", name: "15cm Colour Sparklers", mrp: 120, discount: 80, unit: "packet", pieces: 50 },
      { sku: "SP-004", name: "15cm Green Sparklers", mrp: 140, discount: 78, unit: "packet", pieces: 50 },
      { sku: "SP-005", name: "30cm Colour Sparklers", mrp: 250, discount: 76, unit: "packet", pieces: 25 },
      { sku: "SP-006", name: "50cm Golden Sparklers", mrp: 480, discount: 72, unit: "packet", pieces: 25 },
      { sku: "SP-007", name: "Cake Candle Sparklers", mrp: 130, discount: 70, unit: "packet", pieces: 10 },
    ],
  },
  {
    category: "Rockets",
    nameTa: "ராக்கெட்",
    items: [
      { sku: "RK-001", name: "Lakshmi Rocket", nameTa: "லட்சுமி ராக்கெட்", mrp: 300, discount: 76, unit: "packet", pieces: 10 },
      { sku: "RK-002", name: "Whistling Rocket", nameTa: "விசில் ராக்கெட்", mrp: 480, discount: 74, unit: "packet", pieces: 10 },
      { sku: "RK-003", name: "Colour Rocket Bomb", mrp: 620, discount: 72, unit: "packet", pieces: 10 },
      { sku: "RK-004", name: "Two Sound Rocket", mrp: 780, discount: 70, unit: "packet", pieces: 10 },
    ],
  },
  {
    category: "Fancy Novelties",
    items: [
      { sku: "FN-001", name: "Butterfly Small", mrp: 220, discount: 78, unit: "box", pieces: 10 },
      { sku: "FN-002", name: "Butterfly Big", mrp: 420, discount: 76, unit: "box", pieces: 10 },
      { sku: "FN-003", name: "Chotta Bheem Special", mrp: 340, discount: 76, unit: "box", pieces: 10 },
      { sku: "FN-004", name: "Spinning Top Colour", mrp: 380, discount: 75, unit: "box", pieces: 10 },
      { sku: "FN-005", name: "Musical Fountain", mrp: 650, discount: 72, unit: "box", pieces: 5 },
      { sku: "FN-006", name: "Siren Whistle", mrp: 290, discount: 75, unit: "box", pieces: 10 },
      { sku: "FN-007", name: "Ring Cap Roll 100 Shots", mrp: 110, discount: 70, unit: "packet", pieces: 100 },
    ],
  },
  {
    category: "Fountains",
    items: [
      { sku: "FT-001", name: "Colour Fountain 30 Seconds", mrp: 450, discount: 74, unit: "piece" },
      { sku: "FT-002", name: "Colour Fountain 60 Seconds", mrp: 780, discount: 72, unit: "piece" },
      { sku: "FT-003", name: "Silver Fountain Jumbo", mrp: 1200, discount: 70, unit: "piece" },
      { sku: "FT-004", name: "Rainbow Fountain", mrp: 1650, discount: 68, unit: "piece" },
    ],
  },
  {
    category: "Aerial Shots",
    nameTa: "ஏரியல் ஷாட்ஸ்",
    items: [
      { sku: "AS-001", name: "12 Shots Multicolour", mrp: 1200, discount: 70, unit: "box", stock: 60 },
      { sku: "AS-002", name: "15 Shots Colour Peonies", mrp: 1600, discount: 68, unit: "box", stock: 45 },
      { sku: "AS-003", name: "24 Shots Sky Show", mrp: 2400, discount: 68, unit: "box", stock: 40 },
      { sku: "AS-004", name: "30 Shots Rainbow Sky", mrp: 2800, discount: 66, unit: "box", stock: 30 },
      { sku: "AS-005", name: "60 Shots Grand Finale", mrp: 5500, discount: 64, unit: "box", stock: 18 },
      { sku: "AS-006", name: "100 Shots Mega Display", mrp: 9500, discount: 62, unit: "box", stock: 8 },
      { sku: "AS-007", name: "3 inch Aerial Shell", mrp: 1800, discount: 66, unit: "box", stock: 25 },
    ],
  },
  {
    category: "Kids Special",
    nameTa: "குழந்தைகள் சிறப்பு",
    items: [
      { sku: "KS-001", name: "Snake Tablet", mrp: 70, discount: 72, unit: "packet", pieces: 10 },
      { sku: "KS-002", name: "Pop Pop Crackers", mrp: 90, discount: 70, unit: "packet", pieces: 50 },
      { sku: "KS-003", name: "Colour Smoke Stick", mrp: 150, discount: 72, unit: "packet", pieces: 10 },
      { sku: "KS-004", name: "Magic Wand Sparkler", mrp: 190, discount: 74, unit: "packet", pieces: 10 },
      { sku: "KS-005", name: "Toy Gun Caps", mrp: 60, discount: 70, unit: "packet", pieces: 100 },
    ],
  },
  {
    category: "Gift Boxes",
    nameTa: "பரிசுப் பெட்டி",
    items: [
      { sku: "GB-001", name: "Mini Family Pack 20 Items", mrp: 1100, discount: 60, unit: "box", stock: 50 },
      { sku: "GB-002", name: "Family Pack 30 Items", mrp: 1800, discount: 58, unit: "box", stock: 40 },
      { sku: "GB-003", name: "Super Saver Pack 45 Items", mrp: 2600, discount: 56, unit: "box", stock: 30 },
      { sku: "GB-004", name: "Premium Pack 55 Items", mrp: 3500, discount: 55, unit: "box", stock: 20 },
      { sku: "GB-005", name: "10K Customised Golden Combo", mrp: 10000, discount: 50, unit: "box", stock: 10 },
    ],
  },
];

async function main() {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith("--")) ?? "rvcrackers";
  const clear = args.includes("--clear");

  const db = getDb();

  // tenants is the one table outside RLS -- routing has to resolve a host
  // before any tenant context exists.
  const [shop] = await db.select().from(tenants).where(eq(tenants.slug, slug));
  if (!shop) {
    throw new Error(`No shop with slug "${slug}". Check the slug in /platform.`);
  }

  const summary = await withTenant(db, shop.id, async (tx: any) => {
    if (clear) {
      await tx.delete(products);
      await tx.delete(categories);
    }

    let categorySort = 0;
    let productSort = 0;
    let inserted = 0;
    let skipped = 0;

    for (const group of CATALOGUE) {
      // Reuse a category the shop already has rather than creating a duplicate
      // with the same name.
      const existing = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.name, group.category));

      const categoryId =
        existing[0]?.id ??
        (
          await tx
            .insert(categories)
            .values({
              tenantId: shop.id,
              name: group.category,
              nameTa: group.nameTa ?? null,
              sortOrder: categorySort,
            })
            .returning({ id: categories.id })
        )[0].id;
      categorySort++;

      for (const item of group.items) {
        const already = await tx
          .select({ id: products.id })
          .from(products)
          .where(and(eq(products.sku, item.sku)));

        if (already.length > 0) {
          skipped++;
          productSort++;
          continue;
        }

        await tx.insert(products).values({
          tenantId: shop.id,
          categoryId,
          name: item.name,
          nameTa: item.nameTa ?? null,
          sku: item.sku,
          mrp: parseRupeesToPaise(item.mrp),
          discountPct: item.discount,
          unit: item.unit,
          piecesPerUnit: item.pieces ?? null,
          stock: item.stock ?? null,
          sortOrder: productSort++,
        });
        inserted++;
      }
    }

    const [{ total }] = await tx
      .select({ total: sql<number>`count(*)::int` })
      .from(products);

    return { inserted, skipped, total };
  });

  const prices = CATALOGUE.flatMap((g) =>
    g.items.map((i) => salePrice(parseRupeesToPaise(i.mrp), i.discount)),
  );

  console.log(`Shop:        ${shop.shopName} (${shop.slug})`);
  console.log(`Categories:  ${CATALOGUE.length}`);
  console.log(`Inserted:    ${summary.inserted}`);
  if (summary.skipped) console.log(`Already there:${summary.skipped} (matched by SKU)`);
  console.log(`Total now:   ${summary.total} products`);
  console.log(
    `Prices:      ${formatInr(Math.min(...prices))} - ${formatInr(Math.max(...prices))}`,
  );
  console.log(`Minimum order: ${formatInr(shop.minOrderValue)}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
