import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className = "", ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={[
        "h-12 rounded-field border-[1.5px] border-line bg-white px-3.5 text-base text-ink outline-none transition-colors",
        "placeholder:text-slate/70",
        "focus:border-2 focus:border-violet focus:ring-4 focus:ring-lilac",
        "aria-invalid:border-2 aria-invalid:border-danger aria-invalid:ring-0",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className,
      ].join(" ")}
      {...rest}
    />
  );
});
