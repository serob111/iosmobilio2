import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin();

const nextConfig: NextConfig = {
  // cacheComponents/partialPrefetching (Next 16's experimental static-optimization
  // model) fight every page in this app: every route here is either a form, a
  // session/cookie-dependent view, or client-fetched data — none of it is ever
  // meaningfully static, so there's nothing for these flags to actually buy, and
  // next-intl's own navigation hooks (useRouter/Link, used on nearly every page) read
  // enough "dynamic" request data to make Cache Components refuse to prerender several
  // routes outright (a hard build error, not just a missed optimization).
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default withNextIntl(nextConfig);
