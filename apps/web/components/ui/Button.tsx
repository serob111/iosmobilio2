import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "lime" | "onDark";
export type ButtonSize = "md" | "sm";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-violet text-white hover:bg-violet-hover",
  secondary: "bg-white text-ink border-[1.5px] border-line hover:bg-mist-soft",
  ghost: "bg-transparent text-violet hover:text-violet-hover",
  danger: "bg-danger text-white hover:opacity-90",
  lime: "bg-lime text-ink hover:opacity-90",
  onDark: "bg-white text-ink hover:opacity-90",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "h-[52px] px-[26px] text-base",
  sm: "h-[44px] px-[20px] text-sm",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

/**
 * The pill button from Foundations — one lime variant per screen, and only on an ink
 * surface (the design rule, not something this component enforces).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className = "", children, type = "button", ...rest },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        "inline-flex items-center justify-center gap-2 rounded-pill font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-lilac focus-visible:border-violet",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        isDisabled ? "bg-disabled-bg text-disabled-fg border-0 cursor-not-allowed hover:bg-disabled-bg" : "cursor-pointer",
        className,
      ].join(" ")}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      ) : null}
      {children}
    </button>
  );
});
