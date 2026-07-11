export interface Env {
  AI: Ai;
  GEMINI_API_KEY: string;
  QDRANT_URL: string;
  QDRANT_API_KEY: string;
  QDRANT_COLLECTION: string;
  QDRANT_SCORE_THRESHOLD: string;
  ALLOWED_ORIGINS: string;
  GEMINI_CHAT_MODEL: string;
  RATE_LIMIT_MAX: string;
  RATE_LIMIT_WINDOW_MS: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  message?: string;
  history?: ChatMessage[];
}

interface ChunkPayload {
  title?: string;
  sourceType?: string;
  projectName?: string;
  section?: string;
  content?: string;
  url?: string;
  tags?: string[];
  priority?: number;
}

interface Source {
  title: string;
  url?: string;
  section: string;
}

interface RetrievedChunk {
  payload: ChunkPayload;
  score: number;
}

/** Must match local indexing model Xenova/bge-small-en-v1.5 (384 dims). */
const WORKERS_AI_EMBED_MODEL = "@cf/baai/bge-small-en-v1.5";
const DEFAULT_GEMINI_CHAT_MODEL = "gemini-3.1-flash-lite";
const QDRANT_RESULT_LIMIT = 5;
const SOURCE_LIMIT = 4;

const SYSTEM_PROMPT = `You are Matthew Fehr's portfolio assistant.
Only answer questions about Matthew, his projects, skills, experience, education, and contact information.
Use only the provided context.
If the answer is not in the context, say you do not know.
Do not invent experience, employers, skills, degrees, links, or claims.
Keep answers concise and helpful.
Include relevant source links when available.`;

const rateLimitStore = new Map<string, number[]>();

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function getAllowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS || "").split(",").map((origin) => origin.trim()).filter(Boolean);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = getAllowedOrigins(env);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };

  if (origin && (allowed.includes(origin) || allowed.includes("*"))) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  return headers;
}

function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function isRateLimited(ip: string, env: Env): boolean {
  const max = Number(env.RATE_LIMIT_MAX || 20);
  const windowMs = Number(env.RATE_LIMIT_WINDOW_MS || 60_000);
  const now = Date.now();
  const timestamps = (rateLimitStore.get(ip) ?? []).filter((ts) => now - ts < windowMs);

  if (timestamps.length >= max) {
    rateLimitStore.set(ip, timestamps);
    return true;
  }

  timestamps.push(now);
  rateLimitStore.set(ip, timestamps);
  return false;
}

async function embedText(text: string, env: Env): Promise<number[]> {
  const result = (await env.AI.run(WORKERS_AI_EMBED_MODEL, {
    text: [text],
  })) as { data?: number[][]; shape?: number[] };

  const values = result.data?.[0];
  if (!values?.length) {
    throw new Error("Workers AI embedding response missing vector values");
  }

  return values;
}

function getQdrantScoreThreshold(env: Env): number | undefined {
  const threshold = Number(env.QDRANT_SCORE_THRESHOLD || 0.25);
  return Number.isFinite(threshold) && threshold > 0 ? threshold : undefined;
}

