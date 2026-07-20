import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';

import { resolveGsErrorText } from '../services/gsAuth';
import { i18nService } from '../services/i18n';
import Modal from './common/Modal';

const MAX_CONTENT_LENGTH = 2000;

interface GsFeedbackDialogProps {
  onClose: () => void;
}

/** 反馈建议弹窗（从侧边栏用户菜单打开），提交到 GS 服务端供管理员查看 */
const GsFeedbackDialog: React.FC<GsFeedbackDialogProps> = ({ onClose }) => {
  const [content, setContent] = useState('');
  const [contact, setContact] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const canSubmit = !submitting && content.trim().length > 0;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError('');
    setSubmitting(true);
    const result = await window.electron.gsAuth.submitFeedback(content.trim(), contact.trim());
    setSubmitting(false);
    if (result.success) {
      setDone(true);
      setTimeout(onClose, 1200);
    } else {
      setError(resolveGsErrorText(result.message, 'gsFeedbackFailed'));
    }
  };

  return (
    <Modal
      onClose={onClose}
      overlayClassName="fixed inset-0 z-[10050] flex items-center justify-center modal-backdrop px-4"
      className="modal-content w-full max-w-md rounded-2xl border border-border bg-surface p-5 shadow-modal"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="text-base font-semibold leading-6 text-foreground">
          {i18nService.t('gsFeedback')}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 rounded-lg p-1 text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
          aria-label={i18nService.t('close')}
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>
      {done ? (
        <div className="mt-5 text-sm text-foreground">{i18nService.t('gsFeedbackSuccess')}</div>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">{i18nService.t('gsFeedbackContent')}</span>
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value.slice(0, MAX_CONTENT_LENGTH))}
              placeholder={i18nService.t('gsFeedbackPlaceholder')}
              rows={5}
              autoFocus
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-secondary/60 focus:border-primary"
            />
            <span className="self-end text-xs text-secondary/70">
              {content.length}/{MAX_CONTENT_LENGTH}
            </span>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">{i18nService.t('gsFeedbackContact')}</span>
            <input
              value={contact}
              onChange={(event) => setContact(event.target.value.slice(0, 128))}
              placeholder={i18nService.t('gsFeedbackContactPlaceholder')}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors placeholder:text-secondary/60 focus:border-primary"
            />
          </label>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-1 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {i18nService.t(submitting ? 'gsFeedbackSubmitting' : 'gsFeedbackSubmit')}
          </button>
        </form>
      )}
    </Modal>
  );
};

export default GsFeedbackDialog;
