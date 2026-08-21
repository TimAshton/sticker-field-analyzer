// Single-color line icons for the nav bar - stroke uses currentColor so
// each one just inherits nav a's black text color against its own LCARS
// pill background (see index.css), no separate icon-color styling needed.
const iconProps = {
  viewBox: '0 0 24 24',
  width: 22,
  height: 22,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function UploadIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M12 16V4M12 4l-5 5M12 4l5 5" />
      <path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}

export function BookIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2Z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7Z" />
    </svg>
  )
}

export function PlusIcon() {
  return (
    <svg {...iconProps} strokeWidth={2.5} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function FolderIcon() {
  return (
    <svg {...iconProps} aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  )
}
