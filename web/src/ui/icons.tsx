// Pictograms drawn like road-sign symbols: simple, solid, readable at a glance.
import type { JSX } from 'preact';

type P = { size?: number; class?: string };
const svg = (size: number, cls: string | undefined, children: JSX.Element | JSX.Element[], viewBox = '0 0 24 24') => (
  <svg class={cls} width={size} height={size} viewBox={viewBox} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{children}</svg>
);

/** The mark: three arrows going round, as on a roundabout sign. Spins while the app is thinking. */
export function Ring({ size = 28, spin = false, class: cls }: P & { spin?: boolean }) {
  const arrow = (rot: number) => (
    <g transform={`rotate(${rot} 16 16)`}>
      <path d="M16 4.5 A11.5 11.5 0 0 1 25.4 9.4" stroke="currentColor" stroke-width="3.4" fill="none" stroke-linecap="butt" />
      <path d="M27.6 5.6 L26.9 12.6 L20.6 9.6 Z" fill="currentColor" stroke="none" />
    </g>
  );
  return (
    <svg class={`ring ${spin ? 'ring-spin' : ''} ${cls ?? ''}`} width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      {arrow(0)}{arrow(120)}{arrow(240)}
    </svg>
  );
}

export const IconDescribe = ({ size = 28, class: c }: P) => svg(size, c, [<path d="M4 6h16M4 12h16M4 18h9" />]);
export const IconHints = ({ size = 28, class: c }: P) => svg(size, c, [<rect x="3" y="4" width="8" height="6" rx="2" />, <rect x="13" y="4" width="8" height="6" rx="2" />, <rect x="3" y="14" width="8" height="6" rx="2" />, <rect x="13" y="14" width="8" height="6" rx="2" />]);
export const IconDraw = ({ size = 28, class: c }: P) => svg(size, c, [<path d="M3 17c3-6 5 4 8-2s4-8 7-3" />, <path d="M17 21l4-1-1-4" />]);
export const IconPhoto = ({ size = 28, class: c }: P) => svg(size, c, [<path d="M4 8h3l2-3h6l2 3h3v11H4z" />, <circle cx="12" cy="13" r="3.5" />]);
export const IconSpeak = ({ size = 24, class: c }: P) => svg(size, c, [<path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor" stroke="none" />, <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />]);
export const IconDevice = ({ size = 18, class: c }: P) => svg(size, c, [<rect x="4" y="5" width="16" height="11" rx="1.5" />, <path d="M2 19h20" />]);
export const IconCloud = ({ size = 18, class: c }: P) => svg(size, c, [<path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 10.5a3.8 3.8 0 0 1-.5 7.5z" />]);
export const IconStar = ({ size = 18, class: c }: P) => svg(size, c, [<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9L3.5 9.7l5.9-.8z" />]);
export const IconFind = ({ size = 26, class: c }: P) => svg(size, c, [<circle cx="10.5" cy="10.5" r="6.5" />, <path d="M15.5 15.5L21 21" />]);
export const IconSay = ({ size = 26, class: c }: P) => svg(size, c, [<path d="M4 5h16v11H10l-5 4v-4H4z" />]);
export const IconWords = ({ size = 26, class: c }: P) => svg(size, c, [<path d="M6 3h12v18l-6-4-6 4z" />]);
export const IconGear = ({ size = 24, class: c }: P) => svg(size, c, [<circle cx="12" cy="12" r="3.2" />, <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />]);
export const IconClose = ({ size = 24, class: c }: P) => svg(size, c, [<path d="M6 6l12 12M18 6L6 18" />]);
export const IconUndo = ({ size = 22, class: c }: P) => svg(size, c, [<path d="M8 7L4 11l4 4" />, <path d="M4 11h10a5 5 0 0 1 0 10h-3" />]);
export const IconPlus = ({ size = 22, class: c }: P) => svg(size, c, [<path d="M12 5v14M5 12h14" />]);
