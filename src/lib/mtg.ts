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

// Weights for priority-ordered archetypes: first is heaviest, but secondaries
// still get a meaningful share. Uses a gentler decay so e.g. 3 archetypes
// split roughly 40% / 33% / 27% instead of 50% / 33% / 17%.
function priorityWeights(n: number): number[] {
  const raw = Array.from({ length: n }, (_, i) => n - i * 0.5);
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

// Free-text search for legendary commanders by name.
export async function searchCommanders(query: string): Promise<ScryfallCard[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const enc = encodeURIComponent(`is:commander game:paper ${q}`);
  try {
    const data = await scry<{ data: ScryfallCard[] }>(
      `/cards/search?q=${enc}&order=edhrec&unique=cards&page=1`,
    );
    return data.data.slice(0, 20);
  } catch {
    return [];
  }
}

// Free-text card search, optionally scoped to a format and color identity.
export async function searchCards(opts: {
  query: string;
  format: Format;
  colorIdentity?: string; // e.g. "wug" or "" for colorless
}): Promise<ScryfallCard[]> {
  const q = opts.query.trim();
  if (q.length < 2) return [];
  const parts = [q, "game:paper"];
  if (opts.format === "commander") parts.push("f:commander");
  else parts.push(`f:${opts.format}`);
  if (opts.colorIdentity !== undefined) {
    parts.push(`id<=${opts.colorIdentity || "c"}`);
  }
  const enc = encodeURIComponent(parts.join(" "));
  try {
    const data = await scry<{ data: ScryfallCard[] }>(
      `/cards/search?q=${enc}&order=edhrec&unique=cards&page=1`,
    );
    return data.data.slice(0, 24);
  } catch {
    return [];
  }
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
  const idClause = `id<=${ci}${priceClause} f:commander`;

  // Loose, broad theme keywords used for the LAST themed fill pass.
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
  const archThemes: string[] = opts.archetypes
    .map((a) => {
      const kws = archKw[a] ?? [];
      if (kws.length === 0) return "";
      if (kws.length === 1) return `o:${kws[0]}`;
      return `(${kws.map((k) => `o:${k}`).join(" or ")})`;
    })
    .filter(Boolean);

  // Strong, narrow archetype "core" queries — each guarantees N on-theme cards
  // BEFORE generic role filling, so e.g. a voltron deck actually gets equipment.
  const archCore: Record<string, Array<{ q: string; count: number }>> = {
    aggro: [{ q: `t:creature o:haste cmc<=3`, count: 8 }],
    control: [
      { q: `(t:instant or t:sorcery) o:counter o:spell`, count: 5 },
      { q: `(t:instant or t:sorcery) o:"destroy target"`, count: 3 },
    ],
    midrange: [{ q: `t:creature o:"when" o:"enters"`, count: 6 }],
    combo: [{ q: `(t:instant or t:sorcery) (o:"search your library" or o:tutor)`, count: 6 }],
    tokens: [
      { q: `o:"create" o:"token"`, count: 10 },
      { q: `o:"creature tokens you control"`, count: 3 },
    ],
    ramp: [
      { q: `(o:"add {" or o:"add one mana" or o:"add two mana")`, count: 8 },
      { q: `t:creature o:"add {"`, count: 4 },
    ],
    tribal: [{ q: `t:creature (o:"other" o:"creatures you control" or o:"lord")`, count: 6 }],
    voltron: [
      { q: `t:equipment`, count: 10 },
      { q: `t:aura o:"enchant creature" o:"+"`, count: 4 },
      { q: `t:creature (o:double_strike or o:trample or o:"can't be blocked")`, count: 4 },
    ],
    reanimator: [
      { q: `(t:instant or t:sorcery) o:"return" o:"from" o:"graveyard" o:"battlefield"`, count: 6 },
      { q: `(t:instant or t:sorcery or t:enchantment) (o:"into your graveyard" or o:mill)`, count: 4 },
    ],
  };

  // Always-present "necessities" — every commander deck needs these.
  const necessities: Array<{ name: string; q: string; count: number }> = [
    { name: "ramp", q: `(o:"add {" or o:"search your library" o:land o:battlefield) -t:land`, count: 10 },
    { name: "draw", q: `o:"draw" o:"card"`, count: 10 },
    { name: "single-target removal", q: `(t:instant or t:sorcery) (o:"destroy target" or o:"exile target") (o:creature or o:permanent or o:planeswalker)`, count: 6 },
    { name: "board wipes", q: `(o:"destroy all" or o:"exile all" or o:"destroy each" or o:"exile each")`, count: 3 },
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

  // PASS 1 — Archetype core (guaranteed on-theme cards, priority-weighted).
  const n = opts.archetypes.length;
  const priWeights = n ? priorityWeights(n) : [];
  for (let i = 0; i < opts.archetypes.length; i++) {
    const core = archCore[opts.archetypes[i]];
    if (!core) continue;
    // Secondary archetypes get a smaller share of their core (but never 0).
    const scale = n > 1 ? Math.max(0.5, priWeights[i] * n) : 1;
    for (const c of core) {
      const want = Math.max(1, Math.round(c.count * scale));
      await fillRole(`${idClause} ${c.q}`, want);
    }
  }

  // PASS 2 — Necessities (draw / removal / wipes / ramp guaranteed).
  for (const need of necessities) {
    await fillRole(`${idClause} ${need.q}`, need.count);
  }

  // PASS 3 — Themed role fill for whatever is left, capped at 60 nonland cards.
  const roles: Array<{ base: string; count: number; themed: boolean }> = [
    { base: `${idClause} t:creature`, count: 22, themed: true },
    { base: `${idClause} (t:instant or t:sorcery)`, count: 8, themed: true },
    { base: `${idClause} t:artifact -t:creature`, count: 4, themed: false },
    { base: `${idClause} t:enchantment -t:creature`, count: 4, themed: false },
    { base: `${idClause} t:planeswalker`, count: 1, themed: false },
  ];
  const NONLAND_CAP = 63;
  for (const role of roles) {
    const room = NONLAND_CAP - picked.length;
    if (room <= 0) break;
    const target = Math.min(role.count, room);
    if (!role.themed || archThemes.length === 0) {
      await fillRole(role.base, target);
      continue;
    }
    const shares = splitByPriority(target, archThemes.length);
    let unfilled = 0;
    for (let i = 0; i < archThemes.length; i++) {
      const want = shares[i] + unfilled;
      const got = await fillRole(`${role.base} ${archThemes[i]}`, want);
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
  const kws = opts.archetypes.map((a) => archKw[a]).filter(Boolean) as string[];

  const roles: Array<{ base: string; count: number; themed: boolean }> = [
    { base: `${fmt} id<=${ci} t:creature${priceClause}`, count: 20, themed: true },
    { base: `${fmt} id<=${ci} (t:instant or t:sorcery)${priceClause}`, count: 12, themed: true },
    { base: `${fmt} id<=${ci} (t:artifact or t:enchantment) -t:creature${priceClause}`, count: 4, themed: false },
  ];

  const seen = new Set<string>();
  const picked: ScryfallCard[] = [];

  async function fillRole(query: string, want: number): Promise<number> {
    if (want <= 0) return 0;
    try {
      const q = encodeURIComponent(query);
      const data = await scry<{ data: ScryfallCard[] }>(
        `/cards/search?q=${q}&order=edhrec&unique=cards`,
      );
      let added = 0;
      for (const c of data.data) {
        if (added >= want) break;
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        const copies = Math.min(4, want - added);
        for (let i = 0; i < copies && added < want; i++) {
          picked.push({ ...c, id: `${c.id}-${i}` });
          added++;
        }
      }
      return added;
    } catch {
      return 0;
    }
  }

  for (const role of roles) {
    if (!role.themed || kws.length === 0) {
      await fillRole(role.base, role.count);
      continue;
    }
    const shares = splitByPriority(role.count, kws.length);
    let unfilled = 0;
    for (let i = 0; i < kws.length; i++) {
      const want = shares[i] + unfilled;
      const got = await fillRole(`${role.base} o:${kws[i]}`, want);
      unfilled = want - got;
    }
    if (unfilled > 0) await fillRole(role.base, unfilled);
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
