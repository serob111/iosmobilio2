// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Logo } from "./Logo";

describe("Logo", () => {
  it("renders the wordmark", () => {
    render(<Logo />);
    expect(screen.getByText("mobilio")).toBeVisible();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<Logo tone="white" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
