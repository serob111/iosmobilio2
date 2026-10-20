"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ru">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-2 p-6 text-center">
          <h1 className="text-xl font-semibold text-zinc-900">Что-то пошло не так</h1>
          <p className="text-zinc-600">Попробуйте обновить страницу.</p>
        </div>
      </body>
    </html>
  );
}
