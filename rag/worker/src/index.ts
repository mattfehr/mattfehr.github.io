export interface Env {
  GEMINI_API_KEY: string;
  QDRANT_URL: string;
  QDRANT_API_KEY: string;
  QDRANT_COLLECTION: string;
  ALLOWED_ORIGINS: string;
  GEMINI_CHAT_MODEL: string;
  GEMINI_EMBED_MODEL: string;
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
  return env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function corsHeaders(origin: string | null, env: Env): Record<string, string> {
  const allowed = getAllowedOrigins(env);
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_EMBED_MODEL}:embedContent?key=${env.GEMINI_API_KEY}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${env.GEMINI_EMBED_MODEL}`,
      content: { parts: [{ text }] },
    }),
  });

  if (response.status === 429) {
    throw new RateLimitError("Embedding rate limit reached. Please try again in a minute.");
  }

  const data = (await response.json()) as {
    embedding?: { values?: number[] };
    error?: { message?: string };
  };

  if (!response.ok) {
    throw new Error(data.error?.message ?? `Embedding failed (${response.status})`);
  }

  const values = data.embedding?.values;
  if (!values?.length) {
    throw new Error("Embedding response missing vector values");
  }

  return values;
}

async function searchQdrant(vector: number[], env: Env): Promise<ChunkPayload[]> {
  const collection = env.QDRANT_COLLECTION || "portfolio_chunks";
  const url = `${env.QDRANT_URL.replace(/\/$/, "")}/collections/${collection}/points/search`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": env.QDRANT_API_KEY,
    },
    body: JSON.stringify({
      vector,
      limit: 8,
      with_payload: true,
    }),
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
      const priorityDiff = (b.payload?.priority ?? 0) - (a.payload?.priority ?? 0);
      if (priorityDiff !== 0) return priorityDiff;
      return (b.score ?? 0) - (a.score ?? 0);
    })
    .map((item) => item.payload ?? {})
    .filter((payload) => payload.content);
}

function buildContext(chunks: ChunkPayload[]): string {
  return chunks
    .map((chunk, index) => {
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

function extractSources(chunks: ChunkPayload[]): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];

  for (const chunk of chunks) {
    const key = `${chunk.title ?? ""}|${chunk.section ?? ""}|${chunk.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    sources.push({
      title: chunk.title ?? chunk.projectName ?? "Portfolio",
      url: chunk.url || undefined,
      section: chunk.section ?? "General",
    });
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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${env.GEMINI_CHAT_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`;

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
    ? body.history.filter((entry) => entry?.role && entry?.content).slice(-10)
    : [];

  try {
    const vector = await embedText(message, env);
    const chunks = await searchQdrant(vector, env);

    if (chunks.length === 0) {
      return json(
        {
          answer: "I do not have indexed portfolio content yet. Please check back after the knowledge base has been populated.",
          sources: [],
        },
        200,
        headers,
      );
    }

    const context = buildContext(chunks);
    const answer = await generateAnswer(message, history, context, env);
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
