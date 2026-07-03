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
