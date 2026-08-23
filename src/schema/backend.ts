import { z } from "zod";

export const FilterOp = z.enum(["equals", "notEquals", "greaterThan", "lessThan", "startsWith", "stringContains"]);
export const SimpleFilter = z.object({ key: z.string(), op: FilterOp, value: z.any() });

/** Restricted kbId format — guards against path traversal when interpolated into backend paths. */
export const KbId = z.string().regex(/^[A-Za-z0-9_-]+$/, "invalid kbId");

export interface ChunkDto { content: string; documentId: string; similarity: number; }
export interface DocumentMetadata { key: string; value: unknown; type: string; }
export interface DocumentDto { id: string; name: string; size?: number; uploadType: string; metadata?: DocumentMetadata[]; status: string; createdAt?: string; }
export interface KnowledgeBaseDto { id: string; name: string; description?: string; embeddingModel?: string; parsingMethod?: string; chunkingMethod?: string; chunkSize?: number; overlappedPercent?: number; serviceAccountValid?: boolean; status?: string; createdAt?: string; agents?: unknown[]; }
export interface KnowledgeBaseInstruction { id: string; instruction?: string; }
export interface AgentBuilderDto { id: string; name: string; description?: string; instruction?: string; modelIdentifier?: string; status?: string; accessibility?: string; knowledgeBaseInfos?: KnowledgeBaseInstruction[]; }

export function buildDocumentFilter(filters?: { key: string; op: string; value: any }[]): unknown {
  if (!filters || filters.length === 0) return undefined;
  const toSimple = (f: { key: string; op: string; value: any }) => ({ kind: "simple", type: f.op, key: f.key, value: f.value });
  if (filters.length === 1) return toSimple(filters[0]);
  return { kind: "compound", type: "AND", filters: filters.map(toSimple) };
}
