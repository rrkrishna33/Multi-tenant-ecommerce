import PDFDocument from "pdfkit";
import { existsSync } from "node:fs";
import { formatInr } from "./pricing";
import { formatEstimateNumber } from "./orders";

/**
 * Server-rendered estimate PDF.
 *
 * Uses PDFKit rather than headless Chrome deliberately. Puppeteer would drag a
 * ~300 MB browser onto the VPS and spawn a process per render -- during the
 * Diwali peak that is the fastest route to an out-of-memory kill that takes
 * every shop down at once. PDFKit draws directly, in-process, in milliseconds.
 */

export type EstimateShop = {
  shopName: string;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  gstin: string | null;
  licenseNumber: string | null;
  upiId: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
  bankIfsc: string | null;
};

export type EstimateOrder = {
  orderNumber: number;
  createdAt: Date;
  status: string;
  customerName: string;
  customerPhone: string;
  addressLine: string;
  city: string;
  state: string;
  pincode: string;
  notes: string | null;
  subtotal: number;
  transportName: string | null;
  transportLrNumber: string | null;
  paymentRef: string | null;
};

export type EstimateItem = {
  productName: string;
  unit: string;
  mrp: number;
  discountPct: number;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
};

export type EstimateData = {
  shop: EstimateShop;
  order: EstimateOrder;
  items: EstimateItem[];
};

const PAGE_MARGIN = 40;
const INK = "#1a1a1a";
const MUTED = "#6b6b6b";
const LINE = "#dddddd";
const BRAND = "#c62828";

/**
 * A Unicode font is only needed for Tamil product names. Helvetica cannot
 * render Tamil at all -- it silently drops the glyphs rather than erroring --
 * so we check for an embedded font and fall back to transliterated-free output
 * when it is absent. Money is always written as "Rs." rather than the rupee
 * sign for the same reason: U+20B9 is not in Helvetica's WinAnsi encoding.
 */
function unicodeFontPath(): string | null {
  const configured = process.env.PDF_FONT_PATH;
  if (configured && existsSync(configured)) return configured;
  return null;
}

export type BuildOptions = {
  /** Tests turn compression off so the drawn text is readable in the buffer. */
  compress?: boolean;
};

