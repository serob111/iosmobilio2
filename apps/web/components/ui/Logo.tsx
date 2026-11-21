import type { HTMLAttributes } from "react";

export interface LogoProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "ink" | "white";
}

/** The "mobilio" wordmark — Unbounded 800, used standalone or inside PublicHeader/AppHeader. */
export function Logo({ tone = "ink", className = "", ...rest }: LogoProps) {
  return (
    <span
      className={[
        "font-[family-name:var(--font-unbounded)] text-xl font-extrabold tracking-[-0.02em]",
        tone === "white" ? "text-white" : "text-ink",
        className,
      ].join(" ")}
      {...rest}
    >
      mobilio
    </span>
  );
}
