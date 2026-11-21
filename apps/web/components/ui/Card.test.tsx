// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Card } from "./Card";

describe("Card", () => {
  it("renders its children", () => {
    render(<Card>Lumen</Card>);
    expect(screen.getByText("Lumen")).toBeVisible();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<Card>Lumen</Card>);
    expect(await axe(container)).toHaveNoViolations();
  });
});
