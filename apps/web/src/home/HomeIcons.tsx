import type { ReactNode } from 'react';

export type HomeIconName =
  | 'game'
  | 'projects'
  | 'members'
  | 'arrow'
  | 'back'
  | 'sound'
  | 'muted'
  | 'sparkle'
  | 'leaf';

export default function HomeIcon({ name, className }: { name: HomeIconName; className?: string }) {
  const paths: Record<HomeIconName, ReactNode> = {
    game: (
      <>
        <path d="M7 7h10c2 0 3 2 3.5 4l1 6c.5 3-2 4-4 2l-3-3h-5l-3 3c-2 2-4.5 1-4-2l1-6C4 9 5 7 7 7Z" />
        <path d="M7 10v5m-2.5-2.5h5" />
        <circle cx="16" cy="11" r=".7" />
        <circle cx="18" cy="14" r=".7" />
      </>
    ),
    projects: (
      <>
        <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
        <path d="M3 9h18m-9 4v5m-2.5-2.5h5" />
      </>
    ),
    members: (
      <>
        <circle cx="12" cy="7" r="3" />
        <path d="M6 21v-3a6 6 0 0 1 12 0v3M4 4a3 3 0 0 1 0 6m16-6a3 3 0 0 0 0 6M2 20v-3a5 5 0 0 1 3-4m17 7v-3a5 5 0 0 0-3-4" />
      </>
    ),
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    sound: <path d="m11 4-6 5H2v6h3l6 5Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />,
    muted: <path d="m11 4-6 5H2v6h3l6 5Zm5 5 6 6m0-6-6 6" />,
    sparkle: (
      <>
        <path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z" />
        <path d="M20 2v4m-2-2h4" />
      </>
    ),
    leaf: (
      <>
        <path d="M20 3C9 1 2 7 5 15s17 4 15-12Z" />
        <path d="M3 22 16 9m-8 8-1-6m5 2 5 1" />
      </>
    ),
  };
  return (
    <svg
      className={className}
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
