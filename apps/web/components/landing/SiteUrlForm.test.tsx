// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { http, HttpResponse } from "msw";
import { server } from "../../test/mocks/server";
import messages from "../../messages/en.json";

const push = vi.fn();
vi.mock("@/i18n/navigation", () => ({ useRouter: () => ({ push }) }));

const { SiteUrlForm } = await import("./SiteUrlForm");

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <SiteUrlForm />
    </NextIntlClientProvider>,
  );
}

// jsdom doesn't reliably dispatch a 'submit' event from a native button click
// (https://github.com/jsdom/jsdom/issues/1937), unlike every real browser Playwright's
// e2e suite drives — so these tests submit the form directly rather than clicking the
// button, to exercise handleSubmit without fighting that jsdom gap.
describe("SiteUrlForm", () => {
  beforeEach(() => push.mockClear());

  it("creates a draft and navigates to /try on submit", async () => {
    server.use(http.post("http://localhost:3011/drafts", () => HttpResponse.json({ ok: true })));
    const { container } = renderForm();

    await userEvent.type(screen.getByPlaceholderText(messages.home.urlPlaceholder), "lumenstore.com");
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/try"));
  });

  it("shows an error message and stays put when the api rejects the url", async () => {
    server.use(
      http.post("http://localhost:3011/drafts", () =>
        HttpResponse.json({ error: { code: "INVALID_URL", message: "bad" } }, { status: 400 }),
      ),
    );
    const { container } = renderForm();

    await userEvent.type(screen.getByPlaceholderText(messages.home.urlPlaceholder), "not a url");
    fireEvent.submit(container.querySelector("form")!);

    await screen.findByText(messages.errors.INVALID_URL);
    expect(push).not.toHaveBeenCalled();
  });

  it("does not submit an empty address", () => {
    const { container } = renderForm();
    fireEvent.submit(container.querySelector("form")!);
    expect(push).not.toHaveBeenCalled();
  });
});
