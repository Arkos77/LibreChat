/** Native RAG /query document, with optional identifiers supplied by the store. */
export interface RetrievalDocument {
  id?: string;
  page_content: string;
  metadata?: { source?: string; file_id?: string; chunk_id?: string; page?: number };
}

interface FileSearchResult {
  filename: string;
  source: string;
  content: string;
  distance: number;
  file_id: string;
  documentId: string;
  chunkId?: string;
  page: number | null;
}

/** Preserve request identity even when other file queries fail. Distance is not truth confidence. */
export function collectFileSearchResults(
  results: Array<{ fileId: string; data: Array<[RetrievalDocument, number]> }>,
  maxDistance: number = Infinity,
): FileSearchResult[] {
  return results
    .flatMap(({ fileId, data }) =>
      data.flatMap(([doc, distance]) => {
        const source = doc.metadata?.source;
        if (
          !fileId ||
          !source?.trim() ||
          !doc.page_content?.trim() ||
          !Number.isFinite(distance) ||
          distance > maxDistance ||
          (doc.metadata?.file_id != null && doc.metadata.file_id !== fileId)
        ) {
          return [];
        }
        return [
          {
            filename: source.split('/').pop()!,
            source,
            content: doc.page_content,
            distance,
            file_id: fileId,
            documentId: doc.metadata?.file_id ?? fileId,
            chunkId: doc.id ?? doc.metadata?.chunk_id,
            page: doc.metadata?.page ?? null,
          },
        ];
      }),
    )
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 10);
}
