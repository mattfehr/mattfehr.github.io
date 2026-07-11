# Portfolio RAG Chatbot

Retrieval-augmented chatbot for Matthew Fehr's portfolio. The portfolio stays static on GitHub Pages; the chat API runs separately as a Cloudflare Worker.

## Architecture

```text
GitHub Pages portfolio
  -> floating widget (assets/js/chatbot.js)
  -> Cloudflare Worker POST /chat
  -> Cloudflare Workers AI query embedding
  -> Qdrant Cloud collection (portfolio_chunks)
  -> Gemini chat answer
  -> answer + source links
```

## Models

- Local indexing embeddings: `Xenova/bge-small-en-v1.5`
- Worker query embeddings: `@cf/baai/bge-small-en-v1.5`
- Vector size: 384 dimensions
- Chat model: `gemini-3.1-flash-lite`

## Folder Layout

- `content/`: Markdown knowledge base used for indexing
- `scripts/`: chunk, embed, smoke test, and upload scripts
- `worker/`: Cloudflare Worker API
- `widget/`: source copy of the chat UI; deployed copy lives in `assets/`

## 1. Prepare Content

Edit Markdown files under `content/`. Each file should have YAML frontmatter and useful section headings.

Project files should explain decisions, outcomes, tech stack, role, challenges, lessons, and links. Do not paste full source code into the knowledge base.

## 2. Create Qdrant Cloud Cluster

1. Create a Qdrant Cloud free cluster.
2. Copy the cluster URL and API key.
3. The indexing script creates a fresh `portfolio_chunks` collection with 384-dim cosine vectors.

The script recreates the collection on each full index run so deleted or renamed chunks do not linger in search results.

## 3. Index Content Locally

```bash
cd rag/scripts
cp .env.example .env
# Edit .env with QDRANT_URL and QDRANT_API_KEY

npm install
npm run chunk
npm run smoke
npm run index
```

First indexing run downloads the local embedding model weights. Gemini is not used for local indexing.

## 4. Deploy The Worker

```bash
cd rag/worker
npm install

npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put QDRANT_URL
npx wrangler secret put QDRANT_API_KEY

npm run deploy
```

After deployment, copy the Worker URL, for example:

```text
https://portfolio-rag-chatbot.mattfehr2004.workers.dev
```

## Worker Variables

Configured in `worker/wrangler.toml`:

| Variable | Purpose |
| --- | --- |
| `QDRANT_COLLECTION` | Qdrant collection name, default `portfolio_chunks` |
| `QDRANT_SCORE_THRESHOLD` | Minimum vector score for retrieved chunks |
| `ALLOWED_ORIGINS` | Browser origins allowed to call the Worker |
| `GEMINI_CHAT_MODEL` | Gemini model for final answers |
| `RATE_LIMIT_MAX` | Requests allowed per IP window |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window length |

Secrets set with Wrangler:

| Secret | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studio API key |
| `QDRANT_URL` | Qdrant cluster URL |
| `QDRANT_API_KEY` | Qdrant API key |

## 5. Test The Worker

```bash
curl -X GET "https://portfolio-rag-chatbot.mattfehr2004.workers.dev/health"
```

```bash
curl -X POST "https://portfolio-rag-chatbot.mattfehr2004.workers.dev/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"What AI projects has Matthew built?","history":[]}'
```

Expected chat response:

```json
{
  "answer": "...",
  "sources": [{ "title": "...", "url": "...", "section": "..." }]
}
```

## 6. Wire The Widget

Update `CHAT_API_URL` in both files:

- `assets/js/chatbot.js`
- `rag/widget/chatbot.js`

Use the deployed Worker chat endpoint:

```text
https://portfolio-rag-chatbot.mattfehr2004.workers.dev/chat
```

The Worker CORS config already includes `https://mattfehr.github.io`.

## Guardrails

The Worker system prompt tells the assistant to answer only questions about Matthew, his projects, skills, experience, education, and contact information. If the answer is not in retrieved context, it should say it does not know.

## Troubleshooting

| Issue | Fix |
| --- | --- |
| `No indexable chunks found` | Add meaningful Markdown content under `content/` |
| CORS error in browser | Add the site origin to `ALLOWED_ORIGINS` and redeploy |
| Empty or weak answers | Re-run `npm run index` and consider lowering `QDRANT_SCORE_THRESHOLD` |
| 429 from Gemini | Wait and retry; free-tier rate limits are expected |
| Widget says API is not deployed | Replace the placeholder `CHAT_API_URL` with the deployed Worker URL |
