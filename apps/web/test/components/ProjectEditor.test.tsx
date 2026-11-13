// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProjectConfig } from "@mobilio/config";
import enMessages from "../../messages/en.json";
import { ProjectEditor } from "../../components/editor/ProjectEditor";
import { createDraftAdapter } from "../../components/editor/DraftAdapter";
import { createProjectAdapter } from "../../components/editor/ProjectAdapter";

type MessageDict = Record<string, unknown>;

function lookup(dict: MessageDict, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") return (value as MessageDict)[part];
    return undefined;
  }, dict);
}

// next-intl's real NextIntlClientProvider crashes under Vitest's module resolution
// ("Cannot read properties of null (reading 'useContext')" from use-intl's
// IntlProvider) — looks like an RSC/client package-export-condition mismatch specific
// to this bundler combination, not something these tests need to prove. Reading
// straight from the real messages/en.json gives the same real-translation coverage
// (a missing/renamed key still fails these tests) without depending on next-intl's
// React runtime at all.
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

const {
  updateDraftConfig,
  uploadDraftIcon,
  draftIconUrl,
  updateProjectConfig,
  uploadProjectIcon,
  projectIconUrl,
} = vi.hoisted(() => ({
  updateDraftConfig: vi.fn(async (config: ProjectConfig) => config),
  uploadDraftIcon: vi.fn(async () => {}),
  draftIconUrl: vi.fn((v?: number) => `http://api.test/drafts/me/icon?v=${v ?? ""}`),
  updateProjectConfig: vi.fn(async (_orgId: string, _projectId: string, config: ProjectConfig) => config),
  uploadProjectIcon: vi.fn(async () => {}),
  projectIconUrl: vi.fn(
    (orgId: string, projectId: string, v?: number) => `http://api.test/orgs/${orgId}/projects/${projectId}/icon?v=${v ?? ""}`,
  ),
}));

vi.mock("@/lib/apiClient", () => ({
  updateDraftConfig,
  uploadDraftIcon,
  draftIconUrl,
  updateProjectConfig,
  uploadProjectIcon,
  projectIconUrl,
  // Unused by this file's tests (ENABLE_BUILDS is unset), but ProjectAdapter imports
  // them unconditionally — must exist so the mocked module has every binding it expects.
  startBuild: vi.fn(),
  listBuilds: vi.fn(),
  getBuild: vi.fn(),
  buildIpaUrl: vi.fn(),
}));

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: "cfg-1",
    name: "Original Name",
    slug: "original-name",
    bundleId: "am.mobilio.app.originalname",
    source: { type: "url", url: "https://example.test" },
    theme: { primary: "#4B2BE0", background: "#FFFFFF", statusBar: "dark" },
    tabs: [{ title: "Home", icon: "home", path: "/" }],
    features: { offline: true, share: true, deepLinks: false, pullToRefresh: true },
    allowedDomains: ["example.test"],
    trial: true,
    ...overrides,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(ui);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProjectEditor with DraftAdapter", () => {
  it("renders the initial config and has no Builds section (drafts never build)", () => {
    const adapter = createDraftAdapter("http://proxy.test", baseConfig());
    renderWithIntl(<ProjectEditor adapter={adapter} />);

    expect(screen.getByDisplayValue("Original Name")).toBeInTheDocument();
    expect(screen.queryByText("Build .ipa")).not.toBeInTheDocument();
  });

  it("saving an edited name calls updateDraftConfig with the new value and shows Saved", async () => {
    const user = userEvent.setup();
    const adapter = createDraftAdapter("http://proxy.test", baseConfig());
    renderWithIntl(<ProjectEditor adapter={adapter} />);

    const nameInput = screen.getByDisplayValue("Original Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Draft");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateDraftConfig).toHaveBeenCalledTimes(1));
    expect(updateDraftConfig.mock.calls[0]![0]).toMatchObject({ name: "Renamed Draft" });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("adding and removing a tab changes the tab count", async () => {
    const user = userEvent.setup();
    const adapter = createDraftAdapter("http://proxy.test", baseConfig());
    renderWithIntl(<ProjectEditor adapter={adapter} />);

    expect(screen.getAllByLabelText("Title")).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "+ Add tab" }));
    expect(screen.getAllByLabelText("Title")).toHaveLength(2);

    await user.click(screen.getAllByRole("button", { name: /remove/i })[0]!);
    expect(screen.getAllByLabelText("Title")).toHaveLength(1);
  });

  it("uploading a file calls uploadDraftIcon and bumps the icon's cache-busting version", async () => {
    const user = userEvent.setup();
    const adapter = createDraftAdapter("http://proxy.test", baseConfig());
    renderWithIntl(<ProjectEditor adapter={adapter} />);

    const file = new File(["fake-bytes"], "icon.png", { type: "image/png" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(uploadDraftIcon).toHaveBeenCalledWith(file));
    // draftIconUrl is called once on mount (v=0 via useState(0)) and once more with a
    // fresh version after the upload resolves.
    await waitFor(() => expect(draftIconUrl.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});

describe("ProjectEditor with ProjectAdapter", () => {
  const ORG_ID = "org-1";
  const PROJECT_ID = "project-1";

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_ENABLE_BUILDS;
  });

  it("renders the initial config and has no Builds section when NEXT_PUBLIC_ENABLE_BUILDS is unset", () => {
    const adapter = createProjectAdapter(ORG_ID, PROJECT_ID, "http://proxy.test", baseConfig({ name: "A Project" }));
    renderWithIntl(<ProjectEditor adapter={adapter} />);

    expect(screen.getByDisplayValue("A Project")).toBeInTheDocument();
    expect(screen.queryByText("Build .ipa")).not.toBeInTheDocument();
    expect(adapter.builds).toBeUndefined();
  });

  it("saving an edited name calls updateProjectConfig scoped to the org/project", async () => {
    const user = userEvent.setup();
    const adapter = createProjectAdapter(ORG_ID, PROJECT_ID, "http://proxy.test", baseConfig());
    renderWithIntl(<ProjectEditor adapter={adapter} />);

    const nameInput = screen.getByDisplayValue("Original Name");
    await user.clear(nameInput);
    await user.type(nameInput, "Renamed Project");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(updateProjectConfig).toHaveBeenCalledTimes(1));
    expect(updateProjectConfig).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, expect.objectContaining({ name: "Renamed Project" }));
  });

  it("uploading a file calls uploadProjectIcon scoped to the org/project", async () => {
    const user = userEvent.setup();
    const adapter = createProjectAdapter(ORG_ID, PROJECT_ID, "http://proxy.test", baseConfig());
    renderWithIntl(<ProjectEditor adapter={adapter} />);

    const file = new File(["fake-bytes"], "icon.png", { type: "image/jpeg" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, file);

    await waitFor(() => expect(uploadProjectIcon).toHaveBeenCalledWith(ORG_ID, PROJECT_ID, file));
  });
});
