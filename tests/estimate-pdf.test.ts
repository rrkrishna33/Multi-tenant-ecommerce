import { describe, it, expect } from "vitest";
import {
  buildEstimatePdf,
  estimateFilename,
  type EstimateData,
  type EstimateItem,
} from "../src/lib/estimate-pdf";

const shop = {
  shopName: "Anil Crackers",
  addressLine: "45 Sattur Road",
  city: "Sivakasi",
  state: "Tamil Nadu",
  pincode: "626123",
  phone: "9842012345",
  whatsapp: "9842012345",
  email: "orders@anilcrackers.test",
  gstin: "33ABCDE1234F1Z5",
  licenseNumber: "E/SE/TN/22/1234",
  upiId: "anilcrackers@okaxis",
  bankAccountName: "Anil Crackers",
  bankAccountNumber: "50100123456789",
  bankIfsc: "HDFC0001234",
};

const order = {
  orderNumber: 7,
  createdAt: new Date("2026-10-15T10:00:00Z"),
  status: "pending",
  customerName: "Ravi Kumar",
  customerPhone: "9842012345",
  addressLine: "12 Anna Nagar, Main Road",
  city: "Madurai",
  state: "Tamil Nadu",
  pincode: "625001",
  notes: "Deliver before Diwali",
  subtotal: 40000,
  transportName: null,
  transportLrNumber: null,
  paymentRef: null,
};

const item = (over: Partial<EstimateItem> = {}): EstimateItem => ({
  productName: "Flower Pot Big",
  unit: "box",
  mrp: 100000,
  discountPct: 80,
  unitPrice: 20000,
  quantity: 2,
  lineTotal: 40000,
  ...over,
});

const data = (over: Partial<EstimateData> = {}): EstimateData => ({
  shop,
  order,
  items: [item()],
  ...over,
});

/**
 * Renders uncompressed and reconstructs the drawn text.
 *
 * PDFKit writes each run as a TJ array of hex strings split by kerning
 * adjustments -- `[<416e696c2043726163> 20 <6b6572> 15 <73> 0] TJ` -- so a
 * plain substring search over the raw buffer silently matches only the PDF
 * metadata and would pass no matter what the page actually said.
 */
async function render(input: EstimateData): Promise<{ buf: Buffer; text: string }> {
  const buf = await buildEstimatePdf(input, { compress: false });
  const raw = buf.toString("latin1");

  const runs: string[] = [];
  for (const block of raw.match(/\[[^\]]*\]\s*TJ/g) ?? []) {
    let run = "";
    for (const hex of block.match(/<([0-9a-fA-F]+)>/g) ?? []) {
      run += Buffer.from(hex.slice(1, -1), "hex").toString("latin1");
    }
    if (run) runs.push(run);
  }

  return { buf, text: runs.join("\n") };
}

/** Counts rendered pages from the page objects in the document. */
function pageCount(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;
}

