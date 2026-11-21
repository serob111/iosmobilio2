// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Alert } from "./Alert";

describe("Alert", () => {
  it("uses role=alert for urgent tones and role=status for calm ones", () => {
    render(
      <>
        <Alert tone="danger">We could not reach lumenstore.com.</Alert>
        <Alert tone="info">Your draft is kept for 7 days.</Alert>
      </>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("We could not reach lumenstore.com.");
    expect(screen.getByRole("status")).toHaveTextContent("Your draft is kept for 7 days.");
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(
      <>
        <Alert tone="success">Saved.</Alert>
        <Alert tone="warning">Heads up.</Alert>
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
