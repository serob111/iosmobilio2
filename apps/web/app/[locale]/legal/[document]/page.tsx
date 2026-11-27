import { notFound } from "next/navigation";
import { LegalPage } from "../LegalPage";
import type { LegalDocumentId } from "../content/types";

const DOCUMENTS = new Set(["terms", "privacy", "refunds"]);

export default async function LegalDocumentPage({ params }: { params: Promise<{ locale: string; document: string }> }) {
  const { locale, document } = await params;
  if (!DOCUMENTS.has(document)) notFound();
  return <LegalPage locale={locale} documentId={document as LegalDocumentId} />;
}
