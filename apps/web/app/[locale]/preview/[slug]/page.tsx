import { notFound } from "next/navigation";
import { fetchPreviewDto } from "@/lib/apiClient";
import { PreviewShell } from "@/components/preview/PreviewShell";

type Props = {
  params: Promise<{ slug: string }>;
};

/**
 * Public, unauthenticated canonical preview page — the link QR codes point at and
 * createDraftPreviewLink()/createProjectPreviewLink() return. Server-rendered since
 * GET /preview/:slug needs no session/cookie; the sandboxed iframe + tab switching
 * themselves still need the client, which is why the actual rendering lives in
 * PreviewShell ("use client").
 */
export default async function PreviewPage({ params }: Props) {
  const { slug } = await params;
  const dto = await fetchPreviewDto(slug);
  if (!dto) {
    notFound();
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-4 py-8">
      <PreviewShell dto={dto} />
    </div>
  );
}
