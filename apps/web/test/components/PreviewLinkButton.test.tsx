// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import enMessages from "../../messages/en.json";
import { PreviewLinkButton } from "../../components/preview/PreviewLinkButton";

type MessageDict = Record<string, unknown>;

function lookup(dict: MessageDict, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") return (value as MessageDict)[part];
    return undefined;
  }, dict);
}

// Same reasoning as ProjectEditor.test.tsx: next-intl's real provider crashes under
// Vitest's module resolution, and reading straight from the real messages/en.json gives
// the same real-translation coverage without depending on its React runtime.
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

// qrcode's Node build reaches for a real <canvas> under jsdom, which jsdom only stubs —
// mocked out the same way apiClient is mocked in ProjectEditor.test.tsx, since this test
// cares about which links get fetched/created/regenerated, not the QR image itself.
vi.mock("qrcode", () => ({
  default: { toDataURL: vi.fn(async (url: string) => `data:image/png;base64,FAKE(${url})`) },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PreviewLinkButton", () => {
  it("fetches the existing active link and shows it, without ever calling createLink", async () => {
    const fetchLink = vi.fn(async () => ({ url: "https://example.test/preview/existing" }));
    const createLink = vi.fn(async () => ({ url: "https://example.test/preview/should-not-be-used" }));
    const regenerateLink = vi.fn();
    const user = userEvent.setup();

    render(<PreviewLinkButton fetchLink={fetchLink} createLink={createLink} regenerateLink={regenerateLink} />);
    await user.click(screen.getByRole("button", { name: "Open on iPhone" }));

    await waitFor(() => expect(screen.getByText("https://example.test/preview/existing")).toBeInTheDocument());
    expect(fetchLink).toHaveBeenCalledTimes(1);
    expect(createLink).not.toHaveBeenCalled();
  });

  it("creates a link only when none is currently active", async () => {
    const fetchLink = vi.fn(async () => null);
    const createLink = vi.fn(async () => ({ url: "https://example.test/preview/fresh" }));
    const regenerateLink = vi.fn();
    const user = userEvent.setup();

    render(<PreviewLinkButton fetchLink={fetchLink} createLink={createLink} regenerateLink={regenerateLink} />);
    await user.click(screen.getByRole("button", { name: "Open on iPhone" }));

    await waitFor(() => expect(screen.getByText("https://example.test/preview/fresh")).toBeInTheDocument());
    expect(fetchLink).toHaveBeenCalledTimes(1);
    expect(createLink).toHaveBeenCalledTimes(1);
  });

  it("shows an error message when fetching/creating the link fails", async () => {
    const fetchLink = vi.fn(async () => {
      throw new Error("boom");
    });
    const createLink = vi.fn();
    const regenerateLink = vi.fn();
    const user = userEvent.setup();

    render(<PreviewLinkButton fetchLink={fetchLink} createLink={createLink} regenerateLink={regenerateLink} />);
    await user.click(screen.getByRole("button", { name: "Open on iPhone" }));

    await waitFor(() => expect(screen.getByText("Couldn't create the link. Please try again.")).toBeInTheDocument());
  });

  it("regenerate requires confirmation, and only calls regenerateLink after confirming", async () => {
    const fetchLink = vi.fn(async () => ({ url: "https://example.test/preview/old" }));
    const createLink = vi.fn();
    const regenerateLink = vi.fn(async () => ({ url: "https://example.test/preview/new" }));
    const user = userEvent.setup();

    render(<PreviewLinkButton fetchLink={fetchLink} createLink={createLink} regenerateLink={regenerateLink} />);
    await user.click(screen.getByRole("button", { name: "Open on iPhone" }));
    await waitFor(() => expect(screen.getByText("https://example.test/preview/old")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Generate new link" }));
    expect(
      screen.getByText("The old link will stop working for anyone who has it. Continue?"),
    ).toBeInTheDocument();
    expect(regenerateLink).not.toHaveBeenCalled();

    // Cancelling leaves the original link in place and never calls regenerateLink.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(regenerateLink).not.toHaveBeenCalled();
    expect(screen.getByText("https://example.test/preview/old")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Generate new link" }));
    await user.click(screen.getByRole("button", { name: "Yes, generate new link" }));

    await waitFor(() => expect(screen.getByText("https://example.test/preview/new")).toBeInTheDocument());
    expect(regenerateLink).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("https://example.test/preview/old")).not.toBeInTheDocument();
  });
});
