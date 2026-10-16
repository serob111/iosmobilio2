"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!url.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось создать приложение");
        setLoading(false);
        return;
      }
      router.push(`/p/${data.id}`);
    } catch {
      setError("Не удалось связаться с сервером");
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4">
      <main className="w-full max-w-md text-center">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
          Mobilio
        </h1>
        <p className="mt-2 text-zinc-600">
          Превратите ваш сайт в приложение для iPhone за минуту
        </p>

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
          <input
            type="text"
            inputMode="url"
            placeholder="Адрес вашего сайта, например example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            className="w-full rounded-xl border border-zinc-300 px-4 py-3 text-base text-zinc-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-60"
          />
          <button
            type="submit"
            disabled={loading || !url.trim()}
            className="w-full rounded-xl bg-blue-600 px-4 py-3 text-base font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Анализируем сайт…" : "Создать приложение"}
          </button>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </form>
      </main>
    </div>
  );
}
