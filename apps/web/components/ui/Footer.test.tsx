// @vitest-environment jsdom
/* eslint-disable @next/next/no-html-link-for-pages -- plain <a> fixtures stand in for the mocked Link below */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "jest-axe";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const { Footer } = await import("./Footer");

describe("Footer", () => {
  it("renders the nav slot and copyright", () => {
    render(<Footer nav={<a href="/legal/terms">Terms</a>} copyright="© 2026 Mobilio" />);
    expect(screen.getByRole("link", { name: "Terms" })).toBeVisible();
    expect(screen.getByText("© 2026 Mobilio")).toBeVisible();
  });

  it("has no detectable accessibility violations", async () => {
    const { container } = render(<Footer nav={<a href="/legal/terms">Terms</a>} copyright="© 2026 Mobilio" />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