export function buildEstimatePdf(
  data: EstimateData,
  options: BuildOptions = {},
): Promise<Buffer> {
  const { shop, order, items } = data;

  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    compress: options.compress ?? true,
    info: {
      Title: `${formatEstimateNumber(order.orderNumber)} - ${shop.shopName}`,
      Author: shop.shopName,
      Subject: "Estimate",
    },
  });

  const fontPath = unicodeFontPath();
  const BODY = fontPath ? "Body" : "Helvetica";
  const BOLD = fontPath ? "Body" : "Helvetica-Bold";
  if (fontPath) doc.registerFont("Body", fontPath);

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = PAGE_MARGIN;
  const right = doc.page.width - PAGE_MARGIN;
  const width = right - left;

  // ---- header -----------------------------------------------------------
  doc.font(BOLD).fontSize(18).fillColor(BRAND).text(shop.shopName, left, PAGE_MARGIN);

  const addressLines = [
    shop.addressLine,
    [shop.city, shop.pincode].filter(Boolean).join(" - "),
    shop.state,
    shop.phone ? `Phone: ${shop.phone}` : null,
    shop.gstin ? `GSTIN: ${shop.gstin}` : null,
    shop.licenseNumber ? `Licence: ${shop.licenseNumber}` : null,
  ].filter((l): l is string => Boolean(l && l.trim()));

  doc.font(BODY).fontSize(9).fillColor(MUTED);
  for (const line of addressLines) doc.text(line, left, doc.y, { width: width * 0.55 });

  // Estimate box, top right
  const boxTop = PAGE_MARGIN;
  doc.font(BOLD).fontSize(16).fillColor(INK).text("ESTIMATE", right - 180, boxTop, {
    width: 180,
    align: "right",
  });
  doc.font(BODY).fontSize(10).fillColor(INK);
  doc.text(formatEstimateNumber(order.orderNumber), right - 180, doc.y, {
    width: 180,
    align: "right",
  });
  doc.fillColor(MUTED).text(
    order.createdAt.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    right - 180,
    doc.y,
    { width: 180, align: "right" },
  );
  doc.font(BOLD).fillColor(order.status === "paid" ? "#1b7f3b" : "#b45309").text(
    order.status === "paid" ? "PAYMENT RECEIVED" : "AWAITING PAYMENT",
    right - 180,
    doc.y + 2,
    { width: 180, align: "right" },
  );

  let y = Math.max(doc.y, boxTop + 90) + 14;
  rule(doc, left, right, y);
  y += 12;

  // ---- customer ---------------------------------------------------------
  doc.font(BOLD).fontSize(10).fillColor(INK).text("Deliver to", left, y);
  y = doc.y + 2;
  doc.font(BODY).fontSize(10).fillColor(INK).text(order.customerName, left, y);
  doc.fontSize(9).fillColor(MUTED);
  doc.text(order.customerPhone, left, doc.y);
  doc.text(
    `${order.addressLine}, ${order.city}, ${order.state} - ${order.pincode}`,
    left,
    doc.y,
    { width: width * 0.6 },
  );
  if (order.notes) doc.text(`Note: ${order.notes}`, left, doc.y, { width: width * 0.6 });

  y = doc.y + 16;

  // ---- items table ------------------------------------------------------
  const cols = {
    sno: left,
    item: left + 28,
    rate: left + 300,
    qty: left + 380,
    amount: left + 440,
  };
  const colEnd = right;

  const drawHead = (top: number) => {
    doc.font(BOLD).fontSize(9).fillColor(MUTED);
    doc.text("#", cols.sno, top);
    doc.text("ITEM", cols.item, top);
    doc.text("RATE", cols.rate, top, { width: 70, align: "right" });
    doc.text("QTY", cols.qty, top, { width: 50, align: "right" });
    doc.text("AMOUNT", cols.amount, top, { width: colEnd - cols.amount, align: "right" });
    const bottom = top + 14;
    rule(doc, left, right, bottom);
    return bottom + 6;
  };

  y = drawHead(y);

  const bottomLimit = doc.page.height - PAGE_MARGIN - 90;
  let totalMrp = 0;

  items.forEach((item, index) => {
    // A 60-line Diwali order will not fit on one page; break cleanly and
    // repeat the header rather than letting rows run off the bottom.
    if (y > bottomLimit) {
      doc.addPage();
      y = PAGE_MARGIN;
      y = drawHead(y);
    }

    totalMrp += item.mrp * item.quantity;

    doc.font(BODY).fontSize(9).fillColor(INK);
    doc.text(String(index + 1), cols.sno, y, { width: 24 });
    doc.text(item.productName, cols.item, y, { width: cols.rate - cols.item - 8 });
    const nameBottom = doc.y;

    doc.text(formatInr(item.unitPrice), cols.rate, y, { width: 70, align: "right" });
    doc.text(String(item.quantity), cols.qty, y, { width: 50, align: "right" });
    doc.font(BOLD).text(formatInr(item.lineTotal), cols.amount, y, {
      width: colEnd - cols.amount,
      align: "right",
    });

    doc.font(BODY).fontSize(7.5).fillColor(MUTED);
    doc.text(
      `Per ${item.unit} · MRP ${formatInr(item.mrp)} (${item.discountPct}% off)`,
      cols.item,
      nameBottom,
      { width: cols.rate - cols.item - 8 },
    );

    y = Math.max(doc.y, nameBottom) + 6;
    rule(doc, left, right, y - 3, LINE);
  });

  // ---- totals -----------------------------------------------------------
  const savings = totalMrp - order.subtotal;
  if (y > doc.page.height - PAGE_MARGIN - 120) {
    doc.addPage();
    y = PAGE_MARGIN;
  }

  y += 6;
  const labelX = cols.rate - 60;
  const labelW = cols.amount - labelX - 8;

  if (savings > 0) {
    doc.font(BODY).fontSize(9).fillColor(MUTED);
    doc.text("Total MRP", labelX, y, { width: labelW, align: "right" });
    doc.text(formatInr(totalMrp), cols.amount, y, {
      width: colEnd - cols.amount,
      align: "right",
    });
    y = doc.y + 4;
  }

  doc.font(BOLD).fontSize(12).fillColor(INK);
  doc.text("Total payable", labelX, y, { width: labelW, align: "right" });
  doc.text(formatInr(order.subtotal), cols.amount, y, {
    width: colEnd - cols.amount,
    align: "right",
  });
  y = doc.y + 4;

  if (savings > 0) {
    doc.font(BODY).fontSize(9).fillColor("#1b7f3b");
    doc.text("You save", labelX, y, { width: labelW, align: "right" });
    doc.text(formatInr(savings), cols.amount, y, {
      width: colEnd - cols.amount,
      align: "right",
    });
    y = doc.y;
  }

  y += 16;
  rule(doc, left, right, y);
  y += 12;

  // ---- payment ----------------------------------------------------------
  if (order.status !== "paid") {
    doc.font(BOLD).fontSize(10).fillColor(INK).text("How to pay", left, y);
    y = doc.y + 4;
    doc.font(BODY).fontSize(9).fillColor(INK);

    if (shop.upiId) {
      doc.text(`UPI: ${shop.upiId}`, left, y);
      y = doc.y + 2;
    }
    if (shop.bankAccountNumber) {
      doc.text(
        `Bank: ${shop.bankAccountName ?? shop.shopName} · A/c ${shop.bankAccountNumber} · IFSC ${shop.bankIfsc ?? ""}`.trim(),
        left,
        y,
        { width: width * 0.75 },
      );
      y = doc.y + 2;
    }
    if (!shop.upiId && !shop.bankAccountNumber) {
      doc.fillColor(MUTED).text(
        `Please contact the shop${shop.phone ? ` on ${shop.phone}` : ""} for payment details.`,
        left,
        y,
        { width: width * 0.75 },
      );
      y = doc.y + 2;
    }

    doc.fontSize(8).fillColor(MUTED).text(
      `After paying, send the reference${shop.whatsapp ? ` on WhatsApp ${shop.whatsapp}` : ""} quoting ${formatEstimateNumber(order.orderNumber)}.`,
      left,
      y + 2,
      { width: width * 0.75 },
    );
    y = doc.y + 10;
  } else if (order.paymentRef) {
    doc.font(BODY).fontSize(9).fillColor(MUTED).text(`Payment reference: ${order.paymentRef}`, left, y);
    y = doc.y + 10;
  }

  if (order.transportLrNumber) {
    doc.font(BOLD).fontSize(10).fillColor(INK).text("Dispatch", left, y);
    doc.font(BODY).fontSize(9).fillColor(MUTED).text(
      `${order.transportName ?? "Transport"} · LR ${order.transportLrNumber}`,
      left,
      doc.y + 2,
    );
    y = doc.y + 10;
  }

  // ---- footer -----------------------------------------------------------
  doc.font(BODY).fontSize(7).fillColor(MUTED).text(
    "This is an estimate, not a tax invoice. As per applicable orders, online sale of firecrackers " +
      "is restricted; orders placed online are treated as enquiries and fulfilled offline in " +
      "accordance with regulations. Goods are dispatched by licensed road transport only.",
    left,
    Math.max(y, doc.page.height - PAGE_MARGIN - 34),
    { width },
  );

  doc.end();
  return done;
}

function rule(doc: PDFKit.PDFDocument, x1: number, x2: number, y: number, color = "#bbbbbb") {
  doc.save().strokeColor(color).lineWidth(0.5).moveTo(x1, y).lineTo(x2, y).stroke().restore();
}

/** Filename a customer sees when they save the estimate. */
export function estimateFilename(shopName: string, orderNumber: number): string {
  const safe = shopName
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "estimate";
  return `${safe}-${formatEstimateNumber(orderNumber)}.pdf`;
}
