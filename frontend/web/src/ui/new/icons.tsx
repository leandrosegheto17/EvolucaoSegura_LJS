import type { ReactNode } from 'react';

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
      {children}
    </svg>
  );
}
export const PlusIcon = () => <Svg><path d="M12 5v14M5 12h14" /></Svg>;
export const ClockIcon = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></Svg>;
export const LockIcon = () => <Svg><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></Svg>;
export const AlertIcon = () => <Svg><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></Svg>;
export const PencilIcon = () => <Svg><path d="M4 20l4-1 11-11-3-3L5 16z" /></Svg>;
export const NotesIcon = () => <Svg><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></Svg>;
export const FileTextIcon = () => <Svg><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></Svg>;
export const HistoryIcon = () => <Svg><path d="M3 12a9 9 0 109-9 9 9 0 00-6.4 2.6L3 8" /><path d="M3 3v5h5M12 7v5l3 2" /></Svg>;
export const DownloadIcon = () => <Svg><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></Svg>;
export const CoinIcon = () => <Svg><circle cx="12" cy="12" r="9" /><path d="M14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.4 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6v2M12 16v2" /></Svg>;
