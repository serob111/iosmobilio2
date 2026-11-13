import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip Next's own internals, static files, and /p/[id] — a bare, locale-independent
  // 410 Route Handler (app/p/[id]/route.ts), not a locale-scoped page, so an old
  // bookmarked /p/<id> link 410s immediately instead of first being redirected to
  // /en/p/<id> by this middleware.
  matcher: ["/((?!api|_next|_vercel|p/|.*\\..*).*)"],
};
