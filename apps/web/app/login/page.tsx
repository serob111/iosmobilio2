"use client";

import { useState } from "react";
import { authClient } from "@/lib/authClient";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!email.trim()) return;
    setStatus("sending");
    try {
      await authClient.signIn.magicLink({ email, callbackURL: window.location.origin });
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  }

  async function handleGoogle() {
    await authClient.signIn.social({ provider: "google", callbackURL: window.location.origin });
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-[#F3F0FF] px-4 py-12">
      <main className="w-full max-w-sm rounded-[28px] bg-white p-8 text-center shadow-sm">
        <h1 className="font-[family-name:var(--font-unbounded)] text-2xl font-extrabold tracking-tight text-[#17112E]">
          Вход в Mobilio
        </h1>
        <p className="mt-2 text-sm text-[#55506A]">
          Войдите по ссылке на почту или через Google
        </p>

        {status === "sent" ? (
          <p className="mt-8 rounded-2xl bg-[#F3F0FF] p-4 text-sm text-[#17112E]">
            Проверьте почту {email} — мы отправили ссылку для входа.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
            <input
              type="email"
              required
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={status === "sending"}
              className="w-full rounded-full border border-zinc-300 px-4 py-3 text-base text-[#17112E] outline-none focus:border-[#4B2BE0] disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={status === "sending" || !email.trim()}
              className="w-full rounded-full bg-[#4B2BE0] px-4 py-3 text-base font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {status === "sending" ? "Отправляем…" : "Отправить ссылку для входа"}
            </button>
            {status === "error" ? (
              <p className="text-sm text-red-600">Не удалось отправить ссылку. Попробуйте ещё раз.</p>
            ) : null}
          </form>
        )}

        <div className="mt-6 flex items-center gap-3 text-xs uppercase text-zinc-400">
          <span className="h-px flex-1 bg-zinc-200" />
          или
          <span className="h-px flex-1 bg-zinc-200" />
        </div>

        <button
          type="button"
          onClick={handleGoogle}
          className="mt-6 w-full rounded-full border border-zinc-300 px-4 py-3 text-base font-semibold text-[#17112E] hover:bg-zinc-50"
        >
          Войти через Google
        </button>
      </main>
    </div>
  );
}
