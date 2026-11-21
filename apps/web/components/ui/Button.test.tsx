// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Button } from "./Button";

describe("Button", () => {
  it("renders its label and fires onClick", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Create app</Button>);
    const button = screen.getByRole("button", { name: "Create app" });
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("disables the button and marks it busy while loading", () => {
    render(<Button loading>Build app</Button>);
    const button = screen.getByRole("button", { name: "Build app" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("disables the button when disabled is set", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Disabled
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Disabled" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("has no detectable accessibility violations across variants", async () => {
    const { container } = render(
      <>
        <Button variant="primary">Create app</Button>
        <Button variant="secondary">Share preview</Button>
        <Button variant="ghost">Cancel</Button>
        <Button variant="danger">Delete app</Button>
        <Button variant="lime">Build app</Button>
        <Button variant="onDark">Test on iPhone</Button>
      </>,
    );
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
