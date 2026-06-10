import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getCaptcha, saveDeck } from "@/lib/decks.functions";
import type { ScryfallCard, Format } from "@/lib/mtg";

type Props = {
  open: boolean;
  onClose: () => void;
  format: Format;
  archetype: string;
  commander: ScryfallCard | null;
  cards: ScryfallCard[];
  onSaved: (shareCode: string) => void;
};

export default function SaveDeckDialog({
  open, onClose, format, archetype, commander, cards, onSaved,
}: Props) {
  const fetchCaptcha = useServerFn(getCaptcha);
  const submit = useServerFn(saveDeck);

  const [question, setQuestion] = useState("");
  const [token, setToken] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null); setAnswer("");
    try {
      const c = await fetchCaptcha();
      setQuestion(c.question);
      setToken(c.token);
    } catch {
      setError("Couldn't load captcha. Try again.");
    }
  }

  useEffect(() => { if (open) refresh(); /* eslint-disable-next-line */ }, [open]);

  if (!open) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const res = await submit({
        data: {
          captchaToken: token,
          captchaAnswer: answer.trim(),
          format, archetype,
          commander, cards,
        },
      });
      onSaved(res.shareCode);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Save failed";
      setError(msg.includes("Captcha") || msg.includes("Wrong") ? "Wrong answer. Try the new challenge." : msg);
      refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border border-primary/40 bg-card p-6 shadow-arcane"
      >
        <h3 className="font-display text-2xl text-gold">Save & share this deck</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          We'll generate a short share code anyone can use to view it. Prove you're a real planeswalker:
        </p>

        <div className="mt-5 rounded-lg border border-border bg-background p-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Challenge</div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="font-display text-2xl text-foreground">{question || "…"}</div>
            <button
              type="button" onClick={refresh}
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              new question
            </button>
          </div>
          <input
            type="text" inputMode="numeric" autoComplete="off"
            value={answer} onChange={(e) => setAnswer(e.target.value)}
            placeholder="Your answer"
            maxLength={10}
            className="mt-3 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>

        {error && (
          <div className="mt-3 text-sm text-destructive">{error}</div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button" onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm hover:border-primary"
          >Cancel</button>
          <button
            type="submit"
            disabled={loading || !answer || !token}
            className="rounded-md bg-gold px-5 py-2 text-sm text-primary-foreground shadow-arcane disabled:opacity-50"
          >
            {loading ? "Saving…" : "Save deck"}
          </button>
        </div>
      </form>
    </div>
  );
}
