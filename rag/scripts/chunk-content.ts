import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { randomUUID } from "node:crypto";
import type { ContentChunk, ContentFrontmatter } from "./types.js";
import { MAX_CHUNK_TOKENS, MIN_CHUNK_TOKENS } from "./types.js";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../content");

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.3);
}

function isPlaceholderOnly(text: string): boolean {
  const stripped = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/#+\s+/g, "")
    .trim();
  return stripped.length === 0;
}

function splitByTokenBudget(text: string, maxTokens: number): string[] {
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);

    if (estimateTokens(paragraph) <= maxTokens) {
      current = paragraph;
      continue;
    }

    const sentences = paragraph.split(/(?<=[.!?])\s+/);
    current = "";
    for (const sentence of sentences) {
      const next = current ? `${current} ${sentence}` : sentence;
      if (estimateTokens(next) <= maxTokens) {
        current = next;
      } else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function parseSections(body: string): { section: string; content: string }[] {
  const lines = body.split("\n");
  const sections: { section: string; content: string }[] = [];
  let currentSection = "Overview";
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (!isPlaceholderOnly(content)) {
      sections.push({ section: currentSection, content });
    }
    buffer = [];
  };

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      flush();
      currentSection = headingMatch[1].trim();
      continue;
    }
    buffer.push(line);
  }

  flush();
  return sections;
}

function buildChunksForSection(
  meta: ContentFrontmatter,
  section: string,
  content: string,
): ContentChunk[] {
  const tokenCount = estimateTokens(content);
  const targetMax = MAX_CHUNK_TOKENS;
  const targetMin = MIN_CHUNK_TOKENS;

  let parts: string[];
  if (tokenCount <= targetMax) {
    parts = [content];
  } else if (tokenCount <= targetMin * 2) {
    const midpoint = Math.floor(content.length / 2);
    const splitAt = content.indexOf("\n", midpoint);
    const index = splitAt === -1 ? midpoint : splitAt;
    parts = [content.slice(0, index).trim(), content.slice(index).trim()];
  } else {
    parts = splitByTokenBudget(content, targetMax);
  }

  return parts.map((part, index) => {
    const sectionLabel = parts.length > 1 ? `${section} (${index + 1}/${parts.length})` : section;
    const payload = {
      title: meta.title,
      sourceType: meta.sourceType,
      projectName: meta.projectName,
      section: sectionLabel,
      content: part,
      url: meta.url || undefined,
      tags: meta.tags ?? [],
      priority: meta.priority ?? 3,
    };

    const contextLines = [
      `Title: ${payload.title}`,
      payload.projectName ? `Project: ${payload.projectName}` : null,
      `Section: ${payload.section}`,
      "",
      part,
    ].filter(Boolean);

    return {
      id: randomUUID(),
      payload,
      textForEmbedding: contextLines.join("\n"),
    };
  });
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

export async function chunkAllContent(contentDir = CONTENT_DIR): Promise<ContentChunk[]> {
  const files = await collectMarkdownFiles(contentDir);
  const allChunks: ContentChunk[] = [];

  for (const filePath of files) {
    const raw = await readFile(filePath, "utf8");
    const { data, content } = matter(raw);
    const meta = data as ContentFrontmatter;

    if (!meta.title || !meta.sourceType) {
      console.warn(`Skipping ${filePath}: missing title or sourceType frontmatter`);
      continue;
    }

    const sections = parseSections(content);
    for (const { section, content: sectionContent } of sections) {
      allChunks.push(...buildChunksForSection(meta, section, sectionContent));
    }
  }

  return allChunks;
}

async function main() {
  const chunks = await chunkAllContent();
  console.log(`Generated ${chunks.length} chunks`);
  for (const chunk of chunks.slice(0, 5)) {
    console.log(`- ${chunk.payload.title} / ${chunk.payload.section} (${chunk.textForEmbedding.length} chars)`);
  }
  if (chunks.length > 5) {
    console.log(`... and ${chunks.length - 5} more`);
  }
}

if (process.argv[1]?.includes("chunk-content")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
