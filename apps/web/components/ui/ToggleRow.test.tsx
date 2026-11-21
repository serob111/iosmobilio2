// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { ToggleRow } from "./ToggleRow";

describe("ToggleRow", () => {
  it("toggles via its checkbox", async () => {
    const onChange = vi.fn();
    render(<ToggleRow label="Push notifications" defaultChecked onChange={onChange} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Push notifications" }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<ToggleRow label="Push notifications" defaultChecked />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
