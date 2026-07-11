/**
 * Lightweight smoke checks for the RAG stack (no external API calls).
 * Run: npx tsx smoke-test.ts
 */

import assert from "node:assert/strict";
import { chunkAllContent } from "./chunk-content.js";
import { EMBEDDING_DIMENSION } from "./types.js";

async function run() {
  const chunks = await chunkAllContent();
  assert.ok(Array.isArray(chunks), "chunkAllContent should return an array");

  for (const chunk of chunks) {
    assert.ok(chunk.id, "chunk should have an id");
    assert.ok(chunk.payload.title, "chunk should have a title");
    assert.ok(chunk.payload.sourceType, "chunk should have sourceType");
    assert.ok(chunk.payload.content.length > 0, "chunk should have content");
    assert.ok(chunk.textForEmbedding.includes(chunk.payload.title), "embedding text should include title");
  }

  console.log(`Smoke test passed (${chunks.length} chunks, embedding dim ${EMBEDDING_DIMENSION}).`);
}

run().catch((error) => {
  console.error("Smoke test failed:", error);
  process.exit(1);
});
