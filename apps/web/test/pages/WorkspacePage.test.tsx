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

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => {
    const dict = (enMessages as MessageDict)[namespace] as MessageDict;
    const t = (key: string, values?: Record<string, unknown>) => {
      const value = lookup(dict, key);
      return typeof value === "string" ? interpolate(value, values) : key;
    };
    t.has = (key: string) => typeof lookup(dict, key) === "string";
    return t;
  },
}));

const { push, replace, router } = vi.hoisted(() => {
  const push = vi.fn();
  const replace = vi.fn();
  return { push, replace, router: { push, replace } };
});
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router }));

const { ApiError, fetchMe, getMyDraft, createOrganization, claimDraft } = vi.hoisted(() => {
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
    fetchMe: vi.fn(),
    getMyDraft: vi.fn(),
    createOrganization: vi.fn(),
    claimDraft: vi.fn(),
  };
});

vi.mock("@/lib/apiClient", () => ({ ApiError, fetchMe, getMyDraft, createOrganization, claimDraft }));
vi.mock("@/lib/errorCodes", () => ({
  useApiErrorMessage: () => (error: unknown) => (error instanceof Error ? error.message : "error"),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const DRAFT = {
  id: "draft-1",
  name: "Lumen",
  sourceUrl: "https://lumenstore.com/",
  config: {},
  configVersion: 1,
  expiresAt: "",
};

async function renderWorkspacePage() {
  const { default: WorkspacePage } = await import("../../app/[locale]/workspace/page");
  return render(<WorkspacePage />);
}

describe("WorkspacePage", () => {
  it("retries a failed claim in the workspace already created", async () => {
    fetchMe.mockResolvedValue({ user: { id: "u1", email: "anna@lumenstore.com" }, organizations: [] });
    getMyDraft.mockResolvedValue(DRAFT);
    createOrganization.mockResolvedValue({ orgId: "org-new", slug: "lumen" });
    claimDraft.mockRejectedValueOnce(new Error("network down")).mockResolvedValueOnce({ id: "project-1" });
    await renderWorkspacePage();
    await screen.findByText("anna@lumenstore.com");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await screen.findByText("network down");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await screen.findByText("You're all set");
    expect(createOrganization).toHaveBeenCalledTimes(1);
    expect(claimDraft).toHaveBeenNthCalledWith(2, "org-new");
  });

  it("redirects to /login when signed out", async () => {
    fetchMe.mockResolvedValue(null);
    getMyDraft.mockResolvedValue(DRAFT);
    await renderWorkspacePage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/login"));
  });

  it("redirects to /projects when the user already has an organization", async () => {
    fetchMe.mockResolvedValue({ user: { id: "u1", email: "a@x.com" }, organizations: [{ id: "org-1", name: "Acme", slug: "acme", role: "owner" }] });
    getMyDraft.mockResolvedValue(DRAFT);
    await renderWorkspacePage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/projects"));
  });

  it("redirects to /projects when there is no draft to claim", async () => {
    fetchMe.mockResolvedValue({ user: { id: "u1", email: "a@x.com" }, organizations: [] });
    getMyDraft.mockResolvedValue(null);
    await renderWorkspacePage();
    await waitFor(() => expect(replace).toHaveBeenCalledWith("/projects"));
  });

  it("shows the draft chip, creates the workspace with the chosen segment, claims the draft, and shows the done state", async () => {
    fetchMe.mockResolvedValue({ user: { id: "u1", email: "anna@lumenstore.com" }, organizations: [] });
    getMyDraft.mockResolvedValue(DRAFT);
    createOrganization.mockResolvedValue({ orgId: "org-new", slug: "lumen" });
    claimDraft.mockResolvedValue({ id: "project-1" });

    await renderWorkspacePage();

    await screen.findByText("anna@lumenstore.com");
    expect(screen.getByText("lumenstore.com · draft from this browser")).toBeVisible();

    await userEvent.click(screen.getByRole("button", { name: "Agency or freelancer" }));
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await screen.findByText("You're all set");
    expect(createOrganization).toHaveBeenCalledWith("Lumen", "agency");
    expect(claimDraft).toHaveBeenCalledWith("org-new");

    await userEvent.click(screen.getByRole("button", { name: "Go to my apps" }));
    expect(push).toHaveBeenCalledWith("/projects/org-new/project-1");
  });

  it("shows the draft-not-found state when the workspace is created but the draft can no longer be claimed", async () => {
    fetchMe.mockResolvedValue({ user: { id: "u1", email: "anna@lumenstore.com" }, organizations: [] });
    getMyDraft.mockResolvedValue(DRAFT);
    createOrganization.mockResolvedValue({ orgId: "org-new", slug: "lumen" });
    claimDraft.mockRejectedValue(new ApiError("DRAFT_NOT_FOUND", "gone"));

    await renderWorkspacePage();
    await screen.findByText("anna@lumenstore.com");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await screen.findByText("We couldn't find your draft");
    await userEvent.click(screen.getByRole("button", { name: "Create an app" }));
    expect(push).toHaveBeenCalledWith("/projects");
  });

  it("shows an inline error and lets the user try again on a generic failure", async () => {
    fetchMe.mockResolvedValue({ user: { id: "u1", email: "anna@lumenstore.com" }, organizations: [] });
    getMyDraft.mockResolvedValue(DRAFT);
    createOrganization.mockRejectedValue(new Error("network down"));

    await renderWorkspacePage();
    await screen.findByText("anna@lumenstore.com");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));

    await screen.findByText("network down");
    await userEvent.click(screen.getByRole("button", { name: "Create workspace" }));
    await screen.findByText("Lumen", { selector: "span.font-bold" });
  });
});
