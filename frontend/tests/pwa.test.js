import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";

test("DigiShop manifest and icons have the required installation metadata", () => {
  const manifest = JSON.parse(fs.readFileSync("public/manifest.webmanifest", "utf8"));
  assert.equal(manifest.name, "DigiShop");
  assert.equal(manifest.short_name, "DigiShop");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.theme_color, "#0F766E");
  assert.equal(manifest.background_color, "#FFFFFF");
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((item) => item.sizes === `${size}x${size}`);
    assert.equal(icon.type, "image/png");
    const png = fs.readFileSync("public" + icon.src);
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(html, /rel="manifest" href="\/manifest.webmanifest"/);
});

test("service worker only installs and activates; never intercepts or stores requests", async () => {
  const handlers = {};
  let claimed = false, skipped = false;
  vm.runInNewContext(fs.readFileSync("public/sw.js", "utf8"), {
    self: {
      addEventListener(name, handler) { handlers[name] = handler; },
      skipWaiting() { skipped = true; return Promise.resolve(); },
      clients: { claim() { claimed = true; return Promise.resolve(); } },
    },
  });
  assert.deepEqual(Object.keys(handlers), ["install", "activate"]);
  const promises = [];
  handlers.install({ waitUntil(promise) { promises.push(promise); } });
  handlers.activate({ waitUntil(promise) { promises.push(promise); } });
  await Promise.all(promises);
  assert.ok(skipped && claimed);
  assert.match(fs.readFileSync("src/main.jsx", "utf8"), /import\.meta\.env\.PROD && "serviceWorker" in navigator/);
});
