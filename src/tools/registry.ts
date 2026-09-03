import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import type { Transport } from "../config/env.js";
import { searchTool, SearchInputSchema } from "./search.js";
import { ingestDocumentTool, ingestBatchTool, IngestDocumentInputSchema, IngestBatchInputSchema } from "./ingest.js";
import { listDocumentsTool, getDocumentTool, deleteDocumentTool, getIngestStatusTool, ListDocumentsInputSchema, GetDocumentInputSchema, DeleteDocumentInputSchema, GetIngestStatusInputSchema } from "./documents.js";
import { listKnowledgeBasesTool, createKnowledgeBaseTool, deleteKnowledgeBaseTool, getKnowledgeBaseTool, ListKnowledgeBasesInputSchema, CreateKnowledgeBaseInputSchema, DeleteKnowledgeBaseInputSchema, GetKnowledgeBaseInputSchema } from "./knowledgeBases.js";

// Ingest upload guidance is transport-specific so the agent never has to guess.
// stdio: server is local — read the file, base64 it, pass as `data`.
// http:  server is remote and cannot read the caller's disk — caller must inline;
//        for large files, stop and recommend running locally over stdio instead.
const INGEST_FLOW = " Upload is async — afterwards call get_ingest_status(kbId) and poll until the document is ACTIVE.";

function ingestDocumentDescription(transport: Transport): string {
  if (transport === "stdio") {
    return "Upload one file into a knowledge base. You are connected over stdio, so the server runs locally on your machine. To upload: read the file from disk, base64-encode its bytes, and pass them as `data` together with `mimeType`; for plain-text files you may pass the text as `content` instead. Exactly one of `content`/`data` is required." + INGEST_FLOW + " Note: base64 is ~33% larger than the file; very large files may be truncated by your client when inlined — a path-based ingest tool for large local files is planned.";
  }
  return "Upload one file into a knowledge base. You are connected over streamable HTTP, so the server is REMOTE and cannot read your disk — you must read the file yourself and pass `content` (text) or `data` (base64 bytes; exactly one required). Before uploading, check the file size: base64 is ~33% larger than the file and large files can overflow your context or the tool call. If the file is large (roughly >= 50 KB), STOP and do NOT inline it — tell the user to run this MCP server locally over stdio instead. For small files: base64-encode and pass as `data` with `mimeType`." + INGEST_FLOW;
}

function ingestBatchDescription(transport: Transport): string {
  if (transport === "stdio") {
    return "Upload multiple files into a knowledge base in one call. stdio (local server): for each file, read it from disk, base64-encode it, and pass as `data` with `mimeType` (or `content` for plain text); exactly one of `content`/`data` per file." + INGEST_FLOW + " Note: base64 is ~33% larger than the file; very large files may be truncated by your client when inlined.";
  }
  return "Upload multiple files into a knowledge base in one call. HTTP (remote server): the server cannot read your disk, so you must read each file yourself and pass `content` (text) or `data` (base64); exactly one per file. Check sizes first — base64 is ~33% larger; if any file is large (roughly >= 50 KB), STOP and recommend running locally over stdio instead of inlining. For small files, base64-encode and pass as `data` with `mimeType`." + INGEST_FLOW;
}

export function registerTools(server: McpServer, deps: HandlerDeps, auth: AuthContext): void {
  const h = <A,>(fn: (d: HandlerDeps, a: AuthContext, args: A) => Promise<any>) => (async (args: A) => fn(deps, auth, args)) as any;
  const transport = deps.config.transport;

  server.registerTool("search", { description: "Semantic search over the in-scope knowledge base(s) (engine's KBs, or all account KBs). Returns chunks {content, documentId, similarity}.", inputSchema: SearchInputSchema }, h(searchTool));
  server.registerTool("ingest_document", { description: ingestDocumentDescription(transport), inputSchema: IngestDocumentInputSchema }, h(ingestDocumentTool));
  server.registerTool("ingest_batch", { description: ingestBatchDescription(transport), inputSchema: IngestBatchInputSchema }, h(ingestBatchTool));
  server.registerTool("get_ingest_status", { description: "Poll KB + document ingest status (async pair for ingest_document/ingest_batch).", inputSchema: GetIngestStatusInputSchema }, h(getIngestStatusTool));
  server.registerTool("delete_document", { description: "Delete one or more documents from a knowledge base (batch).", inputSchema: DeleteDocumentInputSchema }, h(deleteDocumentTool));
  server.registerTool("get_document", { description: "Fetch a document by id (lists client-side; bounded by maxPages).", inputSchema: GetDocumentInputSchema }, h(getDocumentTool));
  server.registerTool("list_documents", { description: "List documents in a knowledge base (paginated).", inputSchema: ListDocumentsInputSchema }, h(listDocumentsTool));
  server.registerTool("list_knowledge_bases", { description: "List knowledge bases. When engine is set, only the engine's KBs.", inputSchema: ListKnowledgeBasesInputSchema }, h(listKnowledgeBasesTool));
  server.registerTool("create_knowledge_base", { description: "Create a knowledge base.", inputSchema: CreateKnowledgeBaseInputSchema }, h(createKnowledgeBaseTool));
  server.registerTool("delete_knowledge_base", { description: "Delete a knowledge base (fails if agents use it).", inputSchema: DeleteKnowledgeBaseInputSchema }, h(deleteKnowledgeBaseTool));
  server.registerTool("get_knowledge_base", { description: "Get knowledge-base detail.", inputSchema: GetKnowledgeBaseInputSchema }, h(getKnowledgeBaseTool));
}
