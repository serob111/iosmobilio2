import type { InputHTMLAttributes, ReactNode } from "react";

export interface ToggleRowProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
}

/** The checkbox row from Foundations: label left, 22x22 violet-accent checkbox right. */
export function ToggleRow({ label, className = "", ...rest }: ToggleRowProps) {
  return (
    <label className={["flex min-h-12 items-center justify-between gap-3 text-[15px] font-semibold", className].join(" ")}>
      {label}
      <input type="checkbox" className="h-[22px] w-[22px] accent-violet" {...rest} />
    </label>
  );
}
