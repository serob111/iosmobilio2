import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectConfig } from "@mobilio/config";

vi.mock("@/lib/apiClient", () => ({
  updateProjectConfig: vi.fn(),
  uploadProjectIcon: vi.fn(),
  projectIconUrl: vi.fn(),
  startBuild: vi.fn(),
  listBuilds: vi.fn(),
  getBuild: vi.fn(),
  buildIpaUrl: vi.fn(),
}));

const CONFIG = { id: "cfg-1" } as ProjectConfig;

afterEach(() => {
  delete process.env.NEXT_PUBLIC_ENABLE_BUILDS;
  vi.resetModules();
});

describe("createProjectAdapter's NEXT_PUBLIC_ENABLE_BUILDS gate", () => {
  it("omits builds entirely when the flag is unset (the default)", async () => {
    delete process.env.NEXT_PUBLIC_ENABLE_BUILDS;
    vi.resetModules();
    const { createProjectAdapter } = await import("../../components/editor/ProjectAdapter");

    const adapter = createProjectAdapter("org-1", "project-1", "http://proxy.test", CONFIG);
    expect(adapter.builds).toBeUndefined();
  });

  it("provides a builds object, wired to the org/project, when the flag is 'true'", async () => {
    process.env.NEXT_PUBLIC_ENABLE_BUILDS = "true";
    vi.resetModules();
    const { createProjectAdapter } = await import("../../components/editor/ProjectAdapter");
    const { startBuild, buildIpaUrl } = await import("../../lib/apiClient");

    const adapter = createProjectAdapter("org-1", "project-1", "http://proxy.test", CONFIG);
    expect(adapter.builds).toBeDefined();

    await adapter.builds!.start();
    expect(startBuild).toHaveBeenCalledWith("org-1", "project-1");

    adapter.builds!.ipaUrl("build-1");
    expect(buildIpaUrl).toHaveBeenCalledWith("org-1", "project-1", "build-1");
  });

  it("stays off for any other value, not just an explicit 'false'", async () => {
    process.env.NEXT_PUBLIC_ENABLE_BUILDS = "1";
    vi.resetModules();
    const { createProjectAdapter } = await import("../../components/editor/ProjectAdapter");

    const adapter = createProjectAdapter("org-1", "project-1", "http://proxy.test", CONFIG);
    expect(adapter.builds).toBeUndefined();
  });
});
