# Matthew Fehr Portfolio Website

Personal portfolio site for projects, resume highlights, and contact information.

## Live Site

- Portfolio: https://mattfehr.github.io/
- Hosting: GitHub Pages
- Contact form: Formspree, configured in `index.html`

The old Render portfolio/backend links are legacy and are no longer the active deployment path.

## Tech Stack

- HTML5, CSS3, JavaScript
- HTML5 UP Prologue template
- Font Awesome icons
- Formspree for contact form submissions
- Optional RAG chatbot widget backed by Cloudflare Worker, Qdrant, Workers AI embeddings, and Gemini chat

## Project Structure

```text
Prologue/
├── assets/
│   ├── css/
│   ├── js/
│   └── images/
├── contact-form-server/     # legacy Render/Express contact backend
├── rag/                     # portfolio RAG chatbot backend, widget source, and indexing scripts
├── index.html
└── README.md
```

## Running Locally

Open `index.html` directly in a browser, or use VS Code Live Server.

The contact form posts to Formspree. The legacy `contact-form-server/` app is kept for reference, but GitHub Pages does not run Node/Express servers.

## RAG Chatbot

The chat widget is linked from `index.html`:

```html
<link rel="stylesheet" href="assets/css/chatbot.css" />
<script src="assets/js/chatbot.js" defer></script>
```

The widget is ready, but live answers require a deployed Cloudflare Worker URL in `assets/js/chatbot.js`. See `rag/README.md` for indexing, Qdrant, Worker deploy, and testing steps.

## Deployment Notes

- Static portfolio deploys through GitHub Pages from this repository.
- The contact form uses Formspree, not the legacy Render backend.
- The chatbot API deploys separately as a Cloudflare Worker.

## Credits

- Built by Matthew Fehr
- Template styling from HTML5 UP
- Icons from Font Awesome
