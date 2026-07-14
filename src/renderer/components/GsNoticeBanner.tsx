import { XMarkIcon } from '@heroicons/react/24/outline';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';

import { i18nService } from '../services/i18n';
import type { RootState } from '../store';
import type { GsNoticeConfig } from '../store/slices/gsAuthSlice';

/** 用户手动关闭过的公告内容存这里；内容变了视为新公告重新展示 */
const DISMISSED_STORAGE_KEY = 'gs_notice_dismissed_text';

/** 起止时间边界重算的轮询间隔 */
const TIME_WINDOW_CHECK_MS = 30 * 1000;

/** 公告是否在展示时间窗内（startAt/endAt 缺省 = 不限） */
const isWithinWindow = (notice: GsNoticeConfig, now: number): boolean => {
  if (notice.startAt) {
    const start = Date.parse(notice.startAt);
    if (!Number.isNaN(start) && now < start) return false;
  }
  if (notice.endAt) {
    const end = Date.parse(notice.endAt);
    if (!Number.isNaN(end) && now >= end) return false;
  }
  return true;
};

/**
 * 服务端下发的通知公告：底部滚动横幅。
 * 数据随 gsAuth 配置刷新（登录/聚焦/约 5 分钟定时）自动更新；
 * dismissible 时用户可关闭，按内容记忆，服务端改了内容会重新展示。
 */
const GsNoticeBanner: React.FC = () => {
  const { enabled, isLoggedIn, config } = useSelector((state: RootState) => state.gsAuth);
  const notice = enabled && isLoggedIn ? config?.notice : null;

  const [dismissedText, setDismissedText] = useState<string>(
    () => localStorage.getItem(DISMISSED_STORAGE_KEY) ?? '',
  );
  // 只用来触发时间窗重算的时钟
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!notice?.startAt && !notice?.endAt) return;
    const timer = setInterval(() => setNow(Date.now()), TIME_WINDOW_CHECK_MS);
    return () => clearInterval(timer);
  }, [notice?.startAt, notice?.endAt]);

  if (!notice?.text) return null;
  if (!isWithinWindow(notice, now)) return null;

  const dismissible = notice.dismissible !== false;
  if (dismissible && dismissedText === notice.text) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_STORAGE_KEY, notice.text);
    setDismissedText(notice.text);
  };

  // 滚动时长随文本长度缩放，保证长短公告的滚动速度观感一致
  const durationSeconds = Math.max(15, Math.round(notice.text.length * 0.45));

  return (
    <div className="flex items-center gap-2 h-8 px-3 shrink-0 border-t border-border bg-surface-raised text-[13px] text-foreground/90">
      <span className="shrink-0" aria-hidden="true">📢</span>
      <div className="flex-1 min-w-0 overflow-hidden">
        <span
          className="gs-notice-marquee"
          style={{ animationDuration: `${durationSeconds}s` }}
        >
          {notice.text}
        </span>
      </div>
      {dismissible && (
        <button
          onClick={dismiss}
          className="shrink-0 p-0.5 rounded text-secondary hover:text-foreground hover:bg-black/[0.05] dark:hover:bg-white/[0.06] transition-colors cursor-pointer"
          title={i18nService.t('close')}
          aria-label={i18nService.t('close')}
        >
          <XMarkIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
};

export default GsNoticeBanner;
