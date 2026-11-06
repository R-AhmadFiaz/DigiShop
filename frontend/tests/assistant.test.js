import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
const server = await createServer({server: {middlewareMode: true, hmr: false}, appType: "custom"});
try {
  const {default: Assistant} = await server.ssrLoadModule("/src/pages/VoiceStock.jsx");
  await test("assistant presents text and microphone controls without an upload workflow", () => {
    const html = renderToStaticMarkup(createElement(Assistant));
    assert.match(html, /AI Assistant/);
    assert.match(html, /Ask about your shop/);
    assert.match(html, /Speak/);
    assert.match(html, /Send/);
    assert.match(html, /Ready/);
    assert.doesNotMatch(html, /type="file"|Choose File|Voice Stock|Change stock|Create sale/);
  });
} finally {await server.close();}
