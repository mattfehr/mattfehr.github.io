# Portfolio RAG Chatbot

A retrieval-augmented chatbot for Matthew Fehr's portfolio. The static site stays on GitHub Pages / Render; this folder adds the knowledge base, indexing scripts, Cloudflare Worker API, and frontend widget.

## Architecture

```
Static portfolio (index.html)
  -> floating widget (assets/js/chatbot.js)
  -> Cloudflare Worker POST /chat
  -> Qdrant Cloud (portfolio_chunks)
  -> Gemini 2.5 Flash + text-embedding-004
  -> answer + source links
```

## Folder layout

- `content/` — Markdown knowledge base (fill templates before indexing)
- `scripts/` — chunk, embed, and upload to Qdrant
- `worker/` — Cloudflare Worker API
- `widget/` — source copy of the chat UI (deployed copy lives in `assets/`)

## Step 1: Fill the knowledge base

Edit the Markdown files under `content/`. Each file has YAML frontmatter and section headings. Replace `<!-- TODO: fill -->` placeholders with real content.

The indexer skips sections that are empty or placeholder-only. **Do not index until you've filled in meaningful content.**

Project files should explain decisions and outcomes — not paste full source code.

## Step 2: Create Qdrant Cloud cluster

1. Sign up at [Qdrant Cloud](https://cloud.qdrant.io/)
2. Create a **Free** cluster
3. Copy the cluster URL and API key
4. The indexing script creates the `portfolio_chunks` collection automatically (768-dim cosine vectors)

Free tier: 1 GB RAM, 4 GB disk — enough for this portfolio KB.

## Step 3: Get a Gemini API key

1. Create a key in [Google AI Studio](https://aistudio.google.com/apikey)
2. Used for embeddings (`text-embedding-004`) and chat (`gemini-2.5-flash`)

Free-tier rate limits apply. The Worker returns friendly 429 messages when limits are hit.

## Step 4: Index content

```bash
cd rag/scripts
cp .env.example .env
# Edit .env with GEMINI_API_KEY, QDRANT_URL, QDRANT_API_KEY

npm install
npm run chunk    # preview chunk count
npm run index    # embed + upsert to Qdrant
```

Re-run `npm run index` whenever you update Markdown content.

## Step 5: Deploy the Cloudflare Worker

```bash
cd rag/worker
npm install

# Set secrets (not committed)
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put QDRANT_URL
npx wrangler secret put QDRANT_API_KEY

npm run dev      # local testing
npm run deploy   # production
```

After deploy, note your Worker URL (e.g. `https://portfolio-rag-chatbot.<subdomain>.workers.dev`).

### Worker endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/chat` | `{ "message": "...", "history": [] }` |

### Test with curl

```bash
curl -X POST "https://portfolio-rag-chatbot.<subdomain>.workers.dev/chat" \
  -H "Content-Type: application/json" \
  -d '{"message":"What AI projects has Matthew built?","history":[]}'
```

Expected response:

```json
{
  "answer": "...",
  "sources": [{ "title": "...", "url": "...", "section": "..." }]
}
```

## Step 6: Wire the widget to the Worker

1. Update `CHAT_API_URL` in both:
   - `assets/js/chatbot.js` (deployed copy)
   - `rag/widget/chatbot.js` (source copy)
2. If your portfolio domain changes, add it to `ALLOWED_ORIGINS` in `rag/worker/wrangler.toml` and redeploy.

The widget is already linked from `index.html`:

```html
<link rel="stylesheet" href="assets/css/chatbot.css" />
<script src="assets/js/chatbot.js" defer></script>
```

## Widget features

- Floating launcher button
- Suggested starter questions
- Typing / loading state
- Source citation chips
- Conversation reset
- Rate-limit and network error messages
- Mobile-friendly layout

## Prompt guardrails

The Worker system prompt restricts answers to Matthew's portfolio context only. If information is not in retrieved chunks, the assistant should say it does not know rather than invent details.

## Environment variables

### `rag/scripts/.env`

| Variable | Description |
|----------|-------------|
| `GEMINI_API_KEY` | Google AI Studio API key |
| `QDRANT_URL` | Qdrant cluster URL |
| `QDRANT_API_KEY` | Qdrant API key |
| `QDRANT_COLLECTION` | Collection name (default: `portfolio_chunks`) |

### Worker secrets

Same `GEMINI_API_KEY`, `QDRANT_URL`, and `QDRANT_API_KEY` via Wrangler secrets.

## Next steps (not in MVP)

- Log unanswered questions to persistent storage
- Admin HTTP endpoint to trigger re-indexing
- Swap in-memory IP rate limiting for Cloudflare KV

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `No indexable chunks found` | Fill in Markdown content; remove TODO-only sections |
| CORS error in browser | Add your site origin to `ALLOWED_ORIGINS` in `wrangler.toml` |
| 429 from Gemini | Wait and retry; indexing script backs off automatically |
| Empty Qdrant results | Re-run `npm run index` after filling content |
| Widget network error | Confirm `CHAT_API_URL` matches deployed Worker URL |
