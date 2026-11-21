import { Children, cloneElement, isValidElement, useId } from "react";
import type { ReactElement } from "react";

export interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  htmlFor?: string;
}

/**
 * Wires label/hint/error together with the right ids — matches Foundations' field
 * pattern: 13px label, 1.5px line border, 2px violet + lilac ring on focus, red border
 * and aria-invalid/aria-describedby on error.
 */
export function Field({ label, hint, error, children }: FieldProps) {
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;

  const child = Children.only(children);
  const control = isValidElement(child)
    ? cloneElement(child, {
        id: child.props.id ?? inputId,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
      })
    : child;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={isValidElement(child) ? (child.props.id ?? inputId) : inputId} className="text-[13px] font-semibold text-slate">
        {label}
      </label>
      {control}
      {hint ? (
        <span id={hintId} className="text-[13px] text-slate">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} role="alert" className="text-[13px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
