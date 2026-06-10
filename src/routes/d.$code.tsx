import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { getDeckByCode } from "@/lib/decks.functions";
import { FORMAT_LABELS, cardArt, cardImage, type ScryfallCard } from "@/lib/mtg";

const deckQuery = (code: string) =>
  queryOptions({
    queryKey: ["deck", code],
    queryFn: () => getDeckByCode({ data: { code } }),
  });

export const Route = createFileRoute("/d/$code")({
  loader: async ({ params, context }) => {
    const data = await context.queryClient.ensureQueryData(deckQuery(params.code));
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.commander_name ?? "Deck"} — Spellforge` },
      {
        name: "description",
        content: `${FORMAT_LABELS[(loaderData?.format ?? "commander") as keyof typeof FORMAT_LABELS] ?? loaderData?.format} deck · ${loaderData?.card_count ?? 0} cards · ~$${Number(loaderData?.price_usd ?? 0).toFixed(2)}.`,
      },
      { property: "og:title", content: `${loaderData?.commander_name ?? "Spellforge Deck"} — Spellforge` },
      { property: "og:image", content: loaderData?.commander_image ?? "" },
    ],
  }),
  component: DeckPage,
  errorComponent: ({ error }) => (
    <Centered title="Couldn't load this deck" subtitle={error.message} />
  ),
  notFoundComponent: () => (
    <Centered title="Deck not found" subtitle="That share code doesn't match any saved deck." />
  ),
});

function Centered({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <h1 className="font-display text-3xl text-gold">{title}</h1>
      {subtitle && <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>}
      <Link to="/" className="mt-6 rounded-md bg-gold px-4 py-2 text-sm text-primary-foreground shadow-arcane">
        Forge a new deck
      </Link>
    </div>
  );
}

function DeckPage() {
  const { code } = Route.useParams();
  const { data } = useSuspenseQuery(deckQuery(code));
  if (!data) return null;

  const payload = data.payload as { commander: ScryfallCard | null; cards: ScryfallCard[] };
  const commander = payload.commander;
  const cards = payload.cards ?? [];

  const grouped = new Map<string, { card: ScryfallCard; count: number }>();
  for (const c of cards) {
    const cur = grouped.get(c.name);
    if (cur) cur.count += 1;
    else grouped.set(c.name, { card: c, count: 1 });
  }
  const groupedList = [...grouped.values()].sort(
    (a, b) => (a.card.type_line ?? "").localeCompare(b.card.type_line ?? "") ||
              a.card.name.localeCompare(b.card.name),
  );

  return (
    <div className="min-h-screen bg-arcane">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
          <Link to="/" className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-7 w-7 rounded-full bg-gold shadow-arcane" />
            <span className="font-display text-xl tracking-wide">Spellforge</span>
          </Link>
          <span className="text-xs uppercase tracking-widest text-muted-foreground">
            Share code · <span className="text-foreground">{data.share_code}</span>
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-4 py-10">
        <header>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {FORMAT_LABELS[data.format as keyof typeof FORMAT_LABELS] ?? data.format} · {data.archetype} ·
            {" "}{data.card_count} cards · ~${Number(data.price_usd).toFixed(2)}
          </div>
          <h1 className="mt-1 font-display text-3xl text-gold sm:text-4xl">
            {commander?.name ?? "Saved Deck"}
          </h1>
        </header>

        {commander && (
          <div className="flex flex-col gap-6 rounded-2xl border border-primary/40 bg-card p-6 shadow-arcane sm:flex-row">
            {cardImage(commander) && (
              <img src={cardImage(commander)} alt={commander.name} className="w-48 rounded-lg shadow-card-elev" />
            )}
            <div className="flex-1">
              <div className="text-xs uppercase tracking-widest text-primary">Commander</div>
              <h2 className="mt-1 font-display text-2xl">{commander.name}</h2>
              <div className="text-sm text-muted-foreground">{commander.type_line}</div>
              <p className="mt-3 whitespace-pre-line text-sm text-foreground/90">{commander.oracle_text}</p>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groupedList.map(({ card, count }) => (
            <a key={card.name} href={card.scryfall_uri} target="_blank" rel="noreferrer"
               className="flex gap-3 overflow-hidden rounded-lg border border-border bg-card p-2 transition hover:border-primary">
              {cardArt(card) ? (
                <img src={cardArt(card)} alt="" loading="lazy" className="h-16 w-16 flex-none rounded object-cover" />
              ) : <div className="h-16 w-16 flex-none rounded bg-muted" />}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <div className="truncate font-medium">{card.name}</div>
                  <div className="text-xs text-muted-foreground">×{count}</div>
                </div>
                <div className="truncate text-xs text-muted-foreground">{card.type_line}</div>
              </div>
            </a>
          ))}
        </div>
      </main>
    </div>
  );
}
