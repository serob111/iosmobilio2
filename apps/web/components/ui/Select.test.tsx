// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";
import { Select } from "./Select";

describe("Select", () => {
  it("lets the user pick an option", async () => {
    render(
      <Select aria-label="Category" defaultValue="shopping">
        <option value="shopping">Shopping</option>
        <option value="food">Food &amp; Drink</option>
      </Select>,
    );
    const select = screen.getByLabelText("Category");
    await userEvent.selectOptions(select, "food");
    expect(select).toHaveValue("food");
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(
      <Select aria-label="Category" defaultValue="shopping">
        <option value="shopping">Shopping</option>
      </Select>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
