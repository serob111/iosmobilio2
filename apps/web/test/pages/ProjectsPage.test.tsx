// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";
const api = vi.hoisted(() => ({ fetchMe: vi.fn(), listProjects: vi.fn(), listBuilds: vi.fn(), createProject: vi.fn(), createDraft: vi.fn() }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/apiClient", () => api);
vi.mock("@/lib/authClient", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("@/lib/errorCodes", () => ({ useApiErrorMessage: () => () => "Try again" }));
vi.mock("@/i18n/navigation", () => ({ useRouter: () => router, Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }));
import ProjectsPage from "../../app/[locale]/projects/page";
const project = { id: "p1", name: "Real shop", sourceUrl: "https://shop.example", createdAt: "2026-11-20T00:00:00Z", updatedAt: "2026-11-25T00:00:00Z" };
const me = { user: { id: "u1", email: "a@example.com", name: "Ada" }, organizations: [{ id: "o1", name: "My workspace" }, { id: "o2", name: "Second workspace" }] };
const mount = () => render(<NextIntlClientProvider locale="en" messages={messages}><ProjectsPage /></NextIntlClientProvider>);
beforeEach(() => { vi.resetAllMocks(); localStorage.clear(); api.fetchMe.mockResolvedValue(me); api.listProjects.mockResolvedValue([project]); api.listBuilds.mockResolvedValue([]); });
afterEach(cleanup);
describe("ProjectsPage", () => {
  it("renders real data and the latest build status", async () => {
    api.listBuilds.mockResolvedValue([{ status: "failed", createdAt: "2026-11-20" }, { status: "done", createdAt: "2026-11-26" }]);
    mount();
    expect(await screen.findByText("Build ready")).toBeVisible();
    expect(screen.getByRole("link", { name: /Real shop/ })).toHaveAttribute("href", "/projects/o1/p1");
    expect(screen.getByText("shop.example")).toBeVisible();
  });
  it("creates a project in the selected organization from a bare domain", async () => {
    api.createProject.mockResolvedValue({ id: "new" }); mount();
    await screen.findByText("Real shop");
    await userEvent.selectOptions(screen.getByLabelText("Organization"), "o2");
    await userEvent.click(screen.getByRole("button", { name: /New app/ }));
    await userEvent.type(screen.getByLabelText("Website address"), "example.com");
    await userEvent.click(screen.getByRole("button", { name: "Create preview" }));
    await waitFor(() => expect(api.createProject).toHaveBeenCalledWith("o2", "example.com"));
    expect(router.push).toHaveBeenCalledWith("/projects/o2/new");
  });
  it("shows a retryable error instead of an empty state when the list fails", async () => {
    api.listProjects.mockRejectedValueOnce(new Error("offline")); mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("couldn’t load");
    expect(screen.queryByText("No apps yet")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Real shop")).toBeVisible();
  });
  it("does not label failed build-status requests as preview-only", async () => {
    api.listBuilds.mockRejectedValue(new Error("offline")); mount();
    expect(await screen.findByText("Build status unavailable")).toBeVisible();
    expect(screen.queryByText("Preview only")).not.toBeInTheDocument();
  });
  it("lets a user without a workspace create their first draft", async () => {
    api.fetchMe.mockResolvedValue({ ...me, organizations: [] }); mount();
    await userEvent.click(await screen.findByRole("button", { name: "Create your first app" }));
    await userEvent.type(screen.getByLabelText("Website address"), "first.example");
    await userEvent.click(screen.getByRole("button", { name: "Create preview" }));
    await waitFor(() => expect(api.createDraft).toHaveBeenCalledWith("first.example"));
    expect(router.push).toHaveBeenCalledWith("/try");
  });
  it("redirects signed-out users to sign in", async () => {
    api.fetchMe.mockResolvedValue(null); mount();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?callbackUrl=%2Fprojects"));
  });
});
