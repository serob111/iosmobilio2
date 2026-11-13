"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/authClient";

export default function LogoutPage() {
  const t = useTranslations("logout");
  const router = useRouter();

  useEffect(() => {
    authClient.signOut().finally(() => {
      router.push("/");
      router.refresh();
    });
  }, [router]);

  return <div className="flex flex-1 items-center justify-center text-zinc-600">{t("signingOut")}</div>;
}
