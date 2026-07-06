import TopBar from "@/components/TopBar";
import DesignSystemCatalogue from "@/components/design-system/DesignSystemCatalogue";

export const metadata = {
  title: "Svemir · Design system",
  description:
    "The svemir design system: foundations, atoms, molecules, and organisms - a peek into the process.",
};

/**
 * Public design-system catalogue. Lives in the main nav next to Research so
 * anyone can see the system (and the thinking behind it) as it evolves - svemir
 * doubles as a portfolio piece. Not gated: it's meant to be shared.
 */
export default function DesignSystemPage() {
  return (
    <>
      <TopBar />
      {/* Full-width, left-aligned to the same gutter as Blocks / Channels /
          Research (px-5 sm:px-8) rather than a centered max-width, so the pages
          share one side margin. */}
      <main className="min-h-[calc(100vh-3rem)] w-full px-5 pb-10 pt-5 sm:px-8">
        <DesignSystemCatalogue />
      </main>
    </>
  );
}
