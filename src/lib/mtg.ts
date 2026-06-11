// Scryfall + EDHREC helpers. Both APIs are public, no key required.

export type Format = "commander" | "standard" | "modern";
export type ManaColor = "W" | "U" | "B" | "R" | "G";

export const FORMAT_LABELS: Record<Format, string> = {
  commander: "Commander (EDH)",
  standard: "Standard",
  modern: "Modern",
};

export const COLOR_INFO: Record<ManaColor, { name: string; symbol: string; token: string }> = {
  W: { name: "White", symbol: "☀", token: "var(--mana-w)" },
  U: { name: "Blue", symbol: "💧", token: "var(--mana-u)" },
  B: { name: "Black", symbol: "☠", token: "var(--mana-b)" },
  R: { name: "Red", symbol: "🔥", token: "var(--mana-r)" },
  G: { name: "Green", symbol: "🌿", token: "var(--mana-g)" },
};

export const ARCHETYPES = [
  { id: "aggro", name: "Aggro", desc: "Fast creatures, early pressure" },
  { id: "control", name: "Control", desc: "Counter, remove, win late" },
  { id: "midrange", name: "Midrange", desc: "Efficient threats and answers" },
  { id: "combo", name: "Combo", desc: "Assemble a winning interaction" },
  { id: "tokens", name: "Tokens", desc: "Go wide with creature swarms" },
  { id: "ramp", name: "Ramp", desc: "Big mana into huge threats" },
  { id: "tribal", name: "Tribal", desc: "Creature-type synergies" },
  { id: "voltron", name: "Voltron", desc: "Suit up one big threat" },
  { id: "reanimator", name: "Reanimator", desc: "Cheat big things into play" },
] as const;

export type ScryfallCard = {
  id: string;
  name: string;
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  image_uris?: { small?: string; normal?: string; art_crop?: string };
  card_faces?: Array<{ image_uris?: { small?: string; normal?: string; art_crop?: string }; name?: string }>;
  prices?: { usd?: string | null };
  scryfall_uri?: string;
};

const SCRY = "https://api.scryfall.com";

async function scry<T>(path: string): Promise<T> {
  const res = await fetch(`${SCRY}${path}`);
  if (!res.ok) throw new Error(`Scryfall ${res.status}`);
  return res.json() as Promise<T>;
}

export function cardImage(c: ScryfallCard): string | undefined {
  return c.image_uris?.normal || c.card_faces?.[0]?.image_uris?.normal;
}

export function cardArt(c: ScryfallCard): string | undefined {
  return c.image_uris?.art_crop || c.card_faces?.[0]?.image_uris?.art_crop;
}

// Weights for priority-ordered archetypes: first is heaviest.
// e.g. 3 archetypes -> [3, 2, 1] => 50% / 33% / 17%.
function priorityWeights(n: number): number[] {
  const raw = Array.from({ length: n }, (_, i) => n - i);
  const sum = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => w / sum);
}

// Split a target count across N priorities (largest first, sums to total).
function splitByPriority(total: number, n: number): number[] {
  if (n <= 0) return [];
  const weights = priorityWeights(n);
  const parts = weights.map((w) => Math.floor(w * total));
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % n, remainder--) parts[i] += 1;
  return parts;
}

// Suggest commanders matching the user's choices.
// Archetypes are priority-ordered: first selected has the biggest impact.
export async function suggestCommanders(opts: {
  colors: ManaColor[];
  archetypes: string[];
  budget?: number;
}): Promise<ScryfallCard[]> {
  const baseParts = ["is:commander", "game:paper"];
  if (opts.colors.length) {
    baseParts.push(`id:${opts.colors.join("").toLowerCase() || "c"}`);
  }
  if (opts.budget) baseParts.push(`usd<=${Math.max(1, Math.floor(opts.budget / 20))}`);
  // Loosely tie archetype to a keyword for commander discovery.
  const archKeyword: Record<string, string> = {
    aggro: "haste",
    control: "counter",
    midrange: "",
    combo: "infinite",
    tokens: "token",
    ramp: "ramp",
    tribal: "tribal",
    voltron: "equipment",
    reanimator: "graveyard",
  };
  const kws = opts.archetypes.map((a) => archKeyword[a]).filter(Boolean);
  // Query per priority and merge; first archetype contributes most.
  const TOTAL = 9;
  if (kws.length === 0) {
    const q = encodeURIComponent(baseParts.join(" "));
    const data = await scry<{ data: ScryfallCard[] }>(
      `/cards/search?q=${q}&order=edhrec&unique=cards&page=1`,
    );
    return data.data.slice(0, TOTAL);
  }
  const shares = splitByPriority(TOTAL, kws.length);
  const seen = new Set<string>();
  const out: ScryfallCard[] = [];
  for (let i = 0; i < kws.length; i++) {
    const want = shares[i];
    if (want <= 0) continue;
    const parts = [...baseParts, `o:${kws[i]}`];
    const q = encodeURIComponent(parts.join(" "));
    try {
      const data = await scry<{ data: ScryfallCard[] }>(
        `/cards/search?q=${q}&order=edhrec&unique=cards&page=1`,
      );
      let added = 0;
      for (const c of data.data) {
        if (added >= want) break;
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        out.push(c);
        added++;
      }
    } catch {}
  }
  return out.slice(0, TOTAL);
}


