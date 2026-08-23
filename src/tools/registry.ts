import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HandlerDeps } from "./types.js";
import type { AuthContext } from "../auth/inbound.js";
import { searchTool, SearchInputSchema } from "./search.js";
import { ingestDocumentTool, ingestBatchTool, IngestDocumentInputSchema, IngestBatchInputSchema } from "./ingest.js";
import { listDocumentsTool, getDocumentTool, deleteDocumentTool, getIngestStatusTool, ListDocumentsInputSchema, GetDocumentInputSchema, DeleteDocumentInputSchema, GetIngestStatusInputSchema } from "./documents.js";
import { listKnowledgeBasesTool, createKnowledgeBaseTool, deleteKnowledgeBaseTool, getKnowledgeBaseTool, ListKnowledgeBasesInputSchema, CreateKnowledgeBaseInputSchema, DeleteKnowledgeBaseInputSchema, GetKnowledgeBaseInputSchema } from "./knowledgeBases.js";

export function registerTools(server: McpServer, deps: HandlerDeps, auth: AuthContext): void {
  const h = <A,>(fn: (d: HandlerDeps, a: AuthContext, args: A) => Promise<any>) => (async (args: A) => fn(deps, auth, args)) as any;

  server.registerTool("search", { description: "Semantic search over the in-scope knowledge base(s) (engine's KBs, or all account KBs). Returns chunks {content, documentId, similarity}.", inputSchema: SearchInputSchema }, h(searchTool));
  server.registerTool("ingest_document", { description: "Ingest one file (text content or base64 bytes) into a knowledge base. Async — poll get_ingest_status.", inputSchema: IngestDocumentInputSchema }, h(ingestDocumentTool));
  server.registerTool("ingest_batch", { description: "Ingest multiple files into a knowledge base in one call.", inputSchema: IngestBatchInputSchema }, h(ingestBatchTool));
  server.registerTool("get_ingest_status", { description: "Poll KB + document ingest status (async pair for ingest_document/ingest_batch).", inputSchema: GetIngestStatusInputSchema }, h(getIngestStatusTool));
  server.registerTool("delete_document", { description: "Delete one or more documents from a knowledge base (batch).", inputSchema: DeleteDocumentInputSchema }, h(deleteDocumentTool));
  server.registerTool("get_document", { description: "Fetch a document by id (lists client-side; bounded by maxPages).", inputSchema: GetDocumentInputSchema }, h(getDocumentTool));
  server.registerTool("list_documents", { description: "List documents in a knowledge base (paginated).", inputSchema: ListDocumentsInputSchema }, h(listDocumentsTool));
  server.registerTool("list_knowledge_bases", { description: "List knowledge bases. When engine is set, only the engine's KBs.", inputSchema: ListKnowledgeBasesInputSchema }, h(listKnowledgeBasesTool));
  server.registerTool("create_knowledge_base", { description: "Create a knowledge base.", inputSchema: CreateKnowledgeBaseInputSchema }, h(createKnowledgeBaseTool));
  server.registerTool("delete_knowledge_base", { description: "Delete a knowledge base (fails if agents use it).", inputSchema: DeleteKnowledgeBaseInputSchema }, h(deleteKnowledgeBaseTool));
  server.registerTool("get_knowledge_base", { description: "Get knowledge-base detail.", inputSchema: GetKnowledgeBaseInputSchema }, h(getKnowledgeBaseTool));
}
