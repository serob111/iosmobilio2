// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import enMessages from "../../messages/en.json";
import type { AppleAppSiteAssociation as AppleAppSiteAssociationType } from "../../components/editor/AppleAppSiteAssociation";

type MessageDict = Record<string, unknown>;

function lookup(dict: MessageDict, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") return (value as MessageDict)[part];
    return undefined;
  }, dict);
}

// Same reasoning as PreviewLinkButton.test.tsx/ProjectEditor.test.tsx.
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
}));

// AppleAppSiteAssociation reads NEXT_PUBLIC_APPLE_TEAM_ID into a module-level constant
// (same convention as PreviewShell's ABUSE_EMAIL/ProjectAdapter's ENABLE_BUILDS) — it's
// only ever read once, at module evaluation time, so changing process.env after import
// has no effect. vi.resetModules() + a fresh dynamic import per test is what actually
// lets each test see its own env var value, rather than vi.stubEnv (which would only
// affect a *second* import, never retroactively rewrite the first one's captured
// constant).
async function loadComponent(teamId: string | undefined): Promise<typeof AppleAppSiteAssociationType> {
  vi.resetModules();
  if (teamId === undefined) {
    delete process.env.NEXT_PUBLIC_APPLE_TEAM_ID;
  } else {
    process.env.NEXT_PUBLIC_APPLE_TEAM_ID = teamId;
  }
  const mod = await import("../../components/editor/AppleAppSiteAssociation");
  return mod.AppleAppSiteAssociation;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete process.env.NEXT_PUBLIC_APPLE_TEAM_ID;
});

describe("AppleAppSiteAssociation", () => {
  it("renders nothing when no Apple Team ID is configured", async () => {
    const AppleAppSiteAssociation = await loadComponent(undefined);
    const { container } = render(<AppleAppSiteAssociation bundleId="am.mobilio.t.cafe" allowedDomains={["cafe.example"]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the apple-app-site-association JSON with the team id and bundle id combined into appID", async () => {
    const AppleAppSiteAssociation = await loadComponent("ABCDE12345");
    render(<AppleAppSiteAssociation bundleId="am.mobilio.t.cafe" allowedDomains={["cafe.example"]} />);
    const pre = screen.getByText((_, element) => element?.tagName === "PRE");
    expect(pre.textContent).toContain('"appID": "ABCDE12345.am.mobilio.t.cafe"');
    expect(pre.textContent).toContain('"paths": [');
  });

  it("lists the well-known URL for every allowed domain", async () => {
    const AppleAppSiteAssociation = await loadComponent("ABCDE12345");
    render(<AppleAppSiteAssociation bundleId="am.mobilio.t.cafe" allowedDomains={["cafe.example", "other.example"]} />);
    expect(screen.getByText("https://cafe.example/.well-known/apple-app-site-association")).toBeInTheDocument();
    expect(screen.getByText("https://other.example/.well-known/apple-app-site-association")).toBeInTheDocument();
  });

  it("shows a fallback message instead of a domain list when there are no allowed domains", async () => {
    const AppleAppSiteAssociation = await loadComponent("ABCDE12345");
    render(<AppleAppSiteAssociation bundleId="am.mobilio.t.cafe" allowedDomains={[]} />);
    expect(screen.getByText("No domain found for this project yet.")).toBeInTheDocument();
  });

  it("copies the JSON content to the clipboard and shows a confirmation", async () => {
    const AppleAppSiteAssociation = await loadComponent("ABCDE12345");
    const writeText = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    // jsdom's navigator.clipboard is a non-writable getter — Object.assign silently
    // no-ops against it, so the mock never actually takes effect unless redefined via
    // defineProperty instead. Also must come *after* userEvent.setup(), which installs
    // its own clipboard stub as part of setup and would otherwise clobber this one.
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<AppleAppSiteAssociation bundleId="am.mobilio.t.cafe" allowedDomains={["cafe.example"]} />);
    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0]![0]).toContain("ABCDE12345.am.mobilio.t.cafe");
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
  });
});
