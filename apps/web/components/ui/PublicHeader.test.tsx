// @vitest-environment jsdom
/* eslint-disable @next/next/no-html-link-for-pages -- plain <a> fixtures stand in for the mocked Link below */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";
import { vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { PublicHeader } = await import("./PublicHeader");

describe("PublicHeader", () => {
  it("renders the logo link and the supplied nav/actions slots", () => {
    render(
      <PublicHeader
        nav={<a href="/pricing">Pricing</a>}
        actions={<a href="/login">Sign in</a>}
      />,
    );
    expect(screen.getByRole("link", { name: "Mobilio home" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Pricing" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<PublicHeader tone="onDark" nav={<a href="/pricing">Pricing</a>} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
