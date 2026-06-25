import rawConfig from './about.config.json';

export const AboutInfoItemAction = {
  Copy: 'copy',
  OpenExternal: 'openExternal',
  Text: 'text',
} as const;

export type AboutInfoItemAction =
  typeof AboutInfoItemAction[keyof typeof AboutInfoItemAction];

export interface AboutLocalizedText {
  zh: string;
  en: string;
}

export interface AboutInfoItem {
  id: string;
  label: AboutLocalizedText;
  value: string;
  action: AboutInfoItemAction;
}

export interface AboutFooterLink {
  id: string;
  label: AboutLocalizedText;
  url: string;
}

export interface AboutConfig {
  productName: string;
  showUpdateCheck: boolean;
  showExportLogs: boolean;
  infoItems: AboutInfoItem[];
  footerLinks: AboutFooterLink[];
}

const DEFAULTS: AboutConfig = {
  productName: 'LobsterAI',
  showUpdateCheck: true,
  showExportLogs: true,
  infoItems: [
    {
      id: 'contactEmail',
      label: { zh: '联系邮箱', en: 'Contact Email' },
      value: 'lobsterai.project@rd.netease.com',
      action: AboutInfoItemAction.Copy,
    },
    {
      id: 'userManual',
      label: { zh: '用户手册', en: 'User Manual' },
      value: 'https://lobsterai.youdao.com/#/docs/lobsterai_user_manual',
      action: AboutInfoItemAction.OpenExternal,
    },
  ],
  footerLinks: [
    {
      id: 'serviceTerms',
      label: { zh: '服务条款', en: 'Terms of Service' },
      url: 'https://c.youdao.com/dict/hardware/lobsterai/lobsterai_service.html',
    },
  ],
};

type RawLocalizedText = {
  zh?: unknown;
  en?: unknown;
};

type RawInfoItem = {
  id?: unknown;
  label?: RawLocalizedText;
  value?: unknown;
  action?: unknown;
};

type RawFooterLink = {
  id?: unknown;
  label?: RawLocalizedText;
  url?: unknown;
};

type RawAboutConfig = {
  productName?: unknown;
  showUpdateCheck?: unknown;
  showExportLogs?: unknown;
  infoItems?: unknown;
  footerLinks?: unknown;
};

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const localizedText = (
  raw: RawLocalizedText | undefined,
  fallback: AboutLocalizedText,
): AboutLocalizedText => ({
  zh: str(raw?.zh) ?? fallback.zh,
  en: str(raw?.en) ?? fallback.en,
});

const isInfoItemAction = (value: string): value is AboutInfoItemAction =>
  Object.values(AboutInfoItemAction).includes(value as AboutInfoItemAction);

const resolveInfoItems = (items: unknown): AboutInfoItem[] => {
  if (!Array.isArray(items)) return DEFAULTS.infoItems;

  const resolved = items
    .map((item, index): AboutInfoItem | null => {
      const raw = item as RawInfoItem;
      const value = str(raw.value);
      if (!value) return null;

      const fallback = DEFAULTS.infoItems[index] ?? DEFAULTS.infoItems[0];
      const action = str(raw.action);
      return {
        id: str(raw.id) ?? `aboutInfoItem${index}`,
        label: localizedText(raw.label, fallback.label),
        value,
        action: action && isInfoItemAction(action) ? action : AboutInfoItemAction.Text,
      };
    })
    .filter((item): item is AboutInfoItem => item !== null);

  return resolved.length > 0 ? resolved : DEFAULTS.infoItems;
};

const resolveFooterLinks = (links: unknown): AboutFooterLink[] => {
  if (!Array.isArray(links)) return DEFAULTS.footerLinks;

  return links
    .map((link, index): AboutFooterLink | null => {
      const raw = link as RawFooterLink;
      const url = str(raw.url);
      if (!url) return null;

      const fallback = DEFAULTS.footerLinks[index] ?? DEFAULTS.footerLinks[0];
      return {
        id: str(raw.id) ?? `aboutFooterLink${index}`,
        label: localizedText(raw.label, fallback.label),
        url,
      };
    })
    .filter((link): link is AboutFooterLink => link !== null);
};

function resolveAboutConfig(): AboutConfig {
  const config = (rawConfig ?? {}) as RawAboutConfig;
  return {
    productName: str(config.productName) ?? DEFAULTS.productName,
    showUpdateCheck: typeof config.showUpdateCheck === 'boolean'
      ? config.showUpdateCheck
      : DEFAULTS.showUpdateCheck,
    showExportLogs: typeof config.showExportLogs === 'boolean'
      ? config.showExportLogs
      : DEFAULTS.showExportLogs,
    infoItems: resolveInfoItems(config.infoItems),
    footerLinks: resolveFooterLinks(config.footerLinks),
  };
}

export const aboutConfig: AboutConfig = resolveAboutConfig();
