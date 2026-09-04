export interface IngestDocumentInput {
  filename: string;
  content?: string;
  data?: string; // base64
  mimeType?: string;
}

export function toFormData(documents: IngestDocumentInput[]): FormData {
  const form = new FormData();
  for (const doc of documents) {
    const hasContent = doc.content !== undefined;
    const hasData = doc.data !== undefined;
    if (hasContent === hasData) {
      throw new Error(`exactly one of content/data is required for ${doc.filename}`);
    }
    const bytes = hasContent ? Buffer.from(doc.content!, "utf8") : Buffer.from(doc.data!, "base64");
    const blob = new Blob([bytes], { type: doc.mimeType ?? "application/octet-stream" });
    form.append("files", blob, doc.filename);
  }
  return form;
}

export function filesToFormData(files: { body: Buffer; filename: string; mimeType?: string }[]): FormData {
  const form = new FormData();
  for (const f of files) {
    const bytes = Buffer.from(f.body);
    const blob = new Blob([bytes], { type: f.mimeType ?? "application/octet-stream" });
    form.append("files", blob, f.filename);
  }
  return form;
}
