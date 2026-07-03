/**
 * TextInput atom - the two canonical input treatments in svemir.
 *
 *   default - form-scale input (admin form, sign-in): bg-neutral-900, ring-2
 *   small   - compact picker/inline input: bg-neutral-950, tighter, ring-1
 *
 * Existing call sites still use inline classes and can migrate incrementally.
 */

type Size = "default" | "small";

const SIZES: Record<Size, string> = {
  default:
    "w-full rounded-xl border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-500",
  small:
    "w-full rounded-xl border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs text-neutral-100 placeholder:text-neutral-500 focus:outline-none focus:ring-1 focus:ring-neutral-500",
};

export default function TextInput({
  size = "default",
  className = "",
  ...rest
}: {
  size?: Size;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">) {
  return <input className={`${SIZES[size]} ${className}`} {...rest} />;
}
