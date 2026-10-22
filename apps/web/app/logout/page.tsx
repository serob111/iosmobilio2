"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/authClient";

export default function LogoutPage() {
  const router = useRouter();

  useEffect(() => {
    authClient.signOut().finally(() => {
      router.push("/");
      router.refresh();
    });
  }, [router]);

  return (
    <div className="flex flex-1 items-center justify-center text-zinc-600">
      Выходим из аккаунта…
    </div>
  );
}
