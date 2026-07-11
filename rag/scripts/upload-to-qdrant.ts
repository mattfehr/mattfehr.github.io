import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";
import { chunkAllContent } from "./chunk-content.js";
import { embedChunks } from "./embed-content.js";
import { EMBEDDING_DIMENSION } from "./types.js";

const QDRANT_URL = process.env.QDRANT_URL;
const QDRANT_API_KEY = process.env.QDRANT_API_KEY;
const COLLECTION = process.env.QDRANT_COLLECTION ?? "portfolio_chunks";

if (!QDRANT_URL || !QDRANT_API_KEY) {
  throw new Error("QDRANT_URL and QDRANT_API_KEY are required");
}

async function ensureCollection(client: QdrantClient): Promise<void> {
  const collections = await client.getCollections();
  const exists = collections.collections.some((c) => c.name === COLLECTION);

  if (!exists) {
    console.log(`Creating collection "${COLLECTION}" (${EMBEDDING_DIMENSION} dims)...`);
    await client.createCollection(COLLECTION, {
      vectors: {
        size: EMBEDDING_DIMENSION,
        distance: "Cosine",
      },
    });
    return;
  }

  const info = await client.getCollection(COLLECTION);
  const size = info.config?.params?.vectors;
  const vectorSize = typeof size === "object" && size !== null && "size" in size ? size.size : undefined;

  if (vectorSize !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Collection "${COLLECTION}" exists with vector size ${vectorSize}, expected ${EMBEDDING_DIMENSION}`,
    );
  }
}

async function main() {
  console.log("Reading and chunking markdown content...");
  const chunks = await chunkAllContent();

  if (chunks.length === 0) {
    console.warn(
      "No indexable chunks found. Fill in rag/content/*.md (remove TODO-only sections) before indexing.",
    );
    process.exit(0);
  }

  console.log(`Embedding ${chunks.length} chunks...`);
  const embedded = await embedChunks(chunks);

  const client = new QdrantClient({ url: QDRANT_URL, apiKey: QDRANT_API_KEY });
  await ensureCollection(client);

  console.log(`Upserting ${embedded.length} points to "${COLLECTION}"...`);
  await client.upsert(COLLECTION, {
    wait: true,
    points: embedded.map((chunk) => ({
      id: chunk.id,
      vector: chunk.vector,
      payload: chunk.payload as unknown as Record<string, unknown>,
    })),
  });

  console.log("Indexing complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
