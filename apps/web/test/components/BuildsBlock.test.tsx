// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import enMessages from "../../messages/en.json";
import { BuildsBlock, type Builds } from "../../components/editor/BuildsBlock";
import type { BuildSummary } from "../../lib/apiClient";

type MessageDict = Record<string, unknown>;

function lookup(dict: MessageDict, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object") return (value as MessageDict)[part];
    return undefined;
  }, dict);
}

// Same reasoning as ProjectEditor.test.tsx: next-intl's real Provider crashes under
// Vitest's module resolution, so useTranslations is mocked to read straight from the
// real messages/en.json instead.
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

function build(overrides: Partial<BuildSummary> = {}): BuildSummary {
  return {
    id: "build-1",
    status: "queued",
    runId: null,
    error: null,
    startedAt: null,
    finishedAt: null,
    createdAt: new Date().toISOString(),
    stepTimings: null,
    ...overrides,
  };
}

function fakeBuilds(overrides: Partial<Builds> = {}): Builds {
  return {
    start: vi.fn(async () => ({ id: "build-1", status: "queued" as const })),
    list: vi.fn(async () => []),
    get: vi.fn(async () => build()),
    ipaUrl: vi.fn((buildId: string) => `http://api.test/builds/${buildId}/ipa`),
    installUrl: vi.fn((buildId: string) => `itms-services://?action=download-manifest&url=http://api.test/builds/${buildId}/manifest.plist`),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BuildsBlock", () => {
  it("shows a Start button when there is no existing build", async () => {
    const builds = fakeBuilds({ list: vi.fn(async () => []) });
    render(<BuildsBlock builds={builds} />);

    expect(await screen.findByRole("button", { name: "Build .ipa" })).toBeInTheDocument();
  });

  it("starting a build calls builds.start() and shows the queued status", async () => {
    const user = userEvent.setup();
    const builds = fakeBuilds({ list: vi.fn(async () => []) });
    render(<BuildsBlock builds={builds} />);

    await user.click(await screen.findByRole("button", { name: "Build .ipa" }));

    expect(builds.start).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Queued")).toBeInTheDocument();
  });

  it("a done build shows a download link using builds.ipaUrl(), not a GitHub run link", async () => {
    const builds = fakeBuilds({ list: vi.fn(async () => [build({ status: "done" })]) });
    render(<BuildsBlock builds={builds} />);

    const link = await screen.findByRole("link", { name: "Download .ipa" });
    expect(link).toHaveAttribute("href", "http://api.test/builds/build-1/ipa");
    expect(builds.ipaUrl).toHaveBeenCalledWith("build-1");
  });

  it("a done build also shows the itms-services install link using builds.installUrl(), the thing that actually triggers an iOS install prompt", async () => {
    const builds = fakeBuilds({ list: vi.fn(async () => [build({ status: "done" })]) });
    render(<BuildsBlock builds={builds} />);

    const link = await screen.findByRole("link", { name: "Install on iPhone" });
    expect(link).toHaveAttribute("href", "itms-services://?action=download-manifest&url=http://api.test/builds/build-1/manifest.plist");
    expect(builds.installUrl).toHaveBeenCalledWith("build-1");
  });

  it("a building build with real step_timings shows the completed steps, not a fake/animated progress bar", async () => {
    const builds = fakeBuilds({
      list: vi.fn(async () => [
        build({
          status: "building",
          stepTimings: [
            { step: "fetchActiveBase", durationMs: 12 },
            { step: "ensureAdHocProfile", durationMs: 1500 },
          ],
        }),
      ]),
    });
    render(<BuildsBlock builds={builds} />);

    expect(await screen.findByText("Fetch Active Base")).toBeInTheDocument();
    expect(screen.getByText("Ensure Ad Hoc Profile")).toBeInTheDocument();
    expect(screen.getByText("12ms")).toBeInTheDocument();
    expect(screen.getByText("1.5s")).toBeInTheDocument();
  });

  it("a queued build with no step_timings yet shows no progress list at all", async () => {
    const builds = fakeBuilds({ list: vi.fn(async () => [build({ status: "queued", stepTimings: null })]) });
    render(<BuildsBlock builds={builds} />);

    await screen.findByText("Queued");
    expect(screen.queryByText("Progress")).not.toBeInTheDocument();
  });

  it("a failed build shows the error message and lets the user retry", async () => {
    const user = userEvent.setup();
    const builds = fakeBuilds({
      list: vi.fn(async () => [build({ status: "failed", error: "xcodebuild exited 65" })]),
    });
    render(<BuildsBlock builds={builds} />);

    expect(await screen.findByText(/xcodebuild exited 65/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Build .ipa" }));
    expect(builds.start).toHaveBeenCalledTimes(1);
  });

  it("never renders a runId or GitHub Actions run link — BuildsBlock's own Builds type omits runUrl", async () => {
    const builds = fakeBuilds({ list: vi.fn(async () => [build({ status: "done", runId: 42 })]) });
    render(<BuildsBlock builds={builds} />);

    await screen.findByRole("link", { name: "Download .ipa" });
    expect(screen.queryByText(/42/)).not.toBeInTheDocument();
    expect(screen.queryByText(/github/i)).not.toBeInTheDocument();
  });
});
