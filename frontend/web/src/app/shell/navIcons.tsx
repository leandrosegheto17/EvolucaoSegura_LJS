import type { ReactNode } from 'react';

/** Ícones SVG inline locais do trilho (G-11); sempre decorativos (`aria-hidden`). */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className="size-5 min-[861px]:size-[22px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const HomeIcon = () => (
  <Svg>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h5v-6h4v6h5V10" />
  </Svg>
);
export const CalendarIcon = () => (
  <Svg>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </Svg>
);
export const PeopleIcon = () => (
  <Svg>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0113 0" />
    <circle cx="17" cy="9" r="2.5" />
    <path d="M17 14a5 5 0 014.5 5" />
  </Svg>
);
export const WalletIcon = () => (
  <Svg>
    <path d="M3 7a2 2 0 012-2h13v4" />
    <rect x="3" y="7" width="18" height="13" rx="2" />
    <circle cx="16.5" cy="13.5" r="1" />
  </Svg>
);
export const ShieldIcon = () => (
  <Svg>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);
export const GearIcon = () => (
  <Svg>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
  </Svg>
);
