/**
 * Button atom - the three canonical button treatments in svemir.
 *
 *   primary   - filled light, for the main commit action (Save, Sign in)
 *   secondary - outlined, for secondary actions (Connect, Actions, Cancel, Add)
 *   icon      - square icon-only button (close ×, "⋯" trigger)
 *
 * Thin pass-through over <button>; colours use `neutral-*` tokens so it
 * retheme automatically. Existing call sites still use inline classes and can
 * migrate to this incrementally.
 */

type Variant = "primary" | "secondary" | "icon";

const VARIANTS: Record<Variant, string> = {
  primary:
    "rounded-xl bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 transition-colors hover:bg-white disabled:opacity-60",
  secondary:
    "rounded-xl border border-neutral-700 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:bg-neutral-900 disabled:opacity-50",
  icon: "flex h-7 w-7 items-center justify-center rounded-xl text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100",
};

export default function Button({
  variant = "secondary",
  className = "",
  type = "button",
  children,
  ...rest
}: {
  variant?: Variant;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`${VARIANTS[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
