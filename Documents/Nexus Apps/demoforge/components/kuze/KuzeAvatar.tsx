export function KuzeAvatar({ size = 48 }: { size?: number }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-600 to-indigo-700 font-semibold text-white shadow-md"
      style={{ width: size, height: size, fontSize: size * 0.35 }}
      aria-hidden
    >
      K
    </div>
  );
}
