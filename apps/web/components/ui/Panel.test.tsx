// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Panel } from "./Panel";

describe("Panel", () => {
  it("renders light and ink tones", () => {
    render(
      <>
        <Panel>Light panel</Panel>
        <Panel tone="ink">Dark panel</Panel>
      </>,
    );
    expect(screen.getByText("Light panel")).toBeVisible();
    expect(screen.getByText("Dark panel")).toBeVisible();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<Panel tone="ink">Dark panel</Panel>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
