import { useState } from "react";
import SaveDeckDialog from "@/components/SaveDeckDialog";
import {
  ARCHETYPES,
  COLOR_INFO,
  FORMAT_LABELS,
  buildCommanderDeck,
  buildConstructedDeck,
  cardArt,
  cardImage,
  deckToText,
  suggestCommanders,
  type Format,
  type ManaColor,
  type ScryfallCard,
} from "@/lib/mtg";

type Step = "format" | "archetype" | "options" | "commanders" | "deck";

const ALL_STEPS: Step[] = ["format", "archetype", "options", "commanders", "deck"];
const COLORS: ManaColor[] = ["W", "U", "B", "R", "G"];

function stepIndex(s: Step, format: Format): number {
  const steps: Step[] = [
    "format",
    "archetype",
    "options",
    ...(format === "commander" ? ["commanders" as Step] : []),
    "deck",
  ];
  return steps.indexOf(s);
}

export default function DeckBuilder() {
  const [step, setStep] = useState<Step>("format");
  const [furthestStepIndex, setFurthestStepIndex] = useState(0);
  const [format, setFormat] = useState<Format>("commander");
  const [archetypes, setArchetypes] = useState<string[]>([]);
  const [colors, setColors] = useState<ManaColor[]>([]);
  const [budget, setBudget] = useState<number | "">("");
  const [bracket, setBracket] = useState<number>(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commanders, setCommanders] = useState<ScryfallCard[]>([]);
  const [chosenCommander, setChosenCommander] = useState<ScryfallCard | null>(null);
  const [deck, setDeck] = useState<{ commander: ScryfallCard | null; cards: ScryfallCard[] } | null>(null);

  const currentIdx = stepIndex(step, format);

  function advanceTo(nextStep: Step) {
    setStep(nextStep);
    setFurthestStepIndex((cur) => Math.max(cur, stepIndex(nextStep, format)));
  }

  function goToStep(targetStep: Step) {
    const targetIdx = stepIndex(targetStep, format);
    if (targetIdx > furthestStepIndex) return; // can't jump forward past earned progress
    setStep(targetStep);
  }

  function invalidateFrom(stepName: Step) {
    const idx = stepIndex(stepName, format);
    setFurthestStepIndex((cur) => Math.min(cur, idx));
  }

  function clearDownstream(fromStep: Step) {
    if (fromStep === "format") {
      setArchetypes([]);
      setColors([]);
      setBudget("");
      setPower(6);
    }
    if (["format", "archetype", "options"].includes(fromStep)) {
      setCommanders([]);
      setChosenCommander(null);
      setDeck(null);
    }
  }

  const handleSetFormat = (f: Format) => {
    setFormat(f);
    if (step === "format") {
      invalidateFrom("format");
      clearDownstream("format");
    }
  };

  const toggleColor = (c: ManaColor) => {
    setColors((cur) => {
      const next = cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c];
      return next;
    });
    if (step === "options") {
      invalidateFrom("options");
      clearDownstream("options");
    }
  };

  const toggleArchetype = (id: string) => {
    setArchetypes((cur) => {
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      return next;
    });
    if (step === "archetype") {
      invalidateFrom("archetype");
      clearDownstream("archetype");
    }
  };

  const handleSetBudget = (v: number | "") => {
    setBudget(v);
    if (step === "options") {
      invalidateFrom("options");
      clearDownstream("options");
    }
  };

  const handleSetPower = (v: number) => {
    setPower(v);
    if (step === "options") {
      invalidateFrom("options");
      clearDownstream("options");
    }
  };

  async function fetchCommanders() {
    setLoading(true); setError(null);
    try {
      const cs = await suggestCommanders({
        colors,
        archetypes,
        budget: typeof budget === "number" ? budget : undefined,
      });
      setCommanders(cs);
      advanceTo("commanders");
    } catch (e) {
      setError("Couldn't reach Scryfall. Try again in a moment.");
    } finally { setLoading(false); }
  }

  async function generateDeck(commander?: ScryfallCard) {
    setLoading(true); setError(null);
    try {
      if (format === "commander") {
        const cmd = commander ?? chosenCommander;
        if (!cmd) throw new Error("No commander");
        setChosenCommander(cmd);
        const d = await buildCommanderDeck({
          commander: cmd,
          archetypes,
          budget: typeof budget === "number" ? budget : undefined,
          powerLevel: power,
        });
        setDeck(d);
      } else {
        const d = await buildConstructedDeck({
          format,
          colors,
          archetypes,
          budget: typeof budget === "number" ? budget : undefined,
        });
        setDeck(d);
      }
      advanceTo("deck");
    } catch (e) {
      setError("Deck build failed. Try different parameters.");
    } finally { setLoading(false); }
  }

  function reset(toStep: Step = "format") {
    setStep(toStep);
    setDeck(null);
    setChosenCommander(null);
    setCommanders([]);
    if (toStep === "format") {
      setArchetypes([]); setColors([]); setBudget(""); setPower(6);
      setFurthestStepIndex(0);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:py-16">
      <Stepper step={step} format={format} furthestStepIndex={furthestStepIndex} onStepClick={goToStep} />

      {error && (
        <div className="mb-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive-foreground">
          {error}
        </div>
      )}

      {step === "format" && (
        <Section title="Choose your format" subtitle="Where will you cast spells?">
          <div className="grid gap-4 sm:grid-cols-3">
            {(Object.keys(FORMAT_LABELS) as Format[]).map((f) => (
              <button
                key={f}
                onClick={() => handleSetFormat(f)}
                className={`group relative overflow-hidden rounded-xl border bg-card p-6 text-left transition hover:border-primary hover:shadow-arcane ${
                  format === f ? "border-primary ring-1 ring-primary" : "border-border"
                }`}
              >
                <div className="text-xs uppercase tracking-widest text-muted-foreground">Format</div>
                <div className="mt-2 font-display text-2xl text-foreground">{FORMAT_LABELS[f]}</div>
                <div className="mt-2 text-sm text-muted-foreground">
                  {f === "commander" && "100-card singleton, one legendary commander"}
                  {f === "standard" && "60-card decks, current rotation sets"}
                  {f === "modern" && "60-card decks, deep card pool from 2003+"}
                </div>
              </button>
            ))}
          </div>
          <NavRow
            onBack={undefined}
            next={
              <button
                onClick={() => advanceTo("archetype")}
                disabled={!format}
                className="rounded-md bg-gold px-6 py-3 font-display text-primary-foreground shadow-arcane transition hover:opacity-90 disabled:opacity-50"
              >
                Next
              </button>
            }
          />
        </Section>
      )}

      {step === "archetype" && (
        <Section title="Pick your playstyles" subtitle="Click to add. The order you pick sets the priority — #1 has the biggest impact on the deck.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ARCHETYPES.map((a) => {
              const priority = archetypes.indexOf(a.id);
              const active = priority >= 0;
              return (
                <button
                  key={a.id}
                  onClick={() => toggleArchetype(a.id)}
                  className={`rounded-lg border bg-card p-4 text-left transition hover:border-primary hover:bg-secondary ${
                    active ? "border-primary ring-1 ring-primary" : "border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="font-display text-lg">{a.name}</div>
                    {active && (
                      <span
                        title={`Priority ${priority + 1}`}
                        className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
                      >
                        {priority + 1}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{a.desc}</div>
                </button>
              );
            })}
          </div>
          <NavRow
            onBack={() => goToStep("format")}
            next={
              <button
                onClick={() => advanceTo("options")}
                disabled={archetypes.length === 0}
                className="rounded-md bg-gold px-6 py-3 font-display text-primary-foreground shadow-arcane transition hover:opacity-90 disabled:opacity-50"
              >
                Next {archetypes.length > 0 && `(${archetypes.length} selected)`}
              </button>
            }
          />
        </Section>
      )}


      {step === "options" && (
        <Section title="Refine (optional)" subtitle="All optional. Skip to see what the planeswalkers suggest.">
          <div className="grid gap-6 rounded-xl border border-border bg-card p-6">
            <Field label="Colors" hint="Leave blank to let your commander decide.">
              <div className="flex flex-wrap gap-2">
                {COLORS.map((c) => {
                  const active = colors.includes(c);
                  return (
                    <button
                      key={c}
                      onClick={() => toggleColor(c)}
                      className="flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition"
                      style={{
                        borderColor: active ? COLOR_INFO[c].token : "var(--border)",
                        background: active ? `color-mix(in oklab, ${COLOR_INFO[c].token} 25%, transparent)` : "transparent",
                        color: active ? "var(--foreground)" : "var(--muted-foreground)",
                      }}
                    >
                      <span
                        className="inline-block h-4 w-4 rounded-full"
                        style={{ background: COLOR_INFO[c].token }}
                      />
                      {COLOR_INFO[c].name}
                    </button>
                  );
                })}
              </div>
            </Field>

            <Field label="Budget (USD)" hint="Total deck price ceiling. Leave blank for no limit.">
              <input
                type="number"
                min={0}
                value={budget}
                onChange={(e) => handleSetBudget(e.target.value === "" ? "" : Number(e.target.value))}
                placeholder="e.g. 100"
                className="w-full max-w-xs rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </Field>

            {format === "commander" && (
              <Field label={`Power level: ${power}`} hint="1 = ultra-casual · 10 = cEDH">
                <input
                  type="range" min={1} max={10} value={power}
                  onChange={(e) => handleSetPower(Number(e.target.value))}
                  className="w-full max-w-md accent-[var(--primary)]"
                />
              </Field>
            )}
          </div>
          <NavRow
            onBack={() => goToStep("archetype")}
            next={
              <button
                onClick={format === "commander" ? fetchCommanders : () => generateDeck()}
                disabled={loading}
                className="rounded-md bg-gold px-6 py-3 font-display text-primary-foreground shadow-arcane transition hover:opacity-90 disabled:opacity-50"
              >
                {loading ? "Summoning…" : format === "commander" ? "Suggest commanders" : "Build deck"}
              </button>
            }
          />
        </Section>
      )}

      {step === "commanders" && (
        <Section
          title="Choose your commander"
          subtitle="Tap one to forge the deck. Not feeling it? Tweak the parameters and try again."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {commanders.map((c) => (
              <button
                key={c.id}
                onClick={() => generateDeck(c)}
                disabled={loading}
                className="group overflow-hidden rounded-xl border border-border bg-card text-left transition hover:border-primary hover:shadow-arcane disabled:opacity-60"
              >
                {cardImage(c) ? (
                  <img src={cardImage(c)} alt={c.name} loading="lazy" className="w-full" />
                ) : (
                  <div className="aspect-[5/7] bg-muted" />
                )}
                <div className="p-3">
                  <div className="font-display text-base">{c.name}</div>
                  <div className="text-xs text-muted-foreground">{c.type_line}</div>
                </div>
              </button>
            ))}
          </div>
          {commanders.length === 0 && !loading && (
            <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground">
              No commanders matched. Try different colors or archetypes.
            </div>
          )}
          <NavRow
            onBack={() => goToStep("options")}
            next={
              <button
                onClick={fetchCommanders}
                disabled={loading}
                className="rounded-md border border-primary px-5 py-2.5 text-sm text-primary transition hover:bg-primary hover:text-primary-foreground disabled:opacity-50"
              >
                {loading ? "Reshuffling…" : "Refresh suggestions"}
              </button>
            }
          />
        </Section>
      )}

      {step === "deck" && deck && (
        <DeckView
          deck={deck}
          format={format}
          archetypes={archetypes}
          onRestart={() => reset("format")}
          onTweak={() => reset("options")}
        />
      )}

      {loading && step !== "commanders" && (
        <div className="mt-6 text-center text-sm text-muted-foreground">Consulting the multiverse…</div>
      )}
    </div>
  );
}

function Stepper({
  step, format, furthestStepIndex, onStepClick,
}: {
  step: Step;
  format: Format;
  furthestStepIndex: number;
  onStepClick: (s: Step) => void;
}) {
  const steps: Array<{ id: Step; label: string }> = [
    { id: "format", label: "Format" },
    { id: "archetype", label: "Playstyle" },
    { id: "options", label: "Refine" },
    ...(format === "commander" ? [{ id: "commanders" as Step, label: "Commander" }] : []),
    { id: "deck", label: "Deck" },
  ];
  const idx = steps.findIndex((s) => s.id === step);
  return (
    <ol className="mb-10 flex flex-wrap items-center gap-2 text-xs uppercase tracking-widest">
      {steps.map((s, i) => {
        const clickable = i <= furthestStepIndex;
        const active = i === idx;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <button
              onClick={() => clickable && onStepClick(s.id)}
              disabled={!clickable}
              className={`flex h-7 w-7 items-center justify-center rounded-full border transition ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : i <= idx
                  ? "border-primary/60 bg-primary/10 text-foreground"
                  : clickable
                  ? "border-border text-muted-foreground hover:border-primary hover:text-foreground"
                  : "border-border text-muted-foreground opacity-50"
              } ${clickable ? "cursor-pointer" : "cursor-default"}`}
            >
              {i + 1}
            </button>
            <button
              onClick={() => clickable && onStepClick(s.id)}
              disabled={!clickable}
              className={`transition ${
                active ? "text-foreground" : i <= idx ? "text-foreground/80" : "text-muted-foreground"
              } ${clickable ? "cursor-pointer hover:text-foreground" : "cursor-default opacity-50"}`}
            >
              {s.label}
            </button>
            {i < steps.length - 1 && <span className="mx-1 text-border">·</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-6">
      <header>
        <h2 className="font-display text-3xl text-foreground sm:text-4xl">{title}</h2>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <label className="font-display text-sm uppercase tracking-widest text-foreground">{label}</label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function NavRow({ onBack, next }: { onBack?: (() => void) | undefined; next?: React.ReactNode }) {
  return (
    <div className="mt-8 flex items-center justify-between">
      {onBack ? (
        <button onClick={onBack} className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground transition hover:border-primary hover:text-foreground">
          ← Previous
        </button>
      ) : <span />}
      {next}
    </div>
  );
}

function DeckView({
  deck, format, archetypes, onRestart, onTweak,
}: {
  deck: { commander: ScryfallCard | null; cards: ScryfallCard[] };
  format: Format;
  archetypes: string[];
  onRestart: () => void;
  onTweak: () => void;
}) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const total = deck.cards.length + (deck.commander ? 1 : 0);
  const price = deck.cards.reduce((s, c) => s + (parseFloat(c.prices?.usd ?? "0") || 0), 0)
    + (deck.commander ? parseFloat(deck.commander.prices?.usd ?? "0") || 0 : 0);

  // Group + dedupe for display
  const grouped = new Map<string, { card: ScryfallCard; count: number }>();
  for (const c of deck.cards) {
    const k = c.name;
    const cur = grouped.get(k);
    if (cur) cur.count += 1;
    else grouped.set(k, { card: c, count: 1 });
  }
  const groupedList = [...grouped.values()].sort((a, b) =>
    (a.card.type_line ?? "").localeCompare(b.card.type_line ?? "") || a.card.name.localeCompare(b.card.name),
  );

  function download() {
    const txt = deckToText(deck.commander, deck.cards);
    const blob = new Blob([txt], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(deck.commander?.name ?? "deck").replace(/\s+/g, "_")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const shareUrl = shareCode && typeof window !== "undefined"
    ? `${window.location.origin}/d/${shareCode}`
    : "";

  async function copyShare() {
    if (!shareUrl) return;
    try { await navigator.clipboard.writeText(shareUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch {}
  }

  return (
    <section className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            {FORMAT_LABELS[format]} · {archetypes.map((a) => ARCHETYPES.find((x) => x.id === a)?.name ?? a).join(" + ")} · {total} cards · ~${price.toFixed(2)}
          </div>
          <h2 className="mt-1 font-display text-3xl text-gold sm:text-4xl">
            {deck.commander?.name ?? "Your Deck"}
          </h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={onTweak} className="rounded-md border border-border px-4 py-2 text-sm hover:border-primary">
            Tweak parameters
          </button>
          <button onClick={download} className="rounded-md border border-border px-4 py-2 text-sm hover:border-primary">
            Export .txt
          </button>
          {!shareCode && (
            <button
              onClick={() => setSaveOpen(true)}
              className="rounded-md bg-gold px-4 py-2 text-sm text-primary-foreground shadow-arcane"
            >
              Save & share
            </button>
          )}
          <button onClick={onRestart} className="rounded-md border border-border px-4 py-2 text-sm hover:border-primary">
            Start over
          </button>
        </div>
      </header>

      {shareCode && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/50 bg-card p-4 shadow-arcane">
          <div className="text-xs uppercase tracking-widest text-primary">Saved · share code</div>
          <code className="rounded bg-background px-3 py-1 font-display text-lg tracking-widest text-gold">
            {shareCode}
          </code>
          <a
            href={`/d/${shareCode}`}
            target="_blank" rel="noreferrer"
            className="text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            open link
          </a>
          <button
            onClick={copyShare}
            className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs hover:border-primary"
          >
            {copied ? "Copied!" : "Copy URL"}
          </button>
        </div>
      )}

      {deck.commander && (
        <div className="flex flex-col gap-6 rounded-2xl border border-primary/40 bg-card p-6 shadow-arcane sm:flex-row">
          {cardImage(deck.commander) && (
            <img src={cardImage(deck.commander)} alt={deck.commander.name} className="w-48 rounded-lg shadow-card-elev" />
          )}
          <div className="flex-1">
            <div className="text-xs uppercase tracking-widest text-primary">Commander</div>
            <h3 className="mt-1 font-display text-2xl">{deck.commander.name}</h3>
            <div className="text-sm text-muted-foreground">{deck.commander.type_line}</div>
            <p className="mt-3 whitespace-pre-line text-sm text-foreground/90">{deck.commander.oracle_text}</p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {groupedList.map(({ card, count }) => (
          <a
            key={card.name}
            href={card.scryfall_uri}
            target="_blank" rel="noreferrer"
            className="group flex gap-3 overflow-hidden rounded-lg border border-border bg-card p-2 transition hover:border-primary"
          >
            {cardArt(card) ? (
              <img src={cardArt(card)} alt="" loading="lazy" className="h-16 w-16 flex-none rounded object-cover" />
            ) : (
              <div className="h-16 w-16 flex-none rounded bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <div className="truncate font-medium">{card.name}</div>
                <div className="text-xs text-muted-foreground">×{count}</div>
              </div>
              <div className="truncate text-xs text-muted-foreground">{card.type_line}</div>
              {card.prices?.usd && (
                <div className="text-xs text-primary/80">${card.prices.usd}</div>
              )}
            </div>
          </a>
        ))}
      </div>

      <SaveDeckDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        format={format}
        archetypes={archetypes}
        commander={deck.commander}
        cards={deck.cards}
        onSaved={(code) => { setShareCode(code); setSaveOpen(false); }}
      />
    </section>
  );
}
