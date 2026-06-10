import { createFileRoute } from "@tanstack/react-router";
import DeckBuilder from "@/components/DeckBuilder";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Spellforge — Open-source MTG Deck Builder" },
      {
        name: "description",
        content:
          "Build Commander, Standard, and Modern decks by choosing a format, playstyle, and a few preferences. Powered by Scryfall.",
      },
      { property: "og:title", content: "Spellforge — Open-source MTG Deck Builder" },
      {
        property: "og:description",
        content: "Pick a format and playstyle. We assemble a legal deck from the multiverse.",
      },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <div className="min-h-screen bg-arcane">
      <header className="border-b border-border/60 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
          <a href="/" className="flex items-center gap-2">
            <span
              aria-hidden
              className="inline-block h-7 w-7 rounded-full bg-gold shadow-arcane"
              style={{ boxShadow: "0 0 24px var(--primary)" }}
            />
            <span className="font-display text-xl tracking-wide">Spellforge</span>
          </a>
          <a
            href="https://scryfall.com"
            target="_blank" rel="noreferrer"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            Data · Scryfall
          </a>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-4 pt-12 sm:pt-20">
        <div className="max-w-3xl">
          <div className="text-xs uppercase tracking-[0.3em] text-primary/80">Open source · No login</div>
          <h1 className="mt-3 font-display text-4xl leading-tight text-foreground sm:text-6xl">
            Forge a deck from <span className="text-gold">the multiverse</span>.
          </h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
            Pick a format and a playstyle. Optionally narrow it by colors, budget,
            or power level. We pull legal cards from Scryfall and assemble a full
            decklist you can export and tweak.
          </p>
        </div>
      </section>

      <DeckBuilder />

      <footer className="border-t border-border/60 py-8 text-center text-xs text-muted-foreground">
        Card data and images via Scryfall · Magic: The Gathering © Wizards of the Coast ·
        Spellforge is unofficial and open source.
      </footer>
    </div>
  );
}
