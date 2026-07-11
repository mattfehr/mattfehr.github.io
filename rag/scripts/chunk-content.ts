import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { ContentChunk, ContentFrontmatter } from "./types.js";
import { MAX_CHUNK_TOKENS, MIN_CHUNK_TOKENS } from "./types.js";

const CONTENT_DIR = path.resolve(import.meta.dirname, "../content");

interface ParsedSection {
  section: string;
  content: string;
}

interface ChunkPart {
  section: string;
  content: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.trim().split(/\s+/).filter(Boolean).length * 1.3);
}

function deterministicUuid(input: string): string {
  const chars = createHash("sha256").update(input).digest("hex").slice(0, 32).split("");
  chars[12] = "5";
  chars[16] = ((Number.parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  const hex = chars.join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
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

function parseSections(body: string): ParsedSection[] {
  const lines = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const sections: ParsedSection[] = [];
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
    const headingMatch = line.match(/^#{1,3}\s+(.+?)\s*$/);
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

function formatSection(section: ParsedSection): string {
  return section.section === "Overview"
    ? section.content
    : `## ${section.section}\n\n${section.content}`;
}

function splitSection(section: ParsedSection): ChunkPart[] {
  const formatted = formatSection(section);
  if (estimateTokens(formatted) <= MAX_CHUNK_TOKENS) {
    return [{ section: section.section, content: formatted }];
  }

  const heading = section.section === "Overview" ? "" : `## ${section.section}`;
  return splitByTokenBudget(section.content, MAX_CHUNK_TOKENS - estimateTokens(heading))
    .filter((part) => !isPlaceholderOnly(part))
    .map((part, index, parts) => ({
      section: parts.length > 1 ? `${section.section} (${index + 1}/${parts.length})` : section.section,
      content: heading ? `${heading}\n\n${part}` : part,
    }));
}

function sectionLabel(parts: ChunkPart[]): string {
  const names = parts.map((part) => part.section);
  const unique = [...new Set(names)];

  if (unique.length === 1) {
    return unique[0];
  }

  return `${unique[0]} - ${unique[unique.length - 1]}`;
}

function buildChunksForFile(
  meta: ContentFrontmatter,
  relativePath: string,
  sections: ParsedSection[],
): ContentChunk[] {
  const sectionParts = sections.flatMap(splitSection);
  const grouped: ChunkPart[][] = [];
  let current: ChunkPart[] = [];

  const flush = () => {
    if (current.length > 0) {
      grouped.push(current);
      current = [];
    }
  };

  for (const part of sectionParts) {
    const candidate = [...current, part];
    const candidateText = candidate.map((item) => item.content).join("\n\n");

    if (current.length > 0 && estimateTokens(candidateText) > MAX_CHUNK_TOKENS) {
      flush();
    }

    current.push(part);
  }

  flush();

  return grouped.map((parts, index) => {
    const content = parts.map((part) => part.content).join("\n\n").trim();
    const payload = {
      title: meta.title,
      sourceType: meta.sourceType,
      projectName: meta.projectName,
      section: sectionLabel(parts),
      content,
      url: meta.url || undefined,
      tags: meta.tags ?? [],
      priority: meta.priority ?? 3,
    };

    const contextLines = [
      `Title: ${payload.title}`,
      payload.projectName ? `Project: ${payload.projectName}` : null,
      `Source type: ${payload.sourceType}`,
      `Section: ${payload.section}`,
      payload.tags.length ? `Tags: ${payload.tags.join(", ")}` : null,
      "",
      content,
    ].filter(Boolean);

    return {
      id: deterministicUuid(`${relativePath}:${index}`),
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
    const relativePath = path.relative(contentDir, filePath).replace(/\\/g, "/");
    allChunks.push(...buildChunksForFile(meta, relativePath, sections));
  }

  return allChunks;
}

async function main() {
  const chunks = await chunkAllContent();
  console.log(`Generated ${chunks.length} chunks`);
  for (const chunk of chunks.slice(0, 5)) {
    console.log(`- ${chunk.payload.title} / ${chunk.payload.section} (${estimateTokens(chunk.payload.content)} tokens)`);
  }
  if (chunks.length > 5) {
    console.log(`... and ${chunks.length - 5} more`);
  }

  const belowTarget = chunks.filter((chunk) => estimateTokens(chunk.payload.content) < MIN_CHUNK_TOKENS);
  if (belowTarget.length > 0) {
    console.log(`${belowTarget.length} chunks are under ${MIN_CHUNK_TOKENS} tokens because their source file/section is short.`);
  }
}

if (process.argv[1]?.includes("chunk-content")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
