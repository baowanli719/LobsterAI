import {
  ArrowLeftIcon,
  ArrowUpTrayIcon,
  DocumentTextIcon,
  EyeIcon,
  FolderArrowDownIcon,
  InformationCircleIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { knowledgeBaseService } from '../../services/knowledgeBase';
import { RootState } from '../../store';
import { selectCoworkConfig } from '../../store/selectors/coworkSelectors';
import { setKnowledgeBases } from '../../store/slices/knowledgeBaseSlice';
import type { KnowledgeBaseDoc, KnowledgeBaseImportBatch, KnowledgeBaseImportResult } from '../../types/knowledgeBase';
import Modal from '../common/Modal';

interface KnowledgeBaseManagerProps {
  /** When provided, renders a back button (embedded-subview mode). */
  onBack?: () => void;
}

const showToast = (message: string): void => {
  window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
};

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const formatDate = (timestamp: number): string => {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

const importErrorMessage = (result: KnowledgeBaseImportResult): string => {
  switch (result.errorCode) {
    case 'unsupported':
      return i18nService.t('kbImportFailedUnsupported');
    case 'legacyDoc':
      return i18nService.t('kbImportFailedLegacyDoc');
    case 'tooLarge':
      return i18nService.t('kbImportFailedTooLarge');
    case 'convertFailed':
      return i18nService.t('kbImportFailedConvert');
    default:
      return i18nService.t('kbImportFailedRead');
  }
};

const KnowledgeBaseManager: React.FC<KnowledgeBaseManagerProps> = ({ onBack }) => {
  const dispatch = useDispatch();
  const knowledgeBases = useSelector((state: RootState) => state.knowledgeBase.knowledgeBases);
  const coworkConfig = useSelector(selectCoworkConfig);
  const embeddingEnabled = coworkConfig.embeddingEnabled ?? false;

  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);
  const [docs, setDocs] = useState<KnowledgeBaseDoc[]>([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [nameModal, setNameModal] = useState<{ mode: 'create' | 'rename'; kbId?: string } | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [kbPendingDelete, setKbPendingDelete] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ fileName: string; content: string } | null>(null);
  const [importProgress, setImportProgress] = useState<{ done: number; total: number; fileName: string } | null>(null);
  const [importSummary, setImportSummary] = useState<KnowledgeBaseImportBatch | null>(null);

  const selectedKb = useMemo(
    () => knowledgeBases.find(kb => kb.id === selectedKbId) ?? null,
    [knowledgeBases, selectedKbId],
  );

  const refreshKnowledgeBases = useCallback(async () => {
    const list = await knowledgeBaseService.list();
    dispatch(setKnowledgeBases(list));
    return list;
  }, [dispatch]);

  useEffect(() => {
    refreshKnowledgeBases().then(list => {
      setSelectedKbId(prev => prev ?? (list[0]?.id ?? null));
    });
  }, [refreshKnowledgeBases]);

  const refreshDocs = useCallback(async (kbId: string) => {
    setDocsLoading(true);
    try {
      setDocs(await knowledgeBaseService.listDocs(kbId));
    } finally {
      setDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedKbId) {
      refreshDocs(selectedKbId);
    } else {
      setDocs([]);
    }
  }, [selectedKbId, refreshDocs]);

  const handleNameSubmit = async () => {
    const name = nameDraft.trim();
    if (!name || !nameModal) return;
    if (nameModal.mode === 'create') {
      const created = await knowledgeBaseService.create(name);
      if (created) {
        await refreshKnowledgeBases();
        setSelectedKbId(created.id);
      }
    } else if (nameModal.kbId) {
      await knowledgeBaseService.rename(nameModal.kbId, name);
      await refreshKnowledgeBases();
    }
    setNameModal(null);
    setNameDraft('');
  };

  const handleConfirmDelete = async () => {
    if (!kbPendingDelete) return;
    const deleted = await knowledgeBaseService.delete(kbPendingDelete);
    if (deleted) {
      const list = await refreshKnowledgeBases();
      if (selectedKbId === kbPendingDelete) {
        setSelectedKbId(list[0]?.id ?? null);
      }
    }
    setKbPendingDelete(null);
  };

  const importFiles = useCallback(async (filePaths: string[]) => {
    if (!selectedKbId || filePaths.length === 0) return;
    const kbId = selectedKbId;
    setIsImporting(true);
    setImportProgress(null);
    const unsubscribe = knowledgeBaseService.onImportProgress(event => {
      if (event.kbId === kbId) {
        setImportProgress({ done: event.done, total: event.total, fileName: event.fileName });
      }
    });
    try {
      const batch = await knowledgeBaseService.importDocs(kbId, filePaths);
      const failed = batch.results.filter(r => !r.success);
      if (failed.length === 0 && batch.skipped === 0 && !batch.truncated) {
        showToast(
          i18nService.t('kbImportAllSuccess').replace('{count}', String(batch.results.length)),
        );
      } else {
        setImportSummary(batch);
      }
      await refreshDocs(kbId);
      await refreshKnowledgeBases();
    } finally {
      unsubscribe();
      setImportProgress(null);
      setIsImporting(false);
    }
  }, [selectedKbId, refreshDocs, refreshKnowledgeBases]);

  const handlePickAndImport = async () => {
    const filePaths = await knowledgeBaseService.pickDocs();
    await importFiles(filePaths);
  };

  const handlePickFolderAndImport = async () => {
    const folderPaths = await knowledgeBaseService.pickFolder();
    await importFiles(folderPaths);
  };

  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault();
    setIsDragOver(false);
    const filePaths = Array.from(event.dataTransfer.files)
      .map(file => (file as File & { path?: string }).path)
      .filter((p): p is string => Boolean(p));
    await importFiles(filePaths);
  };

  const handlePreview = async (doc: KnowledgeBaseDoc) => {
    if (!selectedKbId) return;
    const content = await knowledgeBaseService.readDoc(selectedKbId, doc.fileName);
    if (content !== null) {
      setPreview({ fileName: doc.fileName, content });
    }
  };

  const handleDeleteDoc = async (doc: KnowledgeBaseDoc) => {
    if (!selectedKbId) return;
    await knowledgeBaseService.deleteDoc(selectedKbId, doc.fileName);
    await refreshDocs(selectedKbId);
    await refreshKnowledgeBases();
  };

  const kbPendingDeleteSummary = kbPendingDelete
    ? knowledgeBases.find(kb => kb.id === kbPendingDelete) ?? null
    : null;

  return (
    <div className="space-y-4">
      {/* Back button (embedded-subview mode only) */}
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="non-draggable relative z-30 inline-flex items-center gap-1.5 text-sm text-secondary hover:text-foreground transition-colors"
        >
          <ArrowLeftIcon className="h-4 w-4" />
          {i18nService.t('kitBack')}
        </button>
      )}

      <div className="flex items-center justify-between">
        <div>
          {onBack && <h2 className="text-lg font-semibold text-foreground">{i18nService.t('knowledgeBase')}</h2>}
          <p className="mt-1 text-sm text-secondary">{i18nService.t('kbPageDescription')}</p>
        </div>
        <button
          type="button"
          onClick={() => { setNameDraft(''); setNameModal({ mode: 'create' }); }}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-white transition-colors hover:bg-primary-hover"
        >
          <PlusIcon className="h-3.5 w-3.5" />
          {i18nService.t('kbCreate')}
        </button>
      </div>

      {/* Retrieval mode hint: FTS-only keyword search until embedding is enabled */}
      {!embeddingEnabled && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-[12px] leading-5 text-secondary">
          <InformationCircleIcon className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{i18nService.t('kbEmbeddingDisabledHint')}</span>
        </div>
      )}

      {knowledgeBases.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center text-sm text-secondary">
          {i18nService.t('kbEmpty')}
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Knowledge base list */}
          <div className="w-64 flex-shrink-0 space-y-1.5">
            {knowledgeBases.map(kb => (
              <div
                key={kb.id}
                onClick={() => setSelectedKbId(kb.id)}
                className={`group cursor-pointer rounded-lg border px-3 py-2.5 transition-colors ${
                  kb.id === selectedKbId
                    ? 'border-primary/50 bg-primary-muted'
                    : 'border-border bg-surface hover:border-primary/30'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">{kb.name}</span>
                  <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setNameDraft(kb.name);
                        setNameModal({ mode: 'rename', kbId: kb.id });
                      }}
                      className="rounded p-1 text-secondary hover:text-foreground"
                    >
                      <PencilIcon className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setKbPendingDelete(kb.id); }}
                      className="rounded p-1 text-secondary hover:text-red-500"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-secondary">
                  {i18nService.t('kbDocCount').replace('{count}', String(kb.docCount))}
                </div>
              </div>
            ))}
          </div>

          {/* Document panel */}
          <div
            className={`min-h-[320px] flex-1 rounded-xl border p-4 transition-colors ${
              isDragOver ? 'border-primary bg-primary-muted' : 'border-border bg-surface'
            }`}
            onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleDrop}
          >
            {selectedKb ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-foreground">{selectedKb.name}</h3>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isImporting}
                      onClick={handlePickAndImport}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-secondary transition-colors hover:bg-surface-raised disabled:opacity-50"
                    >
                      <ArrowUpTrayIcon className="h-3 w-3" />
                      {isImporting ? i18nService.t('kbImporting') : i18nService.t('kbImportDocs')}
                    </button>
                    <button
                      type="button"
                      disabled={isImporting}
                      onClick={handlePickFolderAndImport}
                      className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[11px] font-medium text-secondary transition-colors hover:bg-surface-raised disabled:opacity-50"
                    >
                      <FolderArrowDownIcon className="h-3 w-3" />
                      {i18nService.t('kbImportFolder')}
                    </button>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-secondary">{i18nService.t('kbDropHint')}</p>

                {/* Import progress */}
                {isImporting && importProgress && importProgress.total > 0 && (
                  <div className="mt-3 rounded-lg border border-border bg-surface-raised px-3 py-2">
                    <div className="flex items-center justify-between text-[11px] text-secondary">
                      <span className="min-w-0 truncate pr-3">
                        {i18nService.t('kbImportProgress')
                          .replace('{done}', String(Math.min(importProgress.done + 1, importProgress.total)))
                          .replace('{total}', String(importProgress.total))
                          .replace('{fileName}', importProgress.fileName)}
                      </span>
                      <span className="flex-shrink-0">
                        {Math.round((importProgress.done / importProgress.total) * 100)}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-200"
                        style={{ width: `${(importProgress.done / importProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {docsLoading ? (
                  <div className="py-12 text-center text-sm text-secondary">{i18nService.t('kitLoading')}</div>
                ) : docs.length === 0 ? (
                  <div className="py-12 text-center text-sm text-secondary">{i18nService.t('kbNoDocs')}</div>
                ) : (
                  <div className="mt-3 space-y-1.5">
                    {docs.map(doc => (
                      <div
                        key={doc.fileName}
                        className="group flex items-center justify-between rounded-lg border border-border px-3 py-2"
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <DocumentTextIcon className="h-4 w-4 flex-shrink-0 text-secondary" />
                          <span className="truncate text-sm text-foreground">{doc.fileName}</span>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-3">
                          <span className="text-[11px] text-secondary">{formatSize(doc.size)}</span>
                          <span className="text-[11px] text-secondary">{formatDate(doc.updatedAt)}</span>
                          <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              onClick={() => handlePreview(doc)}
                              className="rounded p-1 text-secondary hover:text-foreground"
                            >
                              <EyeIcon className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteDoc(doc)}
                              className="rounded p-1 text-secondary hover:text-red-500"
                            >
                              <TrashIcon className="h-3.5 w-3.5" />
                            </button>
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div className="py-12 text-center text-sm text-secondary">{i18nService.t('kbEmpty')}</div>
            )}
          </div>
        </div>
      )}

      {/* Create / rename modal */}
      {nameModal && (
        <Modal
          onClose={() => setNameModal(null)}
          overlayClassName="fixed inset-0 z-[9999] flex items-center justify-center modal-backdrop px-4"
          className="modal-content w-full max-w-sm rounded-2xl border border-border bg-surface shadow-modal p-5"
        >
          <div className="text-lg font-semibold text-foreground">
            {i18nService.t(nameModal.mode === 'create' ? 'kbCreate' : 'kbRename')}
          </div>
          <input
            type="text"
            autoFocus
            value={nameDraft}
            maxLength={64}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleNameSubmit(); }}
            placeholder={i18nService.t('kbCreateNamePlaceholder')}
            className="mt-3 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder-secondary focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setNameModal(null)}
              className="px-3 py-1.5 text-xs rounded-lg border border-border text-secondary hover:bg-surface-raised transition-colors"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              disabled={!nameDraft.trim()}
              onClick={handleNameSubmit}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {i18nService.t('confirm')}
            </button>
          </div>
        </Modal>
      )}

      {/* Delete confirm modal */}
      {kbPendingDeleteSummary && (
        <Modal
          onClose={() => setKbPendingDelete(null)}
          overlayClassName="fixed inset-0 z-[9999] flex items-center justify-center modal-backdrop px-4"
          className="modal-content w-full max-w-sm rounded-2xl border border-border bg-surface shadow-modal p-5"
        >
          <div className="text-lg font-semibold text-foreground">{i18nService.t('kbDelete')}</div>
          <p className="mt-2 text-sm text-secondary">
            {i18nService.t('kbDeleteConfirm')
              .replace('{name}', kbPendingDeleteSummary.name)
              .replace('{count}', String(kbPendingDeleteSummary.docCount))}
          </p>
          <div className="mt-4 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setKbPendingDelete(null)}
              className="px-3 py-1.5 text-xs rounded-lg border border-border text-secondary hover:bg-surface-raised transition-colors"
            >
              {i18nService.t('cancel')}
            </button>
            <button
              type="button"
              onClick={handleConfirmDelete}
              className="px-3 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-400 transition-colors"
            >
              {i18nService.t('confirmDelete')}
            </button>
          </div>
        </Modal>
      )}

      {/* Import result summary modal */}
      {importSummary && (
        <Modal
          onClose={() => setImportSummary(null)}
          overlayClassName="fixed inset-0 z-[9999] flex items-center justify-center modal-backdrop px-4"
          className="modal-content flex max-h-[70vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-modal"
        >
          <div className="border-b border-border px-5 py-3">
            <div className="text-base font-semibold text-foreground">{i18nService.t('kbImportResultTitle')}</div>
            <p className="mt-1 text-sm text-secondary">
              {i18nService.t('kbImportResultSummary')
                .replace('{success}', String(importSummary.results.filter(r => r.success).length))
                .replace('{failed}', String(importSummary.results.filter(r => !r.success).length))}
            </p>
            {importSummary.skipped > 0 && (
              <p className="mt-0.5 text-[12px] text-secondary">
                {i18nService.t('kbImportResultSkipped').replace('{count}', String(importSummary.skipped))}
              </p>
            )}
            {importSummary.truncated && (
              <p className="mt-0.5 text-[12px] text-amber-700 dark:text-amber-300">
                {i18nService.t('kbImportResultTruncated')}
              </p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {importSummary.results.filter(r => !r.success).map((r, idx) => (
              <div key={`fail-${idx}`} className="flex items-start justify-between gap-3 border-b border-border/50 py-1.5 last:border-b-0">
                <span className="min-w-0 truncate text-[12px] text-foreground">
                  {r.sourcePath.split(/[\\/]/).pop()}
                </span>
                <span className="flex-shrink-0 text-[12px] text-red-500 dark:text-red-400">
                  {importErrorMessage(r)}
                </span>
              </div>
            ))}
            {importSummary.results.filter(r => r.success).map((r, idx) => (
              <div key={`ok-${idx}`} className="flex items-start justify-between gap-3 border-b border-border/50 py-1.5 last:border-b-0">
                <span className="min-w-0 truncate text-[12px] text-secondary">
                  {r.sourcePath.split(/[\\/]/).pop()}
                </span>
                <span className="flex-shrink-0 text-[12px] text-green-600 dark:text-green-400">
                  {i18nService.t('kbImportResultOk')}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-end border-t border-border px-5 py-3">
            <button
              type="button"
              onClick={() => setImportSummary(null)}
              className="px-3 py-1.5 text-xs rounded-lg bg-primary text-white hover:bg-primary-hover transition-colors"
            >
              {i18nService.t('confirm')}
            </button>
          </div>
        </Modal>
      )}

      {/* Preview modal */}
      {preview && (
        <Modal
          onClose={() => setPreview(null)}
          overlayClassName="fixed inset-0 z-[9999] flex items-center justify-center modal-backdrop px-4"
          className="modal-content flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-modal"
        >
          <div className="flex items-center justify-between border-b border-border px-5 py-3">
            <div className="truncate text-sm font-semibold text-foreground">{preview.fileName}</div>
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="rounded p-1 text-secondary hover:text-foreground"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
          <pre className="flex-1 overflow-auto whitespace-pre-wrap break-words px-5 py-4 text-xs leading-5 text-foreground">
            {preview.content}
          </pre>
        </Modal>
      )}
    </div>
  );
};

export default KnowledgeBaseManager;
