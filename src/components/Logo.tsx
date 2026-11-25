export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="14" fill="var(--accent)" />
      <path
        d="M18 40c0-10 8-16 18-16h10M46 24c0 10-8 16-18 16H18"
        stroke="var(--ink)"
        strokeWidth="6.5"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  )
}
