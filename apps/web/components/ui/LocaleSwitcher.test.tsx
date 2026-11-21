// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

const replace = vi.fn();
vi.mock("next-intl", () => ({ useLocale: () => "en" }));
vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/pricing",
  useRouter: () => ({ replace }),
}));

const { LocaleSwitcher } = await import("./LocaleSwitcher");

describe("LocaleSwitcher", () => {
  it("switches to the other locale on the same path", async () => {
    render(<LocaleSwitcher />);
    await userEvent.click(screen.getByRole("button", { name: "Switch to Russian" }));
    expect(replace).toHaveBeenCalledWith("/pricing", { locale: "ru" });
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<LocaleSwitcher />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
