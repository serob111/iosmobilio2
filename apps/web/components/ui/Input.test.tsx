// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Input } from "./Input";

describe("Input", () => {
  it("accepts typed input", async () => {
    const onChange = vi.fn();
    render(<Input aria-label="Website" onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Website"), "lumenstore.com");
    expect(onChange).toHaveBeenCalled();
  });

  it("marks itself invalid when aria-invalid is set", () => {
    render(<Input aria-label="Email" aria-invalid defaultValue="hello@lumen" />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<Input aria-label="Website" defaultValue="https://lumenstore.com" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
