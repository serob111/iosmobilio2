import type { HTMLAttributes } from "react";

export type PanelTone = "light" | "ink";

const TONE_CLASSES: Record<PanelTone, string> = {
  light: "bg-white text-ink",
  ink: "bg-ink text-white",
};

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  tone?: PanelTone;
}

/** A 28-32px-radius surface for grouped forms and raised sections — light for forms (Workspace), ink for the one-lime-button zones (Foundations, hero CTAs). */
export function Panel({ tone = "light", className = "", ...rest }: PanelProps) {
  return <div className={["rounded-panel", TONE_CLASSES[tone], className].join(" ")} {...rest} />;
}
