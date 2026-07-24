import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { gsAuthService, resolveGsErrorText } from '../services/gsAuth';
import { i18nService } from '../services/i18n';
import { RootState } from '../store';
import { closeGsLoginDialog } from '../store/slices/gsAuthSlice';
import Modal from './common/Modal';
import GsPasswordInput from './GsPasswordInput';

interface LoginMethods {
  password: boolean;
  wecom: boolean;
  email: boolean;
}

// 探测失败/老服务端的兜底：只留密码登录，与从前行为一致
const FALLBACK_METHODS: LoginMethods = { password: true, wecom: false, email: false };

/**
 * GS 企业登录框。由 gsAuth.loginDialogOpen 驱动，挂在 App 根部。
 * 打开时向服务端探测可用登录方式（管理后台「登录管理」页配置）：
 * 密码/邮箱验证码以 Tab 呈现（只开一种则不显示 Tab），企微扫码是下方独立按钮。
 */
const GsLoginDialog: React.FC = () => {
  const dispatch = useDispatch();
  const open = useSelector((state: RootState) => state.gsAuth.loginDialogOpen);
  const baseUrl = useSelector((state: RootState) => state.gsAuth.baseUrl);
  const baseUrlLocked = useSelector((state: RootState) => state.gsAuth.baseUrlLocked);
  const [methods, setMethods] = useState<LoginMethods>(FALLBACK_METHODS);
  const [tab, setTab] = useState<'password' | 'email'>('password');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [resendLeft, setResendLeft] = useState(0);
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [serverUrlInput, setServerUrlInput] = useState('');
  const [serverError, setServerError] = useState('');
  const [wecomWaiting, setWecomWaiting] = useState(false);

  // 打开登录框时探测服务端开放的登录方式；密码被停用时默认切到验证码 Tab
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    window.electron.gsAuth
      .getLoginMethods()
      .then((result) => {
        if (cancelled) return;
        setMethods(result);
        setTab(result.password || !result.email ? 'password' : 'email');
      })
      .catch(() => { if (!cancelled) setMethods(FALLBACK_METHODS); });
    return () => { cancelled = true; };
  }, [open, baseUrl]);

  // 验证码重发倒计时
  useEffect(() => {
    if (resendLeft <= 0) return;
    const timer = setTimeout(() => setResendLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendLeft]);

  if (!open) return null;

  const handleClose = () => {
    setError('');
    setPassword('');
    setCode('');
    setSentTo('');
    setResendLeft(0);
    setSubmitting(false);
    setShowServerSettings(false);
    setServerError('');
    dispatch(closeGsLoginDialog());
  };

  // 用户可能输入 OA 账户或完整邮箱（xx@gszq.com）；统一取 @ 前的账户名
  const normalizeAccount = (value: string): string => {
    const at = value.indexOf('@');
    return at >= 0 ? value.slice(0, at) : value;
  };

  const handleWecomLogin = async () => {
    if (wecomWaiting || submitting) return;
    setWecomWaiting(true);
    setError('');
    const result = await window.electron.gsAuth.wecomLogin();
    setWecomWaiting(false);
    if (result.success) {
      handleClose();
    } else if (result.message !== 'CANCELLED') {
      // 用户主动关掉扫码窗不算错误
      setError(resolveGsErrorText(result.message, 'gsWecomLoginFailed'));
    }
  };

  const handleSendCode = async () => {
    if (sendingCode || resendLeft > 0 || !username.trim()) return;
    setSendingCode(true);
    setError('');
    const result = await window.electron.gsAuth.emailSendCode(username.trim());
    setSendingCode(false);
    if (result.success) {
      setSentTo(result.maskedEmail || '');
      setResendLeft(Math.max(1, Math.round((result.resendIn ?? 60000) / 1000)));
    } else {
      setError(resolveGsErrorText(result.message, 'gsEmailSendFailed'));
    }
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
    if (submitting || !username.trim()) return;
    if (tab === 'password' ? !password : !code.trim()) return;
    setSubmitting(true);
    setError('');
    const result =
      tab === 'password'
        ? await gsAuthService.login(username.trim(), password)
        : await window.electron.gsAuth.emailLogin(username.trim(), code.trim());
    setSubmitting(false);
    if (result.success) {
      handleClose();
    } else {
      setError(resolveGsErrorText(result.message, tab === 'password' ? 'gsLoginFailed' : 'gsEmailLoginFailed'));
    }
  };

  const showTabs = methods.password && methods.email;
  const showForm = methods.password || methods.email;
  const activeTab = methods.password && !methods.email ? 'password' : !methods.password && methods.email ? 'email' : tab;
  const canSubmit = username.trim() && (activeTab === 'password' ? password : code.trim());

  const switchTab = (next: 'password' | 'email') => {
    if (next === tab) return;
    setTab(next);
    setError('');
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
      {showTabs && (
        <div className="mt-4 flex rounded-lg border border-border p-0.5">
          {(['password', 'email'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => switchTab(key)}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === key ? 'bg-surface-raised text-foreground' : 'text-secondary hover:text-foreground'
              }`}
            >
              {i18nService.t(key === 'password' ? 'gsLoginTabPassword' : 'gsLoginTabEmail')}
            </button>
          ))}
        </div>
      )}
      {showForm && (
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-secondary">{i18nService.t('gsLoginUsername')}</span>
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(normalizeAccount(event.target.value))}
              autoFocus
              autoComplete="username"
              placeholder={i18nService.t('gsAccountPlaceholder')}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
            />
          </label>
          {activeTab === 'password' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-secondary">{i18nService.t('gsLoginPassword')}</span>
              <GsPasswordInput value={password} onChange={setPassword} />
            </label>
          ) : (
            <label className="flex flex-col gap-1.5">
              <span className="text-sm text-secondary">{i18nService.t('gsEmailCode')}</span>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => void handleSendCode()}
                  disabled={sendingCode || resendLeft > 0 || !username.trim()}
                  className="shrink-0 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resendLeft > 0
                    ? `${i18nService.t('gsEmailSendCode')} (${resendLeft}s)`
                    : i18nService.t(sendingCode ? 'gsEmailSending' : 'gsEmailSendCode')}
                </button>
              </div>
              {sentTo && (
                <span className="text-xs text-secondary">
                  {i18nService.t('gsEmailCodeSentPrefix')}
                  {sentTo}
                </span>
              )}
            </label>
          )}
          {error && <div className="text-sm text-red-500">{error}</div>}
          <button
            type="submit"
            disabled={submitting || !canSubmit}
            className="mt-1 w-full rounded-lg bg-primary px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {i18nService.t(submitting ? 'gsLoginSubmitting' : 'gsLoginSubmit')}
          </button>
        </form>
      )}
      {!showForm && error && <div className="mt-4 text-sm text-red-500">{error}</div>}
      {methods.wecom && (
        <button
          type="button"
          onClick={() => void handleWecomLogin()}
          disabled={wecomWaiting || submitting}
          className="mt-3 w-full rounded-lg border border-border px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60"
        >
          {i18nService.t(wecomWaiting ? 'gsWecomLoginWaiting' : 'gsWecomLogin')}
        </button>
      )}
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
