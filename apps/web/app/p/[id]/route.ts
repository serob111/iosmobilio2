/**
 * The old self-contained project editor (apps/web's own legacy /api/projects/[id]
 * routes + file storage, both removed) lived here. A bare Route Handler, not a
 * locale-scoped page: it needs no <html>/<body>/NextIntlClientProvider, and staying
 * outside app/[locale] means middleware.ts's matcher can exclude it from next-intl's
 * locale-prefixing entirely — an old bookmarked/shared /p/<id> link should 410
 * immediately, not get redirected to /en/p/<id> first.
 */
export async function GET(): Promise<Response> {
  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Mobilio</title>
  </head>
  <body style="font-family: system-ui, sans-serif; display: flex; min-height: 100vh; align-items: center; justify-content: center; text-align: center; margin: 0;">
    <div>
      <h1>This page no longer exists</h1>
      <p><a href="/">Go to Mobilio</a></p>
    </div>
  </body>
</html>`,
    { status: 410, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
