export type LegalDocumentId = "terms" | "privacy" | "refunds";
export type LegalConfig = { company: string; address: string; email: string };
export type LegalDocument = {
  title: string;
  effective: string;
  updated: string;
  summaryTitle: string;
  summary: string;
  sections: { title: string; paragraphs: string[] }[];
};
export type LegalBundle = {
  mainNav: string;
  pricing: string;
  signIn: string;
  legalNav: string;
  documents: Record<LegalDocumentId, LegalDocument>;
};
