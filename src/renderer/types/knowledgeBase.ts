export interface KnowledgeBaseSummary {
  id: string;
  name: string;
  /** Absolute path of the knowledge base directory (used in agent context hints). */
  path: string;
  docCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeBaseDoc {
  fileName: string;
  size: number;
  updatedAt: number;
}

export type KnowledgeBaseImportErrorCode = 'unsupported' | 'legacyDoc' | 'tooLarge' | 'readFailed' | 'convertFailed';

export interface KnowledgeBaseImportResult {
  sourcePath: string;
  success: boolean;
  fileName?: string;
  errorCode?: KnowledgeBaseImportErrorCode;
}

export interface KnowledgeBaseImportBatch {
  results: KnowledgeBaseImportResult[];
  /** Files inside imported folders skipped as unsupported formats. */
  skipped: number;
  /** True when the per-batch file cap stopped folder expansion early. */
  truncated: boolean;
}

export interface KnowledgeBaseImportProgressEvent {
  kbId: string;
  done: number;
  total: number;
  fileName: string;
}
