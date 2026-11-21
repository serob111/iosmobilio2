import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className = "", children, ...rest },
  ref,
) {
  return (
    <select
      ref={ref}
      className={[
        "h-12 rounded-field border-[1.5px] border-line bg-white px-3 text-base text-ink outline-none transition-colors",
        "focus:border-2 focus:border-violet focus:ring-4 focus:ring-lilac",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      ].join(" ")}
      {...rest}
    >
      {children}
    </select>
  );
});
