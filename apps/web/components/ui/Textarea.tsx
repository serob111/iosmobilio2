import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className = "", ...rest },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={[
        "min-h-24 rounded-field-lg border-[1.5px] border-line bg-white px-3.5 py-3 text-base text-ink outline-none transition-colors",
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
