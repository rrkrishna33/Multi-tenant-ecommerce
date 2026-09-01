// Throwaway: reproduces exactly what the browser does when a customer clicks
// "Get estimate" -- the server-action POST, then the router's follow-up fetch.
const BASE = "http://127.0.0.1:3000";
const HOST = "rvcrackers.localhost:3000";
const h = (extra = {}) => ({ host: HOST, ...extra });

const html = await (await fetch(BASE + "/", { headers: h() })).text();

const formStart = html.indexOf('<form style="margin-top:16px"');
const form = html.slice(formStart, html.indexOf("</form>", formStart));

const hidden = {};
for (const m of form.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)) {
  hidden[m[1]] = m[2].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}
for (const m of form.matchAll(/<input type="hidden" name="([^"]+)"\/>/g)) {
  hidden[m[1]] = "";
}
console.log("hidden fields:", Object.keys(hidden));

const actionId = JSON.parse(hidden["$ACTION_1:0"] || "{}").id;
console.log("action id:", actionId);

const productId = (html.match(/name="qty-([0-9a-f-]{36})"/) ||
  html.match(/data-pid="([0-9a-f-]{36})"/) ||
  html.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/))?.[1];
console.log("product:", productId);

const fd = new FormData();
for (const [k, v] of Object.entries(hidden)) fd.set(k, v);
fd.set("customerName", "Flow Test");
fd.set("customerPhone", "9842012345");
fd.set("customerEmail", "");
fd.set("addressLine", "1 Test Street");
fd.set("city", "Sivakasi");
fd.set("state", "Tamil Nadu");
fd.set("pincode", "626123");
fd.set("notes", "");
fd.set("items", JSON.stringify([{ productId, quantity: 40 }]));

const res = await fetch(BASE + "/", {
  method: "POST",
  redirect: "manual",
  headers: h({ "Next-Action": actionId, "Next-Url": "/", RSC: "1" }),
  body: fd,
});
console.log("action status:", res.status);
for (const [k, v] of res.headers) {
  if (/location|redirect|next|content-type/i.test(k)) console.log("   ", k, "=", v);
}
const body = await res.text();
const target = (body.match(/\/order\/[0-9a-f-]{36}/) || [])[0];
console.log("redirect target seen in flight body:", target);
console.log("flight head:", JSON.stringify(body.slice(0, 300)));

if (target) {
  const nav = await fetch(BASE + target, {
    headers: h({ RSC: "1", "Next-Url": "/" }),
  });
  const navBody = await nav.text();
  console.log("follow-up status:", nav.status, "bytes:", navBody.length);
  console.log("  contains an estimate number:", /EST-\d+/.test(navBody));
  console.log("  contains the shop 404 page:", navBody.includes("We could not find that page"));
}
