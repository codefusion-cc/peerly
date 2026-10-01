/** A loading indicator with its label for screen readers. */
export function Spinner({ label, className = '' }: { label: string; className?: string }) {
  return <span role="status" aria-label={label} className={`loading loading-spinner ${className}`} />
}
