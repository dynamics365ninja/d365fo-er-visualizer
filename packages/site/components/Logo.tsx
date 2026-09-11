/**
 * The letters of `public/favicon.svg` — keep the two in step. The gradient reads
 * the theme's configuration hues, so the mark follows the theme switch and sits
 * on any background without a tile.
 */
export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      viewBox="10 9 46 46"
      className={className}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="logo-er" x1="13" y1="26" x2="53" y2="38" gradientUnits="userSpaceOnUse">
          <stop offset="0" style={{ stopColor: 'var(--er-model)' }} />
          <stop offset="0.55" style={{ stopColor: 'var(--er-mapping)' }} />
          <stop offset="1" style={{ stopColor: 'var(--er-format)' }} />
        </linearGradient>
      </defs>
      <g
        fill="none"
        stroke="url(#logo-er)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M28 19H16v26h12M16 32h10" />
        <path d="M36 45V19h7a7 7 0 0 1 0 14h-7m6 0 7 12" />
      </g>
    </svg>
  );
}
