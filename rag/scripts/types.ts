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

export const EMBEDDING_MODEL = "text-embedding-004";
export const EMBEDDING_DIMENSION = 768;
export const MIN_CHUNK_TOKENS = 300;
export const MAX_CHUNK_TOKENS = 700;
