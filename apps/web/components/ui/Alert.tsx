import type { ReactNode } from "react";

export type AlertTone = "info" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<AlertTone, string> = {
  info: "bg-lilac text-info-fg",
  success: "bg-success-bg text-success-fg",
  warning: "bg-warning-bg text-warning-fg",
  danger: "bg-danger-bg text-danger-fg",
};

export interface AlertProps {
  tone: AlertTone;
  children: ReactNode;
}

/** The rounded message block from Foundations — `role="status"` for info/success (non-urgent), `role="alert"` for warning/danger (same pattern the .dc.html source's aria usage implies). */
export function Alert({ tone, children }: AlertProps) {
  const isUrgent = tone === "warning" || tone === "danger";
  return (
    <div
      role={isUrgent ? "alert" : "status"}
      className={["flex items-start gap-3 rounded-2xl px-[18px] py-4 text-[15px] leading-[1.45]", TONE_CLASSES[tone]].join(" ")}
    >
      <svg
        aria-hidden="true"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mt-px shrink-0"
      >
        <circle cx="12" cy="12" r="9" />
        <path d={isUrgent ? "M12 8v5" : "M12 11v5"} />
        <path d={isUrgent ? "M12 16.5v.5" : "M12 7.5v.5"} />
      </svg>
      <span>{children}</span>
    </div>
  );
}
