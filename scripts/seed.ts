/**
 * Seeds a demo shop so you can click through the whole flow locally.
 *
 *   DATABASE_URL=... npm run seed
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { schema, tenants, users, categories, products } from "../src/db/schema";
import { hashPassword } from "../src/lib/auth";
import { parseRupeesToPaise } from "../src/lib/pricing";

const CATALOGUE: [string, [string, number, number, string][]][] = [
  [
    "Sparklers",
    [
      ["7cm Electric Sparklers", 60, 80, "packet"],
      ["15cm Colour Sparklers", 120, 80, "packet"],
      ["30cm Green Sparklers", 250, 75, "packet"],
    ],
  ],
  [
    "Flower Pots",
    [
      ["Flower Pot Small", 180, 78, "box"],
      ["Flower Pot Big", 500, 80, "box"],
      ["Flower Pot Special", 850, 75, "box"],
    ],
  ],
  [
    "Ground Chakkar",
    [
      ["Ground Chakkar Small", 200, 80, "box"],
      ["Ground Chakkar Big", 420, 78, "box"],
    ],
  ],
  [
    "Rockets",
    [
      ["Lakshmi Rocket", 300, 75, "box"],
      ["Whistling Rocket", 480, 72, "box"],
    ],
  ],
  [
    "Aerial Fancy",
    [
      ["12 Shots Multicolour", 1200, 70, "box"],
      ["30 Shots Sky Show", 2800, 68, "box"],
      ["60 Shots Grand Finale", 5500, 65, "box"],
    ],
  ],
  [
    "Gift Boxes",
    [
      ["Family Pack 30 Items", 1800, 60, "box"],
      ["Premium Pack 55 Items", 3500, 58, "box"],
    ],
  ],
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const pool = new pg.Pool({ connectionString: url });
  const db = drizzle(pool, { schema });

  try {
    const slug = "anil-crackers";
    await db.delete(tenants).where(eq(tenants.slug, slug));

    const [shop] = await db
      .insert(tenants)
      .values({
        slug,
        shopName: "Anil Crackers",
        customDomain: "anilcrackers.test",
        status: "active",
        phone: "9842012345",
        whatsapp: "9842012345",
        email: "orders@anilcrackers.test",
        addressLine: "45 Sattur Road",
        city: "Sivakasi",
        state: "Tamil Nadu",
        pincode: "626123",
        licenseNumber: "E/SE/TN/22/1234",
        upiId: "anilcrackers@okaxis",
        bankAccountName: "Anil Crackers",
        bankAccountNumber: "50100123456789",
        bankIfsc: "HDFC0001234",
        minOrderValue: parseRupeesToPaise(2500),
        themeConfig: {
          primaryColor: "#c62828",
          accentColor: "#f9a825",
          tagline: "Direct from Sivakasi since 1994",
        },
      })
      .returning();

    await db.insert(users).values({
      tenantId: shop.id,
      email: "owner@anilcrackers.test",
      name: "Anil",
      role: "shop_owner",
      passwordHash: await hashPassword("crackers2026"),
    });

    let categorySort = 0;
    let productSort = 0;

    for (const [categoryName, items] of CATALOGUE) {
      const [category] = await db
        .insert(categories)
        .values({ tenantId: shop.id, name: categoryName, sortOrder: categorySort++ })
        .returning();

      for (const [name, rupees, discount, unit] of items) {
        await db.insert(products).values({
          tenantId: shop.id,
          categoryId: category.id,
          name,
          mrp: parseRupeesToPaise(rupees),
          discountPct: discount,
          unit,
          sortOrder: productSort++,
        });
      }
    }

    console.log(`Seeded "${shop.shopName}"`);
    console.log(`  slug:     ${shop.slug}`);
    console.log(`  login:    owner@anilcrackers.test / crackers2026`);
    console.log(`  products: ${productSort}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
