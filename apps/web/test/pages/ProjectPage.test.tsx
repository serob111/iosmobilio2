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
  usePathname: () => "/projects/org-1/project-1",
  useParams: () => ({ orgId: "org-1", projectId: "project-1" }),
}));

// A stable object identity across renders (see TryPage.test.tsx's own comment) — a fresh
// literal per call would make this effect's dependency array change every render.
const { push, router } = vi.hoisted(() => {
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
vi.mock("@/components/editor/ProjectAdapter", () => ({
  createProjectAdapter: vi.fn(() => ({})),
}));

const { ApiError, fetchProject, createProjectEditorPreviewLink, fetchPreviewDto } = vi.hoisted(() => {
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
    fetchProject: vi.fn(),
    createProjectEditorPreviewLink: vi.fn(),
    fetchPreviewDto: vi.fn(),
  };
});

vi.mock("@/lib/apiClient", () => ({
  ApiError,
  fetchProject,
  createProjectEditorPreviewLink,
  createProjectPreviewLink: vi.fn(),
  fetchProjectPreviewLink: vi.fn(),
  regenerateProjectPreviewLink: vi.fn(),
  fetchPreviewDto,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function renderProjectPage() {
  const { default: ProjectPage } = await import("../../app/[locale]/projects/[orgId]/[projectId]/page");
  return render(<ProjectPage />);
}

describe("ProjectPage", () => {
  it("redirects to /login with callbackUrl on a 401, instead of showing 'not found'", async () => {
    fetchProject.mockRejectedValue(new ApiError("UNAUTHORIZED", "no session"));

    await renderProjectPage();

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith({ pathname: "/login", query: { callbackUrl: "/projects/org-1/project-1" } }),
    );
    expect(screen.queryByText("Project not found")).not.toBeInTheDocument();
  });

  it("shows an error message with a Retry button (not 'not found') on a generic load failure", async () => {
    fetchProject.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();

    await renderProjectPage();

    await waitFor(() => expect(screen.getByText("Something went wrong loading this project.")).toBeInTheDocument());
    expect(screen.queryByText("Project not found")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fetchProject.mockResolvedValueOnce(null);
    await user.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("Project not found")).toBeInTheDocument());
  });

  it("still shows the plain 'not found' message (no redirect) when the project genuinely does not exist", async () => {
    fetchProject.mockResolvedValue(null);

    await renderProjectPage();

    await waitFor(() => expect(screen.getByText("Project not found")).toBeInTheDocument());
    expect(push).not.toHaveBeenCalled();
  });
});
