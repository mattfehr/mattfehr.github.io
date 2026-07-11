export type SourceType =
  | "project"
  | "about"
  | "resume"
  | "faq"
  | "skills"
  | "experience"
  | "contact"
  | "career";

export interface ContentFrontmatter {
  title: string;
  sourceType: SourceType;
  url?: string;
  tags?: string[];
  priority?: number;
  projectName?: string;
}

export interface ChunkPayload {
  title: string;
  sourceType: SourceType;
  projectName?: string;
  section: string;
  content: string;
  url?: string;
  tags: string[];
  priority: number;
}

export interface ContentChunk {
  id: string;
  payload: ChunkPayload;
  textForEmbedding: string;
}

export interface EmbeddedChunk extends ContentChunk {
  vector: number[];
}

/** Local sentence embedding model (Transformers.js). Must match Worker Workers AI model. */
export const EMBEDDING_MODEL = "Xenova/bge-small-en-v1.5";
export const EMBEDDING_DIMENSION = 384;
export const MIN_CHUNK_TOKENS = 300;
export const MAX_CHUNK_TOKENS = 500;
