import Header from "@/components/Header";

/**
 * Part B (editor) territory — kept on the old plain Header deliberately. The design-web
 * pass (Part A) gives marketing/system pages their own page-specific header instead of a
 * global one (see app/[locale]/layout.tsx), so this route keeps its current look by
 * rendering the previous Header itself rather than inheriting nothing.
 */
export default function ProjectEditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
    </>
  );
}
