// Run after npm run build. Uses a production preview and isolated Chrome profile.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const base = "http://localhost:4175";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const profile = path.resolve("node_modules/.cache/pwa-browser-" + Date.now());
fs.mkdirSync(profile, { recursive: true });
const preview = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "preview", "--host", "localhost", "--port", "4175", "--strictPort"], { windowsHide: true, stdio: "ignore" });
let chrome, socket;
const pending = new Map();
let sequence = 0;
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("Timed out: " + method)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send("Runtime.evaluate", { expression: `(async () => (${expression}))()`, awaitPromise: true, returnByValue: true });
  assert.equal(result.exceptionDetails, undefined);
  return result.result.value;
}
async function waitFor(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error("Browser readiness check timed out");
}
try {
  await waitFor(async () => { try { return (await fetch(base)).ok; } catch { return false; } });
  for (const resource of ["/manifest.webmanifest", "/sw.js", "/digishop-icon-192.png", "/digishop-icon-512.png"]) {
    const response = await fetch(base + resource);
    assert.equal(response.status, 200);
    assert.ok(!response.headers.get("content-type").includes("text/html"));
  }
  chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--remote-debugging-port=9225", "--user-data-dir=" + profile, "about:blank"], { windowsHide: true, stdio: "ignore" });
  let target;
  await waitFor(async () => {
    try { target = (await (await fetch("http://localhost:9225/json/list")).json()).find((item) => item.type === "page"); return !!target; } catch { return false; }
  });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    clearTimeout(request.timer); pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  await send("Page.enable");
  await send("Page.navigate", { url: base });
  await waitFor(() => evaluate('!!navigator.serviceWorker.controller'));
  assert.equal(await evaluate("document.title"), "DigiShop");
  const manifest = await send("Page.getAppManifest");
  assert.equal(manifest.url, base + "/manifest.webmanifest");
  assert.deepEqual(manifest.errors, []);
  assert.equal(JSON.parse(manifest.data).display, "standalone");
  const installability = await send("Page.getInstallabilityErrors");
  assert.deepEqual(installability.installabilityErrors, []);
  assert.equal(await evaluate('(await navigator.serviceWorker.getRegistration()).scope'), base + "/");
  assert.deepEqual(await evaluate("await caches.keys()"), []);
  assert.equal(await evaluate('await Promise.all([192,512].map(size=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth===size&&image.naturalHeight===size);image.onerror=()=>resolve(false);image.src="/digishop-icon-"+size+".png";}))).then(results=>results.every(Boolean))'), true);
  for (const route of ["/owner/customers", "/owner/products", "/cashier/pos"]) {
    assert.equal((await fetch(base + route)).status, 200);
    await send("Page.navigate", { url: base + route });
    await waitFor(() => evaluate('document.readyState === "complete" && !!document.querySelector("#root").children.length'));
    await send("Page.reload");
    await waitFor(() => evaluate('document.readyState === "complete" && !!document.querySelector("#root").children.length'));
    assert.equal(await evaluate("document.title"), "DigiShop");
    assert.deepEqual(await evaluate("await caches.keys()"), []);
  }
  console.log("PWA browser checks passed: production manifest, installability, icons, service worker, deep-link refreshes and zero Cache Storage entries.");
} finally {
  socket?.close();
  chrome?.kill();
  preview.kill();
  for (const request of pending.values()) clearTimeout(request.timer);
}
