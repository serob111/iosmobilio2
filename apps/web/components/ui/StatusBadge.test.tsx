// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { StatusBadge } from "./StatusBadge";

describe("StatusBadge", () => {
  it("renders the caller-supplied label for every status", () => {
    render(
      <>
        <StatusBadge status="draft">Preview only</StatusBadge>
        <StatusBadge status="building">Building</StatusBadge>
        <StatusBadge status="ready">Test build ready</StatusBadge>
        <StatusBadge status="review">In review</StatusBadge>
        <StatusBadge status="live">Live on App Store</StatusBadge>
        <StatusBadge status="failed">Build failed</StatusBadge>
      </>,
    );
    for (const text of ["Preview only", "Building", "Test build ready", "In review", "Live on App Store", "Build failed"]) {
      expect(screen.getByText(text)).toBeVisible();
    }
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<StatusBadge status="ready">Test build ready</StatusBadge>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