describe("buildEstimatePdf", () => {
  it("produces a valid PDF", async () => {
    const { buf } = await render(data());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.subarray(-6).toString()).toContain("%%EOF");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("carries the shop, estimate number and customer", async () => {
    const { text } = await render(data());
    expect(text).toContain("Anil Crackers");
    expect(text).toContain("EST-0007");
    expect(text).toContain("Ravi Kumar");
    expect(text).toContain("Madurai");
    expect(text).toContain("Deliver before Diwali");
  });

  it("shows the shop's licence and GSTIN, which estimates are expected to carry", async () => {
    const { text } = await render(data());
    expect(text).toContain("E/SE/TN/22/1234");
    expect(text).toContain("33ABCDE1234F1Z5");
  });

  it("prints line items with rate, quantity and amount", async () => {
    const { text } = await render(data());
    expect(text).toContain("Flower Pot Big");
    expect(text).toContain("Rs. 200.00"); // unit price
    expect(text).toContain("Rs. 400.00"); // line total and payable
    expect(text).toContain("80% off");
  });

  it("shows MRP savings, the headline number in this category", async () => {
    const { text } = await render(data());
    expect(text).toContain("Total MRP");
    expect(text).toContain("Rs. 2,000.00"); // 2 x MRP 1000
    expect(text).toContain("You save");
    expect(text).toContain("Rs. 1,600.00");
  });

  it("omits the savings rows when nothing was discounted", async () => {
    const { text } = await render(
      data({
        items: [item({ mrp: 20000, discountPct: 0, unitPrice: 20000, lineTotal: 40000 })],
      }),
    );
    expect(text).not.toContain("You save");
    expect(text).toContain("Total payable");
  });

  it("includes payment details while unpaid", async () => {
    const { text } = await render(data());
    expect(text).toContain("How to pay");
    expect(text).toContain("anilcrackers@okaxis");
    expect(text).toContain("50100123456789");
  });

  it("replaces payment instructions with the reference once paid", async () => {
    const { text } = await render(
      data({ order: { ...order, status: "paid", paymentRef: "UPI-998877" } }),
    );
    expect(text).toContain("PAYMENT RECEIVED");
    expect(text).toContain("UPI-998877");
    expect(text).not.toContain("How to pay");
  });

  it("falls back gracefully when the shop has set no payment details", async () => {
    const { text } = await render(
      data({
        shop: { ...shop, upiId: null, bankAccountNumber: null, bankIfsc: null, bankAccountName: null },
      }),
    );
    expect(text).toContain("contact the shop");
  });

  it("shows dispatch details once despatched", async () => {
    const { text } = await render(
      data({
        order: { ...order, transportName: "KPN Travels", transportLrNumber: "LR-4471" },
      }),
    );
    expect(text).toContain("KPN Travels");
    expect(text).toContain("LR-4471");
  });

  it("carries the regulatory footer", async () => {
    const { text } = await render(data());
    expect(text).toContain("not a tax invoice");
    expect(text).toContain("licensed road transport");
  });

  it("paginates a large Diwali order instead of running off the page", async () => {
    const items = Array.from({ length: 80 }, (_, i) =>
      item({ productName: `Product number ${i + 1}`, quantity: i + 1, lineTotal: 20000 * (i + 1) }),
    );
    const { buf, text } = await render(data({ items }));

    // More than one page, and the last item still made it in.
    expect(pageCount(buf)).toBeGreaterThan(1);
    expect(text).toContain("Product number 80");
    expect(buf.length).toBeGreaterThan(5000);
  });

  it("repeats the column header on continuation pages", async () => {
    const items = Array.from({ length: 80 }, () => item());
    const { text } = await render(data({ items }));
    const headers = (text.match(/AMOUNT/g) ?? []).length;
    expect(headers).toBeGreaterThan(1);
  });

  it("survives a shop with almost no details filled in", async () => {
    const bare = {
      shopName: "New Shop",
      addressLine: null, city: null, state: null, pincode: null,
      phone: null, whatsapp: null, email: null, gstin: null, licenseNumber: null,
      upiId: null, bankAccountName: null, bankAccountNumber: null, bankIfsc: null,
    };
    const { buf } = await render(data({ shop: bare, order: { ...order, notes: null } }));
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles a very long product name without throwing", async () => {
    const { buf } = await render(
      data({ items: [item({ productName: "Deluxe ".repeat(30) + "Gift Box" })] }),
    );
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("handles a single-item order and a large item count identically in validity", async () => {
    for (const count of [1, 5, 40]) {
      const { buf } = await render(
        data({ items: Array.from({ length: count }, () => item()) }),
      );
      expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    }
  });

  it("compresses by default, producing a smaller file", async () => {
    const items = Array.from({ length: 40 }, () => item());
    const compressed = await buildEstimatePdf(data({ items }));
    const plain = await buildEstimatePdf(data({ items }), { compress: false });
    expect(compressed.length).toBeLessThan(plain.length);
  });
});

describe("estimateFilename", () => {
  it("builds a readable, safe filename", () => {
    expect(estimateFilename("Anil Crackers", 7)).toBe("Anil-Crackers-EST-0007.pdf");
  });

  it("strips characters that would break a download", () => {
    expect(estimateFilename("Sri Murugan & Co. / Fireworks", 12)).toBe(
      "Sri-Murugan-Co-Fireworks-EST-0012.pdf",
    );
    expect(estimateFilename("../../etc/passwd", 1)).toBe("etc-passwd-EST-0001.pdf");
  });

  it("falls back when the name has nothing usable", () => {
    expect(estimateFilename("!!!", 3)).toBe("estimate-EST-0003.pdf");
  });
});
