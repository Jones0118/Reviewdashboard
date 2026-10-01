/** Selectable dashboard colour themes. */
export interface Theme {
  id: string;
  label: string;
  /** Primary (headers, tabs, KPI gradient start) */
  primary: string;
  /** Darker shade (gradient end, strong text) */
  dark: string;
  /** Lighter shade (links, focus borders) */
  light: string;
  /** Accent used for highlights / badges */
  accent: string;
  /** KPI number colour on the coloured cards */
  kpiNum: string;
  /** Scope card gradient */
  scopeFrom: string;
  scopeTo: string;
}

export const THEMES: Theme[] = [
  {
    id: 'govBlue', label: 'Government Blue',
    primary: '#1b3a7a', dark: '#142c5c', light: '#2b56b0',
    accent: '#ff7a00', kpiNum: '#ffd980', scopeFrom: '#b8860b', scopeTo: '#8a6209',
  },
  {
    id: 'emerald', label: 'Emerald Green',
    primary: '#146c43', dark: '#0b4f31', light: '#1f9d61',
    accent: '#f59e0b', kpiNum: '#d1fae5', scopeFrom: '#0f766e', scopeTo: '#0b5350',
  },
  {
    id: 'indigo', label: 'Royal Indigo',
    primary: '#3730a3', dark: '#282270', light: '#5b52d4',
    accent: '#f472b6', kpiNum: '#e0e7ff', scopeFrom: '#7c3aed', scopeTo: '#5b21b6',
  },
  {
    id: 'maroon', label: 'Deep Maroon',
    primary: '#7c1d3f', dark: '#5a132c', light: '#a83258',
    accent: '#f59e0b', kpiNum: '#ffd7e3', scopeFrom: '#9a3412', scopeTo: '#7c2d12',
  },
  {
    id: 'teal', label: 'Ocean Teal',
    primary: '#0f6d78', dark: '#0a4f57', light: '#17919f',
    accent: '#ff8a3d', kpiNum: '#ccfbf1', scopeFrom: '#0e7490', scopeTo: '#155e75',
  },
  {
    id: 'slate', label: 'Graphite',
    primary: '#334155', dark: '#1e293b', light: '#52657d',
    accent: '#38bdf8', kpiNum: '#e2e8f0', scopeFrom: '#475569', scopeTo: '#334155',
  },
  {
    id: 'tvk', label: 'TVK Red & Yellow',
    primary: '#C8102E', dark: '#8E0B20', light: '#E23B4F',
    accent: '#FFC72C', kpiNum: '#FFD966', scopeFrom: '#F2B300', scopeTo: '#C99000',
  },
];

export const THEME_STORAGE_KEY = 'emis-dashboard-theme';
