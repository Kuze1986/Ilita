import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost";

const variants: Record<Variant, string> = {
  primary:
    "bg-[color:var(--accent)] text-[#031218] hover:brightness-110 disabled:opacity-50 shadow-[0_0_24px_rgba(44,247,223,0.35)]",
  secondary:
    "border border-[color:var(--panel-border)] bg-[color:var(--panel)] text-foreground hover:bg-[rgba(44,247,223,0.12)]",
  ghost: "text-foreground hover:bg-[rgba(255,255,255,0.08)]",
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--accent)] ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
