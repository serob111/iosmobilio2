// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { PhoneMockup } from "./PhoneMockup";

describe("PhoneMockup", () => {
  it("renders its screen content and stays out of the accessibility tree", () => {
    const { container } = render(
      <PhoneMockup width={270} height={556}>
        <span>Casa Roma</span>
      </PhoneMockup>,
    );
    expect(screen.getByText("Casa Roma")).toBeVisible();
    expect(container.firstChild).toHaveAttribute("aria-hidden", "true");
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(
      <PhoneMockup width={270} height={556} float>
        <span>Casa Roma</span>
      </PhoneMockup>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
