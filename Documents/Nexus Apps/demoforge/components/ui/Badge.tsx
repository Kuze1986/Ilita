type Tone = "default" | "success" | "warning" | "muted";

const tones: Record<Tone, string> = {
  default: "bg-[rgba(44,247,223,0.14)] text-[color:var(--accent)] border border-[rgba(44,247,223,0.35)]",
  success: "bg-[rgba(137,255,140,0.15)] text-[color:var(--accent-2)] border border-[rgba(137,255,140,0.35)]",
  warning: "bg-[rgba(255,198,74,0.15)] text-[#ffd776] border border-[rgba(255,198,74,0.35)]",
  muted: "bg-[rgba(255,255,255,0.06)] text-[color:var(--muted)] border border-[rgba(255,255,255,0.14)]",
};

export function Badge({
  tone = "default",
  children,
  className = "",
}: {
  tone?: Tone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
