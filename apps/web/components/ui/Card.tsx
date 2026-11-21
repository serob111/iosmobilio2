import type { HTMLAttributes } from "react";

/** A 24px-radius white surface — the base unit for app cards (status cards, project tiles, foundations swatches). */
export function Card({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={["rounded-card bg-white", className].join(" ")} {...rest} />;
}
