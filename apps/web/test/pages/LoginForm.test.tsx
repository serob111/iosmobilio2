// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import enMessages from "../../messages/en.json";

type MessageDict = Record<string, unknown>;

function lookup(dict: MessageDict, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") return (value as MessageDict)[part];
    return undefined;
  }, dict);
}

function interpolate(template: string, values?: Record<string, unknown>): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, name) => (name in values ? String(values[name]) : match));
}

// Same approach as TryPage.test.tsx, extended with .rich since this page uses t.rich for
// the terms notice / "draft waiting" / "sent to" copy.
vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const dict = (enMessages as MessageDict)[namespace] as MessageDict;
    const t = (key: string, values?: Record<string, unknown>) => {
      const value = lookup(dict, key);
      return typeof value === "string" ? interpolate(value, values) : key;
    };
    t.has = (key: string) => typeof lookup(dict, key) === "string";
    t.rich = (key: string, values?: Record<string, unknown>) => {
      const raw = lookup(dict, key);
      if (typeof raw !== "string") return key;
      const withValues = interpolate(raw, values);
      const parts: React.ReactNode[] = [];
      const pattern = /<(\w+)>(.*?)<\/\1>/g;
      let lastIndex = 0;
      let match: RegExpExecArray | null;
      let i = 0;
      while ((match = pattern.exec(withValues))) {
        if (match.index > lastIndex) parts.push(withValues.slice(lastIndex, match.index));
        const render = values?.[match[1]!] as ((chunks: string) => React.ReactNode) | undefined;
        parts.push(render ? <span key={i++}>{render(match[2]!)}</span> : match[2]!);
        lastIndex = pattern.lastIndex;
      }
      if (lastIndex < withValues.length) parts.push(withValues.slice(lastIndex));
      return parts;
    };
    return t;
  },
}));

vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

const signInMagicLink = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/authClient", () => ({
  authClient: {
    signIn: {
      magicLink: (...args: unknown[]) => signInMagicLink(...args),
      social: vi.fn(),
    },
  },
}));

const getMyDraft = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  getMyDraft: () => getMyDraft(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("LoginForm", () => {
  it("has no placeholder brackets and no draft banner when there is no browser draft", async () => {
    getMyDraft.mockResolvedValue(null);
    const { LoginForm } = await import("../../app/[locale]/login/LoginForm");
    const { container } = render(<LoginForm />);

    await waitFor(() => expect(getMyDraft).toHaveBeenCalled());
    expect(container.textContent).not.toMatch(/\[[A-Z][A-Z ]*\]/);
    expect(screen.queryByText(/is waiting/)).not.toBeInTheDocument();
  });

  it("shows the draft-waiting banner only when a draft exists", async () => {
    getMyDraft.mockResolvedValue({
      id: "d1",
      name: "Lumen",
      sourceUrl: "https://lumenstore.com",
      config: {},
      configVersion: 1,
      expiresAt: new Date().toISOString(),
    });
    const { LoginForm } = await import("../../app/[locale]/login/LoginForm");
    render(<LoginForm />);

    const banner = await screen.findByText(/is waiting/);
    expect(banner.closest("div")).toHaveTextContent("Lumen is waiting");
  });

  it("sends the magic link and shows the check-your-email state with the resend cooldown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    getMyDraft.mockResolvedValue(null);
    const { LoginForm } = await import("../../app/[locale]/login/LoginForm");
    render(<LoginForm />);

    await userEvent.type(screen.getByPlaceholderText("you@example.com"), "anna@lumenstore.com");
    await userEvent.click(screen.getByRole("button", { name: "Send magic link" }));

    await screen.findByRole("heading", { name: "Check your email" });
    expect(signInMagicLink).toHaveBeenCalledWith(
      expect.objectContaining({ email: "anna@lumenstore.com" }),
    );

    const resendButton = screen.getByRole("button", { name: /Resend in \d+ s/ });
    expect(resendButton).toBeDisabled();

    vi.advanceTimersByTime(30_000);
    await waitFor(() => expect(screen.getByRole("button", { name: "Resend link" })).not.toBeDisabled());
  });
});
