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

// Same reasoning as ProjectEditor.test.tsx / PreviewLinkButton.test.tsx.
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

vi.mock("next/navigation", () => ({
  usePathname: () => "/try",
}));

// A stable object identity across renders — same as the real next-intl useRouter (which
// wraps Next's own memoized router) — a fresh literal per call would make this effect's
// dependency array change every render and loop forever.
const { push, replace, router } = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return { push, replace, router: { push, replace } };
});
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => router,
  Link: ({ children, ...props }: { children: React.ReactNode }) => <a {...props}>{children}</a>,
}));

vi.mock("@/components/editor/ProjectEditor", () => ({
  ProjectEditor: () => <div data-testid="project-editor" />,
}));
vi.mock("@/components/preview/PreviewLinkButton", () => ({
  PreviewLinkButton: () => <div data-testid="preview-link-button" />,
}));
vi.mock("@/components/editor/DraftAdapter", () => ({
  createDraftAdapter: vi.fn(() => ({})),
}));

const {
  ApiError,
  getMyDraft,
  createDraftEditorPreviewLink,
  fetchPreviewDto,
  fetchMe,
  createOrganization,
  claimDraft,
} = vi.hoisted(() => {
  class ApiError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "ApiError";
    }
  }
  return {
    ApiError,
    getMyDraft: vi.fn(),
    createDraftEditorPreviewLink: vi.fn(),
    fetchPreviewDto: vi.fn(),
    fetchMe: vi.fn(),
    createOrganization: vi.fn(),
    claimDraft: vi.fn(),
  };
});

vi.mock("@/lib/apiClient", () => ({
  ApiError,
  getMyDraft,
  createDraftEditorPreviewLink,
  createDraftPreviewLink: vi.fn(),
  fetchDraftPreviewLink: vi.fn(),
  regenerateDraftPreviewLink: vi.fn(),
  fetchPreviewDto,
  fetchMe,
  createOrganization,
  claimDraft,
}));

vi.mock("@/lib/errorCodes", () => ({
  useApiErrorMessage: () => (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DRAFT = { id: "draft-1", name: "D", sourceUrl: "https://x.example", config: {}, configVersion: 1, expiresAt: "" };

function mockHappyDraftLoad() {
  getMyDraft.mockResolvedValue(DRAFT);
  createDraftEditorPreviewLink.mockResolvedValue({ url: "http://localhost:3100/preview/abc" });
  fetchPreviewDto.mockResolvedValue({
    name: "D",
    theme: { primary: "#000", background: "#fff", statusBar: "dark" },
    statusBar: "dark",
    tabs: [],
    iconUrl: "http://icon",
    proxyBase: "http://proxy",
  });
}

async function renderTryPage() {
  const { default: TryPage } = await import("../../app/[locale]/try/page");
  return render(<TryPage />);
}

describe("TryPage", () => {
  it("shows a workspace-name form (not a disabled button) when the signed-in user has zero organizations, and submitting creates an org then claims", async () => {
    mockHappyDraftLoad();
    fetchMe.mockResolvedValue({ user: { id: "u1", name: "A", email: "a@x.com" }, organizations: [] });
    createOrganization.mockResolvedValue({ orgId: "org-new", slug: "a" });
    claimDraft.mockResolvedValue({ id: "project-1" });
    const user = userEvent.setup();

    await renderTryPage();
    await waitFor(() => expect(screen.getByTestId("project-editor")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByPlaceholderText("Workspace name")).toBeInTheDocument());

    await user.type(screen.getByPlaceholderText("Workspace name"), "My Workspace");
    await user.click(screen.getByRole("button", { name: "Create workspace and save" }));

    await waitFor(() => expect(claimDraft).toHaveBeenCalledWith("org-new"));
    expect(createOrganization).toHaveBeenCalledWith("My Workspace");
    expect(push).toHaveBeenCalledWith("/projects/org-new/project-1");
  });

  it("redirects to /login with callbackUrl on a 401 from the load effect, not a silent no-draft redirect", async () => {
    fetchMe.mockResolvedValue(null);
    getMyDraft.mockRejectedValue(new ApiError("UNAUTHORIZED", "no session"));

    await renderTryPage();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith({ pathname: "/login", query: { callbackUrl: "/try" } }),
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it("shows an error message with a Retry button (not a silent redirect) on a generic load failure", async () => {
    fetchMe.mockResolvedValue(null);
    getMyDraft.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();

    await renderTryPage();

    await waitFor(() => expect(screen.getByText("Something went wrong loading your draft.")).toBeInTheDocument());
    expect(replace).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();

    getMyDraft.mockResolvedValueOnce(DRAFT);
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(getMyDraft).toHaveBeenCalledTimes(2));
  });
});
