// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Textarea } from "./Textarea";

describe("Textarea", () => {
  it("accepts typed input", async () => {
    render(<Textarea aria-label="Description" />);
    const textarea = screen.getByLabelText("Description");
    await userEvent.type(textarea, "A short app description.");
    expect(textarea).toHaveValue("A short app description.");
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<Textarea aria-label="Description" defaultValue="Hello" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