// Build a Commander (100-card) decklist using Scryfall searches per role.
export async function buildCommanderDeck(opts: {
  commander: ScryfallCard;
  archetypes: string[];
  budget?: number;
  powerLevel: number; // 1-10
}): Promise<{ commander: ScryfallCard; cards: ScryfallCard[] }> {
  const ci = (opts.commander.color_identity ?? []).join("").toLowerCase() || "c";
  const budgetPer = opts.budget ? Math.max(0.25, opts.budget / 100) : undefined;
  const priceClause = budgetPer ? ` usd<=${budgetPer.toFixed(2)}` : "";
  const power = opts.powerLevel;

  const archKw: Record<string, string[]> = {
    aggro: ["haste", "attack"],
    control: ["counter", "destroy"],
    midrange: ["value", "draw"],
    combo: ["search", "tutor"],
    tokens: ["token", "create"],
    ramp: ["ramp", "mana"],
    tribal: ["creature", "lord"],
    voltron: ["equipment", "aura"],
    reanimator: ["graveyard", "return"],
  };
  // Priority-ordered list of archetype theme words (first archetype first).
  const archThemes: string[] = opts.archetypes
    .map((a) => (archKw[a] ?? [])[0])
    .filter(Boolean) as string[];

  // EDH staples by role with target counts.
  const roles: Array<{ base: string; count: number; themed: boolean }> = [
    { base: `id<=${ci} t:creature${priceClause} f:commander`, count: 28, themed: true },
    { base: `id<=${ci} (t:instant or t:sorcery)${priceClause} f:commander`, count: 14, themed: true },
    { base: `id<=${ci} t:artifact -t:creature${priceClause} f:commander o:"add"`, count: 10, themed: false },
    { base: `id<=${ci} t:enchantment -t:creature${priceClause} f:commander`, count: 8, themed: false },
    { base: `id<=${ci} t:planeswalker${priceClause} f:commander`, count: 2, themed: false },
  ];

  const seen = new Set<string>([opts.commander.id, opts.commander.name]);
  const picked: ScryfallCard[] = [];
  const order = power >= 7 ? "edhrec" : "released";

  async function fillRole(query: string, want: number): Promise<number> {
    if (want <= 0) return 0;
    try {
      const q = encodeURIComponent(query);
      const data = await scry<{ data: ScryfallCard[] }>(
        `/cards/search?q=${q}&order=${order}&unique=cards`,
      );
      let added = 0;
      for (const c of data.data) {
        if (added >= want) break;
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        picked.push(c);
        added++;
      }
      return added;
    } catch {
      return 0;
    }
  }

  for (const role of roles) {
    if (!role.themed || archThemes.length === 0) {
      await fillRole(role.base, role.count);
      continue;
    }
    const shares = splitByPriority(role.count, archThemes.length);
    let unfilled = 0;
    for (let i = 0; i < archThemes.length; i++) {
      const want = shares[i] + unfilled;
      const got = await fillRole(`${role.base} o:${archThemes[i]}`, want);
      unfilled = want - got;
    }
    if (unfilled > 0) await fillRole(role.base, unfilled);
  }


  // Lands: fill remainder with basics matching color identity.
  const basicNames: Record<string, string> = {
    w: "Plains", u: "Island", b: "Swamp", r: "Mountain", g: "Forest",
  };
  const colors = ci === "c" ? [] : ci.split("");
  const remainder = Math.max(0, 99 - picked.length);
  if (colors.length === 0) {
    // colorless: wastes
    try {
      const w = await scry<ScryfallCard>(`/cards/named?exact=Wastes`);
      for (let i = 0; i < remainder; i++) picked.push({ ...w, id: `${w.id}-${i}` });
    } catch {}
  } else {
    const perColor = Math.floor(remainder / colors.length);
    let leftover = remainder - perColor * colors.length;
    for (const col of colors) {
      try {
        const land = await scry<ScryfallCard>(`/cards/named?exact=${basicNames[col]}`);
        const n = perColor + (leftover-- > 0 ? 1 : 0);
        for (let i = 0; i < n; i++) picked.push({ ...land, id: `${land.id}-${i}` });
      } catch {}
    }
  }

  return { commander: opts.commander, cards: picked.slice(0, 99) };
}

