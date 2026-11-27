// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));

afterEach(cleanup);

describe("legal pages", () => {
  it.each([
    ["en", "terms", "Terms of Service"],
    ["en", "privacy", "Privacy Policy"],
    ["en", "refunds", "Refund Policy"],
    ["ru", "terms", "Условия использования"],
  ] as const)("renders %s/%s through the shared template", async (locale, documentId, title) => {
    const { LegalPage } = await import("../../app/[locale]/legal/LegalPage");
    const { container } = render(<LegalPage locale={locale} documentId={documentId} />);
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(container.textContent).not.toMatch(/\[[A-Z][A-Z _-]*\]/);
  });

  it("uses configured company details and support email", async () => {
    vi.stubEnv("NEXT_PUBLIC_COMPANY_LEGAL_NAME", "Example Incorporated");
    vi.stubEnv("NEXT_PUBLIC_COMPANY_ADDRESS", "42 Example Street");
    vi.stubEnv("NEXT_PUBLIC_SUPPORT_EMAIL", "legal@example.com");
    const { LegalPage } = await import("../../app/[locale]/legal/LegalPage");
    render(<LegalPage locale="en" documentId="terms" />);
    expect(screen.getByText(/Example Incorporated, registered at 42 Example Street/)).toBeVisible();
    expect(screen.getAllByRole("link", { name: "legal@example.com" })[0]).toHaveAttribute("href", "mailto:legal@example.com");
    vi.unstubAllEnvs();
  });
});
