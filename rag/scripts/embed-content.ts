import "dotenv/config";
import type { ContentChunk, EmbeddedChunk } from "./types.js";
import { EMBEDDING_MODEL } from "./types.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required");
}

const EMBED_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;

interface GeminiEmbedResponse {
  embedding?: { values?: number[] };
  error?: { code?: number; message?: string; status?: string };
}

export async function embedText(text: string, retries = 3): Promise<number[]> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(EMBED_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${EMBEDDING_MODEL}`,
        content: { parts: [{ text }] },
      }),
    });

    if (response.status === 429 && attempt < retries) {
      const delayMs = 1000 * 2 ** attempt;
      console.warn(`Rate limited on embed; retrying in ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      continue;
    }

    const data = (await response.json()) as GeminiEmbedResponse;

    if (!response.ok) {
      throw new Error(data.error?.message ?? `Embedding failed (${response.status})`);
    }

    const values = data.embedding?.values;
    if (!values?.length) {
      throw new Error("Embedding response missing vector values");
    }

    return values;
  }

  throw new Error("Embedding failed after retries");
}

export async function embedChunks(
  chunks: ContentChunk[],
  options: { batchDelayMs?: number } = {},
): Promise<EmbeddedChunk[]> {
  const { batchDelayMs = 250 } = options;
  const embedded: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const vector = await embedText(chunk.textForEmbedding);
    embedded.push({ ...chunk, vector });

    if ((i + 1) % 10 === 0) {
      console.log(`Embedded ${i + 1}/${chunks.length}`);
    }

    if (batchDelayMs > 0 && i < chunks.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, batchDelayMs));
    }
  }

  return embedded;
}
