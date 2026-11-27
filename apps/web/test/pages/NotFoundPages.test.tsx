// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import en from "../../messages/en.json";

const notFound = vi.hoisted(() => vi.fn());

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "notFound" | "previewExpired") =>
    (key: string) => en[namespace][key as keyof (typeof en)[typeof namespace]],
}));
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}));
vi.mock("next/navigation", () => ({ notFound }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("not-found pages", () => {
  it("routes unmatched locale paths into the localized not-found boundary", async () => {
    const { default: UnmatchedLocaleRoute } = await import("../../app/[locale]/[...rest]/page");
    UnmatchedLocaleRoute();
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("renders the general 404 with recovery links", async () => {
    const { default: NotFoundPage } = await import("../../app/[locale]/not-found");
    render(await NotFoundPage());

    expect(screen.getByRole("heading", { name: "This page didn't make it into the app" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Go to my apps" })).toHaveAttribute("href", "/projects");
    expect(screen.getByRole("link", { name: "Home page" })).toHaveAttribute("href", "/");
  });

  it("renders the revoked-preview state with public and owner recovery actions", async () => {
    const { default: PreviewNotFound } = await import("../../app/[locale]/preview/[slug]/not-found");
    render(await PreviewNotFound());

    expect(screen.getByRole("heading", { name: "This preview link no longer works" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Make an app from your website" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  });
});
