import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { gsAuthService } from '../services/gsAuth';
import { i18nService } from '../services/i18n';
import { RootState } from '../store';
import { closeGsLoginDialog } from '../store/slices/gsAuthSlice';
import Modal from './common/Modal';
import GsPasswordInput from './GsPasswordInput';

/**
 * GS 企业账号密码登录框。由 gsAuth.loginDialogOpen 驱动，挂在 App 根部。
 */
const GsLoginDialog: React.FC = () => {
  const dispatch = useDispatch();
  const open = useSelector((state: RootState) => state.gsAuth.loginDialogOpen);
  const baseUrl = useSelector((state: RootState) => state.gsAuth.baseUrl);
  const baseUrlLocked = useSelector((state: RootState) => state.gsAuth.baseUrlLocked);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [serverError, setServerError] = useState('');

  if (!open) return null;

  const handleClose = () => {
    setError('');
    setPassword('');
    setSubmitting(false);
    setShowServerSettings(false);
    setServerError('');
    dispatch(closeGsLoginDialog());
  };

  const handleToggleServerSettings = () => {
    setServerError('');
    setServerUrlInput(baseUrl);
    setShowServerSettings((prev) => !prev);
  };

  const handleSaveServerUrl = async () => {
    setServerError('');
    const result = await window.electron.gsAuth.setServerUrl(serverUrlInput.trim());
    if (result.success) {
      setShowServerSettings(false);
    } else {
      setServerError(i18nService.t('gsServerInvalid'));
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting || !username.trim() || !password) return;
    setSubmitting(true);
    setError('');
    const result = await gsAuthService.login(username.trim(), password);
    setSubmitting(false);
    if (result.success) {
      setPassword('');
      dispatch(closeGsLoginDialog());
    } else {
      setError(result.message || i18nService.t('gsLoginFailed'));
    }
  };

  return (
    <Modal
      onClose={handleClose}
      overlayClassName="fixed inset-0 z-[10050] flex items-center justify-center modal-backdrop px-4"
      className="modal-content w-full max-w-sm rounded-2xl border border-border bg-surface p-5 shadow-modal"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="text-base font-semibold leading-6 text-foreground">
          {i18nService.t('gsLoginTitle')}
        </div>
        <button
          type="button"
          onClick={handleClose}
          className="-mr-1 -mt-1 rounded-lg p-1 text-secondary transition-colors hover:bg-surface-raised hover:text-foreground"
          aria-label={i18nService.t('close')}
        >
          <XMarkIcon className="h-5 w-5" />
        </button>
      </div>
      <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-secondary">{i18nService.t('gsLoginUsername')}</span>
          <input
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoFocus
            autoComplete="username"
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm text-secondary">{i18nService.t('gsLoginPassword')}</span>
          <GsPasswordInput value={password} onChange={setPassword} />
        </label>
        {error && <div className="text-sm text-red-500">{error}</div>}
        <button
          type="submit"
          disabled={submitting || !username.trim() || !password}
          className="mt-1 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {i18nService.t(submitting ? 'gsLoginSubmitting' : 'gsLoginSubmit')}
        </button>
      </form>
      <div className="mt-4 border-t border-border pt-3">
        <button
          type="button"
          onClick={handleToggleServerSettings}
          className="text-xs text-secondary transition-colors hover:text-foreground"
        >
          {i18nService.t('gsServerSettings')}
          <span className="ml-1.5 text-secondary/70">{baseUrl}</span>
        </button>
        {showServerSettings && (
          baseUrlLocked ? (
            <div className="mt-2 text-xs text-secondary">{i18nService.t('gsServerManaged')}</div>
          ) : (
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={serverUrlInput}
                  onChange={(event) => setServerUrlInput(event.target.value)}
                  placeholder="http://server:18300"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-foreground outline-none transition-colors focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => void handleSaveServerUrl()}
                  className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-surface-raised"
                >
                  {i18nService.t('gsServerSave')}
                </button>
              </div>
              <div className="text-[11px] text-secondary">{i18nService.t('gsServerHint')}</div>
              {serverError && <div className="text-xs text-red-500">{serverError}</div>}
            </div>
          )
        )}
      </div>
    </Modal>
  );
};

export default GsLoginDialog;
