// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import enMessages from "../../messages/en.json";

type MessageDict = Record<string, unknown>;

function lookup(dict: MessageDict, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") return (value as MessageDict)[part];
    return undefined;
  }, dict);
}

// Same approach as TryPage.test.tsx/ProjectEditor.test.tsx.
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const dict = (enMessages as MessageDict)[namespace] as MessageDict;
    const t = (key: string) => {
      const value = lookup(dict, key);
      return typeof value === "string" ? value : key;
    };
    t.has = (key: string) => typeof lookup(dict, key) === "string";
    return t;
  },
  useLocale: () => "en",
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/pricing",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  delete process.env.NEXT_PUBLIC_FOUNDING_OFFER;
});

describe("PricingPage", () => {
  it("renders every plan's real price from packages/config, not a placeholder", async () => {
    vi.resetModules();
    const { default: PricingPage } = await import("../../app/[locale]/pricing/page");
    render(<PricingPage />);

    expect(screen.getByText("$0")).toBeVisible();
    expect(screen.getByText("$29")).toBeVisible();
    expect(screen.getByText("$49")).toBeVisible();
    expect(screen.getByText("$99")).toBeVisible();
    expect(screen.getByText("$299")).toBeVisible();
    expect(screen.queryByText(/\[.*\]/)).not.toBeInTheDocument();
  });

  it("switches every recurring plan's price to its yearly figure", async () => {
    vi.resetModules();
    const { default: PricingPage } = await import("../../app/[locale]/pricing/page");
    render(<PricingPage />);

    await userEvent.click(screen.getByRole("radio", { name: "Yearly · save 20%" }));

    expect(screen.getByText("$39")).toBeVisible();
    expect(screen.getByText("$79")).toBeVisible();
    expect(screen.getByText("$239")).toBeVisible();
    // The one-time plans don't change with the billing period toggle.
    expect(screen.getByText("$0")).toBeVisible();
    expect(screen.getByText("$29")).toBeVisible();
  });

  it("hides the founding-customer banner by default", async () => {
    vi.resetModules();
    const { default: PricingPage } = await import("../../app/[locale]/pricing/page");
    render(<PricingPage />);
    expect(screen.queryByText("Founding customers:")).not.toBeInTheDocument();
  });

  it("shows the founding-customer banner, with no spots-left count, when the flag is on", async () => {
    process.env.NEXT_PUBLIC_FOUNDING_OFFER = "true";
    vi.resetModules();
    const { default: PricingPage } = await import("../../app/[locale]/pricing/page");
    render(<PricingPage />);

    expect(screen.getByText("Founding customers:")).toBeVisible();
    expect(screen.queryByText(/spots?/i)).not.toBeInTheDocument();
  });
});
