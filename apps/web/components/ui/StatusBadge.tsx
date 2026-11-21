export type Status = "draft" | "building" | "ready" | "review" | "live" | "failed";

const STATUS_CLASSES: Record<Status, { pill: string; dot: string }> = {
  draft: { pill: "bg-neutral-bg text-slate", dot: "bg-neutral" },
  building: { pill: "bg-lilac text-building-fg", dot: "bg-violet" },
  ready: { pill: "bg-success-bg text-success-fg", dot: "bg-success" },
  review: { pill: "bg-warning-bg text-warning-fg", dot: "bg-warning" },
  live: { pill: "bg-ink text-lime", dot: "bg-lime" },
  failed: { pill: "bg-danger-bg text-danger-fg", dot: "bg-danger" },
};

export interface StatusBadgeProps {
  status: Status;
  children: string;
}

/** The six status pills from Foundations — color is derived from `status`, text is caller-supplied (real copy, not hardcoded per status). */
export function StatusBadge({ status, children }: StatusBadgeProps) {
  const classes = STATUS_CLASSES[status];
  return (
    <span className={["inline-flex h-[30px] items-center gap-1.5 rounded-pill px-3 text-[13px] font-semibold", classes.pill].join(" ")}>
      <span aria-hidden="true" className={["h-2 w-2 rounded-full", classes.dot].join(" ")} />
      {children}
    </span>
  );
}
