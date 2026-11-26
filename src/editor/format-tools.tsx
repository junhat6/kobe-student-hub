import type { MarkdownTool } from './markdown-format';

/** Toolbar of the body field (C25 acceptance 2): icon buttons whose names live in aria-label. */
const svg = (path: React.ReactNode) => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
);

export const FORMAT_TOOLS: { tool: MarkdownTool; label: string; icon: React.ReactNode }[] = [
  { tool: 'heading', label: '見出し', icon: svg(<path d="M6 4v16M18 4v16M6 12h12" />) },
  {
    tool: 'bold',
    label: '太字',
    icon: svg(<path d="M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z" />),
  },
  { tool: 'code', label: 'コード', icon: svg(<path d="m8 7-5 5 5 5M16 7l5 5-5 5" />) },
  {
    tool: 'link',
    label: 'リンク',
    icon: svg(
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />,
    ),
  },
  {
    tool: 'list',
    label: '箇条書き',
    icon: svg(<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" />),
  },
];
