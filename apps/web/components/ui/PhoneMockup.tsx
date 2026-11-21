import type { CSSProperties, ReactNode } from "react";

export interface PhoneMockupProps {
  width: number;
  height: number;
  screenBackground?: string;
  shadow?: string;
  float?: boolean;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * The iPhone frame used on the landing hero, the sign-in page, and the 404 illustration —
 * a gradient bezel around a black border, with the pill-shaped notch. Screen content is
 * supplied by the caller; this only draws the physical device.
 */
export function PhoneMockup({
  width,
  height,
  screenBackground = "#FFFFFF",
  shadow = "0 40px 90px rgba(10,5,40,0.5)",
  float = false,
  className = "",
  style,
  children,
}: PhoneMockupProps) {
  const pad = Math.max(3, Math.round(width * 0.016));
  const bezel = Math.max(6, Math.round(width * 0.028));
  const outerRadius = Math.round(width * 0.2);
  const innerRadius = outerRadius - bezel;

  return (
    <div
      aria-hidden="true"
      className={[float ? "animate-[mbFloat_6s_ease-in-out_infinite]" : "", className].join(" ")}
      style={{
        width,
        height,
        boxSizing: "border-box",
        padding: pad,
        borderRadius: outerRadius,
        background: "linear-gradient(150deg, #9A8AA8, #4B4056 40%, #7D6E8B)",
        boxShadow: shadow,
        transition: "box-shadow 0.5s ease",
        ...style,
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          boxSizing: "border-box",
          border: `${bezel}px solid #050505`,
          borderRadius: innerRadius,
          overflow: "hidden",
          background: screenBackground,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: Math.round(width * 0.033),
            left: "50%",
            transform: "translateX(-50%)",
            width: Math.round(width * 0.3),
            height: Math.round(width * 0.09),
            borderRadius: 20,
            background: "#050505",
          }}
        />
        {children}
      </div>
    </div>
  );
}
