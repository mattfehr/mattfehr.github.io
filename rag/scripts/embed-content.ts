import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";
import type { ContentChunk, EmbeddedChunk } from "./types.js";
import { EMBEDDING_DIMENSION, EMBEDDING_MODEL } from "./types.js";

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

async function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    console.log(`Loading local embedding model ${EMBEDDING_MODEL} (first run downloads weights)...`);
    extractorPromise = pipeline("feature-extraction", EMBEDDING_MODEL);
  }
  return extractorPromise;
}

export async function embedText(text: string): Promise<number[]> {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  const values = Array.from(output.data as Float32Array);

  if (values.length !== EMBEDDING_DIMENSION) {
    throw new Error(
      `Expected ${EMBEDDING_DIMENSION}-dim embedding, got ${values.length}. Check EMBEDDING_MODEL.`,
    );
  }

  return values;
}

export async function embedChunks(
  chunks: ContentChunk[],
  options: { batchDelayMs?: number } = {},
): Promise<EmbeddedChunk[]> {
  const { batchDelayMs = 0 } = options;
  const embedded: EmbeddedChunk[] = [];

  // Warm the model once before the loop
  await getExtractor();

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = await embedText(chunk.textForEmbedding);
    embedded.push({ ...chunk, vector });

    if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
      console.log(`Embedded ${i + 1}/${chunks.length}`);
    }

    if (batchDelayMs > 0 && i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
    }
  }

  return embedded;
}
