import { EyeIcon, EyeSlashIcon } from '@heroicons/react/24/outline';
import React, { useState } from 'react';

import { i18nService } from '../services/i18n';

interface GsPasswordInputProps {
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  autoComplete?: string;
}

/** 密码输入框，右侧眼睛图标切换明文/密文显示 */
const GsPasswordInput: React.FC<GsPasswordInputProps> = ({
  value,
  onChange,
  autoFocus = false,
  autoComplete = 'current-password',
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
        className="w-full rounded-lg border border-border bg-surface py-2 pl-3 pr-9 text-sm text-foreground outline-none transition-colors focus:border-primary"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((prev) => !prev)}
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-secondary transition-colors hover:text-foreground"
        aria-label={i18nService.t(visible ? 'gsPasswordHide' : 'gsPasswordShow')}
      >
        {visible ? <EyeSlashIcon className="h-4 w-4" /> : <EyeIcon className="h-4 w-4" />}
      </button>
    </div>
  );
};

export default GsPasswordInput;