// Constructed (60-card) for Standard/Modern.
export async function buildConstructedDeck(opts: {
  format: Format;
  colors: ManaColor[];
  archetypes: string[];
  budget?: number;
}): Promise<{ commander: null; cards: ScryfallCard[] }> {
  const ci = opts.colors.join("").toLowerCase() || "c";
  const budgetPer = opts.budget ? Math.max(0.25, opts.budget / 60) : undefined;
  const priceClause = budgetPer ? ` usd<=${budgetPer.toFixed(2)}` : "";
  const fmt = `f:${opts.format}`;

  const archKw: Record<string, string> = {
    aggro: "haste", control: "counter", midrange: "", combo: "search",
    tokens: "token", ramp: "ramp", tribal: "creature", voltron: "equipment",
    reanimator: "graveyard",
  };
  const kws = opts.archetypes
    .map((a) => archKw[a])
    .filter(Boolean);
  const themeQ = kws.length
    ? ` (${kws.map((kw) => `o:${kw}`).join(" or ")})`
    : "";

  const roles: Array<{ q: string; count: number }> = [
    { q: `${fmt} id<=${ci} t:creature${themeQ}${priceClause}`, count: 20 },
    { q: `${fmt} id<=${ci} (t:instant or t:sorcery)${themeQ}${priceClause}`, count: 12 },
    { q: `${fmt} id<=${ci} (t:artifact or t:enchantment) -t:creature${priceClause}`, count: 4 },
  ];

  const seen = new Set<string>();
  const picked: ScryfallCard[] = [];
  for (const role of roles) {
    try {
      const q = encodeURIComponent(role.q);
      const data = await scry<{ data: ScryfallCard[] }>(
        `/cards/search?q=${q}&order=edhrec&unique=cards`,
      );
      let added = 0;
      for (const c of data.data) {
        if (added >= role.count) break;
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        // Constructed allows 4-ofs
        const copies = Math.min(4, role.count - added);
        for (let i = 0; i < copies && added < role.count; i++) {
          picked.push({ ...c, id: `${c.id}-${i}` });
          added++;
        }
      }
    } catch {}
  }

  // Lands: 24 basics distributed across colors.
  const basicNames: Record<string, string> = {
    w: "Plains", u: "Island", b: "Swamp", r: "Mountain", g: "Forest",
  };
  const colors = ci === "c" ? [] : ci.split("");
  const landCount = 24;
  if (colors.length === 0) {
    try {
      const w = await scry<ScryfallCard>(`/cards/named?exact=Wastes`);
      for (let i = 0; i < landCount; i++) picked.push({ ...w, id: `${w.id}-l${i}` });
    } catch {}
  } else {
    const per = Math.floor(landCount / colors.length);
    let extra = landCount - per * colors.length;
    for (const col of colors) {
      try {
        const land = await scry<ScryfallCard>(`/cards/named?exact=${basicNames[col]}`);
        const n = per + (extra-- > 0 ? 1 : 0);
        for (let i = 0; i < n; i++) picked.push({ ...land, id: `${land.id}-l${col}${i}` });
      } catch {}
    }
  }

  return { commander: null, cards: picked.slice(0, 60) };
}

export function deckToText(commander: ScryfallCard | null, cards: ScryfallCard[]): string {
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const lines: string[] = [];
  if (commander) {
    lines.push("// Commander");
    lines.push(`1 ${commander.name}`);
    lines.push("");
    lines.push("// Deck");
  }
  for (const [name, n] of counts) lines.push(`${n} ${name}`);
  return lines.join("\n");
}
