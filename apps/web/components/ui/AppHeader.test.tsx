// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "jest-axe";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { AppHeader } = await import("./AppHeader");

const organizations = [{ id: "org-1", name: "Lumen Store" }];

describe("AppHeader", () => {
  it("lets the user switch organizations and sign out from the account menu", async () => {
    const onOrgChange = vi.fn();
    const onSignOut = vi.fn();
    render(
      <AppHeader
        organizations={organizations}
        currentOrgId="org-1"
        onOrgChange={onOrgChange}
        nav={[{ href: "/projects", label: "My apps", current: true }]}
        email="anna@lumenstore.com"
        signOutLabel="Sign out"
        onSignOut={onSignOut}
      />,
    );
    expect(screen.getByRole("link", { name: "My apps" })).toHaveAttribute("aria-current", "page");

    await userEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(screen.getByText("anna@lumenstore.com")).toBeVisible();
    await userEvent.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(
      <AppHeader
        organizations={organizations}
        currentOrgId="org-1"
        onOrgChange={() => {}}
        nav={[{ href: "/projects", label: "My apps", current: true }]}
        email="anna@lumenstore.com"
        signOutLabel="Sign out"
        onSignOut={() => {}}
      />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
