export function LoadingSpinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-8 w-8 animate-spin rounded-full border-2 border-[rgba(255,255,255,0.25)] border-t-[color:var(--accent)] ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
