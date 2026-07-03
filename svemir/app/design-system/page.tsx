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
      <main className="mx-auto max-w-6xl px-6 py-10">
        <DesignSystemCatalogue />
      </main>
    </>
  );
}