async function searchQdrant(vector: number[], env: Env): Promise<RetrievedChunk[]> {
  const collection = env.QDRANT_COLLECTION || "portfolio_chunks";
  const url = `${env.QDRANT_URL.replace(/\/$/, "")}/collections/${collection}/points/search`;
  const body: Record<string, unknown> = {
    vector,
    limit: QDRANT_RESULT_LIMIT,
    with_payload: true,
  };
  const scoreThreshold = getQdrantScoreThreshold(env);

  if (scoreThreshold !== undefined) {
    body.score_threshold = scoreThreshold;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.QDRANT_API_KEY,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Qdrant search failed (${response.status}): ${text}`);
  }

  const data = (await response.json()) as {
    result?: Array<{ payload?: ChunkPayload; score?: number }>;
  };

  const results = data.result ?? [];
  return results
    .sort((a, b) => {
      const scoreDiff = (b.score ?? 0) - (a.score ?? 0);
      if (Math.abs(scoreDiff) > 0.01) return scoreDiff;

      const priorityDiff = (b.payload?.priority ?? 0) - (a.payload?.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return scoreDiff;
    })
    .map((item) => ({
      payload: item.payload ?? {},
      score: item.score ?? 0,
    }))
    .filter((item): item is RetrievedChunk => Boolean(item.payload.content));
}

function buildContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((item, index) => {
      const chunk = item.payload;
      const header = [
        `[Source ${index + 1}]`,
        chunk.title ? `Title: ${chunk.title}` : null,
        chunk.section ? `Section: ${chunk.section}` : null,
        chunk.url ? `URL: ${chunk.url}` : null,
      ]
        .filter(Boolean)
        .join("\n");

      return `${header}\n${chunk.content}`;
    })
    .join("\n\n---\n\n");
}

function extractSources(chunks: RetrievedChunk[]): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];

  for (const item of chunks) {
    const chunk = item.payload;
    const key = `${chunk.title ?? ""}|${chunk.section ?? ""}|${chunk.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    sources.push({
      title: chunk.title ?? chunk.projectName ?? "Portfolio",
      url: chunk.url || undefined,
      section: chunk.section ?? "General",
    });

    if (sources.length >= SOURCE_LIMIT) break;
  }

  return sources;
}

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

async function generateAnswer(
  message: string,
  history: ChatMessage[],
  context: string,
  env: Env,
): Promise<string> {
  const model = env.GEMINI_CHAT_MODEL || DEFAULT_GEMINI_CHAT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`;

  const historyContents = history.slice(-6).map((entry) => ({
    role: entry.role === "assistant" ? "model" : "user",
    parts: [{ text: entry.content }],
  }));

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      contents: [
        ...historyContents,
        {
          role: "user",
          parts: [
            {
              text: `Context:\n${context}\n\nQuestion:\n${message}`,
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 700,
      },
    }),
  });

  if (response.status === 429) {
    throw new RateLimitError("The assistant is busy due to free-tier rate limits. Please wait a minute and try again.");
  }

  const data = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Gemini request failed (${response.status})`);
  }

  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n").trim();
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  return text;
}

async function handleChat(request: Request, env: Env, origin: string | null): Promise<Response> {
  const headers = corsHeaders(origin, env);

  let body: ChatRequestBody;
  try {
    body = (await request.json()) as ChatRequestBody;
  } catch {
    return json({ error: "Invalid JSON body" }, 400, headers);
  }

  const message = body.message?.trim();
  if (!message) {
    return json({ error: "message is required" }, 400, headers);
  }

  if (message.length > 1000) {
    return json({ error: "message is too long (max 1000 characters)" }, 400, headers);
  }

  const ip = getClientIp(request);
  if (isRateLimited(ip, env)) {
    return json(
      {
        error: "Too many requests. Please wait a minute before trying again.",
        code: "rate_limited",
      },
      429,
      headers,
    );
  }

  const history = Array.isArray(body.history)
    ? body.history
        .filter(
          (entry): entry is ChatMessage =>
            (entry?.role === "user" || entry?.role === "assistant") &&
            typeof entry.content === "string" &&
            entry.content.trim().length > 0,
        )
        .slice(-10)
    : [];
  const promptHistory = history.filter(
    (entry, index) => !(index === history.length - 1 && entry.role === "user" && entry.content.trim() === message),
  );

  try {
    const vector = await embedText(message, env);
    const chunks = await searchQdrant(vector, env);

    if (chunks.length === 0) {
      return json(
        {
          answer: "I do not know based on the indexed portfolio content.",
          sources: [],
        },
        200,
        headers,
      );
    }

    const context = buildContext(chunks);
    const answer = await generateAnswer(message, promptHistory, context, env);
    const sources = extractSources(chunks);

    return json({ answer, sources }, 200, headers);
  } catch (error) {
    if (error instanceof RateLimitError) {
      return json({ error: error.message, code: "upstream_rate_limited" }, 429, headers);
    }

    console.error("Chat error:", error);
    return json({ error: "Something went wrong while generating a response." }, 500, headers);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    const headers = corsHeaders(origin, env);
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true }, 200, headers);
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      return handleChat(request, env, origin);
    }

    return json({ error: "Not found" }, 404, headers);
  },
};
