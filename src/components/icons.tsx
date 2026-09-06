/**
 * Inline SVG rather than glyphs like ⛶.
 *
 * Symbols outside the common ranges fall back to whatever the platform has, and
 * on a phone that is regularly a tofu box — which is what this one rendered as.
 */
export function ExpandIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ?? 'h-4 w-4'}
    >
      <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
    </svg>
  )
}
