import test from "node:test";
import assert from "node:assert/strict";
import { commandRegistry } from "../src/commandRegistry.js";

test("animal commands download and return a Discord image attachment", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return calls.length === 1
      ? Response.json({
          image: "https://images.example.net/example.jpeg",
          fact: "A test fact.",
        })
      : new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/jpeg", "content-length": "3" },
        });
  };

  const result = await commandRegistry.cat();

  assert.equal(result.text, "A test fact.");
  assert.equal(result.image.name, "animal.jpg");
  assert.deepEqual([...result.image.attachment], [1, 2, 3]);
  assert.deepEqual(calls, [
    "https://api.some-random-api.com/animal/cat",
    "https://images.example.net/example.jpeg",
  ]);
});
