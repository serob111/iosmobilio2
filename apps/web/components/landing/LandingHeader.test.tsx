// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import messages from "../../messages/en.json";

const push = vi.fn();
const refresh = vi.fn();
const signOut = vi.fn();
vi.mock("@/i18n/navigation", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
  usePathname: () => "/",
  useRouter: () => ({ push, refresh }),
}));
vi.mock("@/lib/authClient", () => ({ authClient: { signOut: () => signOut() } }));

const { LandingHeader } = await import("./LandingHeader");

function renderHeader() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LandingHeader nav={<a href="#how">How it works</a>} startFreeLabel="Start free" />
    </NextIntlClientProvider>,
  );
}

describe("LandingHeader", () => {
  it("shows the marketing sign-in link when signed out", async () => {
    server.use(http.get("http://localhost:3011/me", () => new HttpResponse(null, { status: 401 })));
    renderHeader();
    await screen.findByRole("link", { name: "Sign in" });
    expect(screen.getByRole("link", { name: "Start free" })).toBeVisible();
  });

  it("shows the account bar — org switcher, email, sign out — when signed in", async () => {
    server.use(
      http.get("http://localhost:3011/me", () =>
        HttpResponse.json({
          user: { id: "u1", name: "Anna", email: "anna@lumenstore.com" },
          organizations: [{ id: "org-1", name: "Lumen Store", slug: "lumen-store", role: "owner" }],
        }),
      ),
    );
    renderHeader();

    await screen.findByText("anna@lumenstore.com");
    expect(screen.getByRole("option", { name: "Lumen Store" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
