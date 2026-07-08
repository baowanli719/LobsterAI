import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { gsAuthService } from '../services/gsAuth';
import { i18nService } from '../services/i18n';
import { RootState } from '../store';
import { openGsLoginDialog } from '../store/slices/gsAuthSlice';
import GsChangePasswordDialog from './GsChangePasswordDialog';
import UserAvatarIcon from './icons/UserAvatarIcon';

/**
 * GS 企业登录入口（侧边栏底部）。仅在配置了 GS 服务端时由 Sidebar 渲染。
 * 未登录显示"登录"，已登录显示用户名，点开可退出。
 */
const GsLoginButton: React.FC = () => {
  const dispatch = useDispatch();
  const { isLoggedIn, user, online } = useSelector((state: RootState) => state.gsAuth);
  const [showMenu, setShowMenu] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  const handleClick = () => {
    if (isLoggedIn) {
      setShowMenu(!showMenu);
      return;
    }
    dispatch(openGsLoginDialog());
  };

  const handleLogout = async () => {
    setShowMenu(false);
    await gsAuthService.logout();
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex h-7 items-center justify-start gap-2 rounded-md px-1.5 text-[14px] font-normal text-foreground/80 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] cursor-pointer"
      >
        <UserAvatarIcon className="h-4 w-4 shrink-0" />
        {isLoggedIn ? (
          <span className="truncate max-w-[96px]">{user?.displayName || user?.username}</span>
        ) : (
          i18nService.t('gsLoginButton')
        )}
        {isLoggedIn && !online && (
          <span className="shrink-0 rounded bg-amber-100 px-1 text-[10px] font-medium text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
            {i18nService.t('gsOfflineBadge')}
          </span>
        )}
      </button>
      {showMenu && isLoggedIn && (
        <div className="absolute bottom-full left-[-0.5rem] mb-1 w-48 bg-surface rounded-xl shadow-popover border border-border overflow-hidden z-50 popover-enter">
          <div className="px-4 py-3 border-b border-border">
            <div className="text-sm font-medium text-foreground truncate">
              {user?.displayName || user?.username}
            </div>
            {user?.username && user.displayName !== user.username && (
              <div className="text-xs text-secondary mt-0.5 truncate">{user.username}</div>
            )}
          </div>
          <div className="py-1">
            <button
              type="button"
              onClick={() => { setShowMenu(false); setShowChangePassword(true); }}
              className="w-full px-4 py-2 text-left text-sm text-foreground hover:bg-surface-raised transition-colors cursor-pointer"
            >
              {i18nService.t('gsChangePassword')}
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="w-full px-4 py-2 text-left text-sm text-red-500 hover:bg-surface-raised transition-colors cursor-pointer"
            >
              {i18nService.t('gsLogout')}
            </button>
          </div>
        </div>
      )}
      {showChangePassword && (
        <GsChangePasswordDialog onClose={() => setShowChangePassword(false)} />
      )}
    </div>
  );
};

export default GsLoginButton;
