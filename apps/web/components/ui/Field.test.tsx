// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { Field } from "./Field";
import { Input } from "./Input";

describe("Field", () => {
  it("associates the label with the control", () => {
    render(
      <Field label="Website">
        <Input defaultValue="https://lumenstore.com" />
      </Field>,
    );
    expect(screen.getByLabelText("Website")).toHaveValue("https://lumenstore.com");
  });

  it("wires hint and error into aria-describedby and aria-invalid", () => {
    render(
      <Field label="Email" error="Enter a full email address.">
        <Input defaultValue="hello@lumen" />
      </Field>,
    );
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter a full email address.")).toHaveAttribute("id", input.getAttribute("aria-describedby"));
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(
      <>
        <Field label="Website" hint="Include https://">
          <Input defaultValue="https://lumenstore.com" />
        </Field>
        <Field label="Email" error="Enter a full email address.">
          <Input defaultValue="hello@lumen" />
        </Field>
      </>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
