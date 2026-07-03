import type {
  KnowledgeBaseDoc,
  KnowledgeBaseImportBatch,
  KnowledgeBaseImportProgressEvent,
  KnowledgeBaseSummary,
} from '../types/knowledgeBase';

class KnowledgeBaseService {
  async list(): Promise<KnowledgeBaseSummary[]> {
    const api = window.electron?.cowork?.listKnowledgeBases;
    if (!api) return [];
    const result = await api();
    if (!result?.success || !result.knowledgeBases) return [];
    return result.knowledgeBases;
  }

  async create(name: string): Promise<KnowledgeBaseSummary | null> {
    const api = window.electron?.cowork?.createKnowledgeBase;
    if (!api) return null;
    const result = await api({ name });
    if (!result?.success || !result.knowledgeBase) return null;
    return result.knowledgeBase;
  }

  async rename(id: string, name: string): Promise<KnowledgeBaseSummary | null> {
    const api = window.electron?.cowork?.renameKnowledgeBase;
    if (!api) return null;
    const result = await api({ id, name });
    if (!result?.success || !result.knowledgeBase) return null;
    return result.knowledgeBase;
  }

  async delete(id: string): Promise<boolean> {
    const api = window.electron?.cowork?.deleteKnowledgeBase;
    if (!api) return false;
    const result = await api({ id });
    return Boolean(result?.success);
  }

  async listDocs(id: string): Promise<KnowledgeBaseDoc[]> {
    const api = window.electron?.cowork?.listKnowledgeBaseDocs;
    if (!api) return [];
    const result = await api({ id });
    if (!result?.success || !result.docs) return [];
    return result.docs;
  }

  async importDocs(id: string, filePaths: string[]): Promise<KnowledgeBaseImportBatch> {
    const api = window.electron?.cowork?.importKnowledgeBaseDocs;
    if (!api) return { results: [], skipped: 0, truncated: false };
    const result = await api({ id, filePaths });
    if (!result?.success || !result.results) return { results: [], skipped: 0, truncated: false };
    return {
      results: result.results,
      skipped: result.skipped ?? 0,
      truncated: result.truncated ?? false,
    };
  }

  async readDoc(id: string, fileName: string): Promise<string | null> {
    const api = window.electron?.cowork?.readKnowledgeBaseDoc;
    if (!api) return null;
    const result = await api({ id, fileName });
    if (!result?.success) return null;
    return result.content ?? '';
  }

  async deleteDoc(id: string, fileName: string): Promise<boolean> {
    const api = window.electron?.cowork?.deleteKnowledgeBaseDoc;
    if (!api) return false;
    const result = await api({ id, fileName });
    return Boolean(result?.success);
  }

  /** Open the native file picker; returns [] when cancelled or unavailable. */
  async pickDocs(): Promise<string[]> {
    const api = window.electron?.cowork?.pickKnowledgeBaseDocs;
    if (!api) return [];
    const result = await api();
    if (!result?.success || !result.filePaths) return [];
    return result.filePaths;
  }

  /** Open the native folder picker; returns [] when cancelled or unavailable. */
  async pickFolder(): Promise<string[]> {
    const api = window.electron?.cowork?.pickKnowledgeBaseFolder;
    if (!api) return [];
    const result = await api();
    if (!result?.success || !result.folderPaths) return [];
    return result.folderPaths;
  }

  /** Subscribe to import progress events; returns an unsubscribe function. */
  onImportProgress(callback: (event: KnowledgeBaseImportProgressEvent) => void): () => void {
    const api = window.electron?.cowork?.onKnowledgeBaseImportProgress;
    if (!api) return () => undefined;
    return api(callback);
  }
}

export const knowledgeBaseService = new KnowledgeBaseService();
