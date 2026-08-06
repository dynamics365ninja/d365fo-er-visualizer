export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 64"
      className={className}
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="logo-bg" x1="6" y1="5" x2="57" y2="58" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#0e3233" />
          <stop offset="0.58" stopColor="#0a6f73" />
          <stop offset="1" stopColor="#37a987" />
        </linearGradient>
        <linearGradient id="logo-paper" x1="18" y1="14" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#f0fffb" />
          <stop offset="1" stopColor="#a7ebd7" />
        </linearGradient>
      </defs>
      <rect x="4" y="4" width="56" height="56" rx="16" fill="url(#logo-bg)" />
      <path
        d="M23 14h15l8 8v23a4 4 0 0 1-4 4H23a4 4 0 0 1-4-4V18a4 4 0 0 1 4-4Z"
        fill="url(#logo-paper)"
      />
      <path
        d="M38 14v8h8"
        fill="none"
        stroke="#0a6f73"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M28 26h8m-8 6h6" fill="none" stroke="#0a6f73" strokeWidth="2.4" strokeLinecap="round" />
      <path
        d="M28 37.5h8.5l6.5-6.5"
        fill="none"
        stroke="#0f3d3e"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M28 37.5l6 6.5h9"
        fill="none"
        stroke="#0f3d3e"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="25" cy="37.5" r="4.5" fill="#0f3d3e" />
      <circle cx="45" cy="29" r="4" fill="#37a987" stroke="#defdf5" strokeWidth="2" />
      <circle cx="45" cy="44" r="4" fill="#37a987" stroke="#defdf5" strokeWidth="2" />
      <circle cx="25" cy="37.5" r="1.7" fill="#defdf5" />
    </svg>
  );
}
