import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';

import { i18nService } from '../services/i18n';
import Modal from './common/Modal';
import GsPasswordInput from './GsPasswordInput';

interface GsChangePasswordDialogProps {
  onClose: () => void;
}

/** 登录用户修改自己密码的弹窗（从侧边栏用户菜单打开） */
const GsChangePasswordDialog: React.FC<GsChangePasswordDialogProps> = ({ onClose }) => {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const canSubmit = !submitting && oldPassword && newPassword && confirmPassword;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setError('');
    if (newPassword.length < 6) {
      setError(i18nService.t('gsPasswordTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(i18nService.t('gsPasswordMismatch'));
      return;
    }
    setSubmitting(true);
    const result = await window.electron.gsAuth.changePassword(oldPassword, newPassword);
    setSubmitting(false);
    if (result.success) {
      setDone(true);
      setTimeout(onClose, 1200);
    } else {
      setError(result.message || i18nService.t('gsChangePasswordFailed'));
    }
  };

  return (
    <Modal
      onClose={onClose}
      overlayClassName="fixed inset-0 z-[10050] flex items-center justify-center modal-backdrop px-4"
      className="modal-content w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-modal"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="text-base font-semibold leading-6 text-foreground">
          {i18nService.t('gsChangePassword')}
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
        <div className="mt-5 text-sm text-foreground">{i18nService.t('gsChangePasswordSuccess')}</div>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">{i18nService.t('gsOldPassword')}</span>
            <GsPasswordInput value={oldPassword} onChange={setOldPassword} autoFocus />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">{i18nService.t('gsNewPassword')}</span>
            <GsPasswordInput value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">{i18nService.t('gsConfirmPassword')}</span>
            <GsPasswordInput value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
          </label>
          {error && <div className="text-sm text-red-500">{error}</div>}
          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-1 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {i18nService.t(submitting ? 'gsLoginSubmitting' : 'gsChangePasswordSubmit')}
          </button>
        </form>
      )}
    </Modal>
  );
};

export default GsChangePasswordDialog;
