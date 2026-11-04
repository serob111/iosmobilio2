import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Skip Next's own internals and static files. /p/[id] is still a regular locale-routed
  // page for now (its legacy editing UI is deleted in a later step of this migration,
  // replaced by a bare, locale-independent 410 Route Handler — the matcher is narrowed
  // then, not here).
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
