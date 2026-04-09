export function LoadingSpinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={`h-8 w-8 animate-spin rounded-full border-2 border-zinc-300 border-t-foreground dark:border-zinc-600 ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}
