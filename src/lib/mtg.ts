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

// ---- Partner / Background / Companion detection -------------------------

export type PartnerKind =
  | "partner"            // plain Partner — pairs with any other Partner
  | "partner-with"       // Partner with [specific named card]
  | "friends-forever"    // pairs with any other Friends forever
  | "choose-background"  // commander picks a Background enchantment
  | "background"         // is a Background (rare path: user picks it first)
  | "doctor-companion"   // pairs with any Time Lord Doctor
  | "time-lord-doctor";  // pairs with any Doctor's companion

export type PartnerInfo = { kind: PartnerKind; with?: string };

export function detectPartner(card: ScryfallCard): PartnerInfo | null {
  const text = (card.oracle_text ?? "").toLowerCase();
  const type = (card.type_line ?? "").toLowerCase();

  // Backgrounds are "Legendary Enchantment — Background"
  if (type.includes("background")) return { kind: "background" };

  // "Choose a Background" appears on certain legendary creatures.
  if (/choose a background/i.test(text)) return { kind: "choose-background" };

  // "Partner with <Name>" — extract the name.
  const pw = text.match(/partner with ([^\n(.,]+)/i);
  if (pw) return { kind: "partner-with", with: pw[1].trim().replace(/\s+$/, "") };

  if (/friends forever/i.test(text)) return { kind: "friends-forever" };
  if (/doctor's companion/i.test(text)) return { kind: "doctor-companion" };
  // "Time Lord Doctor" subtype implies it can be paired by a Doctor's companion.
  if (type.includes("time lord") && type.includes("doctor")) return { kind: "time-lord-doctor" };

  // Plain "Partner" keyword — must not be the "Partner with" variant.
  // Use a word boundary check to avoid matching "Partners".
  if (/(^|\n|[\s.,;])partner(\s*[\n(.,]|$)/i.test(text) && !/partner with/i.test(text)) {
    return { kind: "partner" };
  }
  return null;
}

// Find candidate partner cards for a given commander, based on its partner type.
export async function findPartnerCandidates(commander: ScryfallCard): Promise<{
  info: PartnerInfo;
  options: ScryfallCard[];
} | null> {
  const info = detectPartner(commander);
  if (!info) return null;

  async function search(q: string, limit = 60): Promise<ScryfallCard[]> {
    try {
      const enc = encodeURIComponent(q);
      const data = await scry<{ data: ScryfallCard[] }>(
        `/cards/search?q=${enc}&order=edhrec&unique=cards&page=1`,
      );
      return data.data.slice(0, limit);
    } catch {
      return [];
    }
  }

  let options: ScryfallCard[] = [];
  switch (info.kind) {
    case "partner":
      options = await search(`is:commander game:paper o:"partner" -o:"partner with" -name:"${commander.name}"`);
      break;
    case "partner-with":
      if (info.with) {
        try {
          const card = await scry<ScryfallCard>(`/cards/named?exact=${encodeURIComponent(info.with)}`);
          options = [card];
        } catch { options = []; }
      }
      break;
    case "friends-forever":
      options = await search(`is:commander game:paper o:"friends forever" -name:"${commander.name}"`);
      break;
    case "choose-background":
      options = await search(`t:background game:paper is:commander`);
      break;
    case "background":
      // The Background was picked first; find legendary creatures that "Choose a Background".
      options = await search(`is:commander game:paper o:"choose a background"`);
      break;
    case "doctor-companion":
      options = await search(`is:commander game:paper t:"time lord doctor"`);
      break;
    case "time-lord-doctor":
      options = await search(`is:commander game:paper o:"doctor's companion"`);
      break;
  }
  return { info, options };
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
  tribe?: string;
  budget?: number;
}): Promise<ScryfallCard[]> {
  const baseParts = ["is:commander", "game:paper"];
  if (opts.colors.length) {
    baseParts.push(`id:${opts.colors.join("").toLowerCase() || "c"}`);
  }
  if (opts.budget) baseParts.push(`usd<=${Math.max(1, Math.floor(opts.budget / 20))}`);
  const tribeTok = sanitizeTribe(opts.tribe);
  // Loosely tie archetype to a keyword for commander discovery.
  const archKeyword: Record<string, string> = {
    aggro: "haste",
    control: "counter",
    midrange: "",
    combo: "infinite",
    tokens: "token",
    ramp: "ramp",
    tribal: "",
    voltron: "equipment",
    reanimator: "graveyard",
  };
  // For tribal with a tribe, override with `t:<tribe>` so we get commanders
  // that ARE the tribe (e.g. an Elf commander for an Elf deck).
  const archClause = (a: string): string => {
    if (a === "tribal") return tribeTok ? `t:${tribeTok}` : "";
    const kw = archKeyword[a];
    return kw ? `o:${kw}` : "";
  };
  const clauses = opts.archetypes.map(archClause).filter(Boolean);
  const TOTAL = 9;
  if (clauses.length === 0) {
    const q = encodeURIComponent(baseParts.join(" "));
    const data = await scry<{ data: ScryfallCard[] }>(
      `/cards/search?q=${q}&order=edhrec&unique=cards&page=1`,
    );
    return data.data.slice(0, TOTAL);
  }
  const shares = splitByPriority(TOTAL, clauses.length);
  const seen = new Set<string>();
  const out: ScryfallCard[] = [];
  for (let i = 0; i < clauses.length; i++) {
    const want = shares[i];
    if (want <= 0) continue;
    const parts = [...baseParts, clauses[i]];
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

export type CommanderSynergy = {
  id: string;
  label: string;
  queries: string[];
  weight: number; // approximate slot share
};

// Inspect a commander's oracle text + type line and return ordered synergy
// themes that the deck should be built around. Strongest signal first.
export function extractCommanderSynergies(commander: ScryfallCard): CommanderSynergy[] {
  const text = (commander.oracle_text ?? "").toLowerCase();
  const type = (commander.type_line ?? "").toLowerCase();
  const blob = `${text}\n${type}`;
  const out: CommanderSynergy[] = [];
  const push = (s: CommanderSynergy) => {
    if (!out.find((x) => x.id === s.id)) out.push(s);
  };

  if (/gain( \w+)? life|whenever you gain life|lifelink/.test(blob)) {
    push({
      id: "lifegain",
      label: "Lifegain",
      weight: 10,
      queries: [
        `o:"whenever you gain life"`,
        `o:lifelink`,
        `(o:"you gain" o:"life") -t:land`,
      ],
    });
  }
  if (/\+1\/\+1 counter|put .* counters on/.test(blob)) {
    push({
      id: "plus1",
      label: "+1/+1 counters",
      weight: 10,
      queries: [
        `o:"+1/+1 counter"`,
        `o:proliferate`,
        `o:"put" o:"+1/+1 counters"`,
      ],
    });
  }
  if (/create .* token|creature tokens? you control/.test(blob)) {
    push({
      id: "tokens",
      label: "Tokens",
      weight: 8,
      queries: [
        `o:"create" o:"token"`,
        `o:"creature tokens you control"`,
        `o:"anthem" or o:"creatures you control get +"`,
      ],
    });
  }
  if (/sacrifice (a|another) (creature|permanent|artifact)|whenever .* dies/.test(blob)) {
    push({
      id: "sacrifice",
      label: "Sacrifice / Aristocrats",
      weight: 9,
      queries: [
        `o:"sacrifice a creature"`,
        `o:"whenever" o:"dies"`,
        `(o:"create a treasure" or o:"create a food" or o:"create a clue")`,
      ],
    });
  }
  if (/from (your )?graveyard|return .* to the battlefield|mill|discard/.test(blob)) {
    push({
      id: "graveyard",
      label: "Graveyard / Reanimator",
      weight: 8,
      queries: [
        `o:"return" o:"from" o:"graveyard" o:"battlefield"`,
        `(o:"into your graveyard" or o:mill or o:"self-mill")`,
        `o:"from your graveyard"`,
      ],
    });
  }
  if (/artifact/.test(blob) && /(artifact you control|whenever.*artifact|metalcraft|affinity|cast.*artifact)/.test(blob)) {
    push({
      id: "artifacts",
      label: "Artifacts matter",
      weight: 8,
      queries: [
        `t:artifact -t:creature`,
        `o:"artifact you control"`,
        `t:creature t:artifact`,
      ],
    });
  }
  if (/enchantment/.test(blob) && /(enchantment you control|whenever.*enchantment|constellation|cast.*enchantment)/.test(blob)) {
    push({
      id: "enchantments",
      label: "Enchantments matter",
      weight: 8,
      queries: [
        `t:enchantment -t:creature -t:aura`,
        `o:constellation`,
        `t:aura o:"enchant creature"`,
      ],
    });
  }
  if (/instant or sorcery|noncreature spell|whenever you cast|prowess|magecraft/.test(blob)) {
    push({
      id: "spellslinger",
      label: "Spellslinger",
      weight: 9,
      queries: [
        `(t:instant or t:sorcery) cmc<=3`,
        `o:"whenever you cast" (o:instant or o:sorcery)`,
        `(o:prowess or o:magecraft)`,
      ],
    });
  }
  if (/whenever .* attacks|whenever .* deals combat damage|extra combat/.test(blob)) {
    push({
      id: "combat",
      label: "Combat triggers",
      weight: 7,
      queries: [
        `o:"whenever" o:"attacks"`,
        `(o:flying or o:trample or o:"can't be blocked" or o:menace) t:creature`,
        `o:"additional combat phase"`,
      ],
    });
  }
  if (/counter target .* spell/.test(blob)) {
    push({
      id: "counters",
      label: "Counterspells",
      weight: 6,
      queries: [`(t:instant) o:"counter target" o:"spell"`],
    });
  }
  if (/whenever you draw|draw your second card|if you('ve| have) drawn/.test(blob)) {
    push({
      id: "draw",
      label: "Card draw matters",
      weight: 7,
      queries: [
        `(t:instant or t:sorcery) o:"draw" o:"cards" cmc<=3`,
        `o:"whenever you draw"`,
        `o:"draw two cards"`,
      ],
    });
  }
  if (/landfall|whenever a land enters/.test(blob)) {
    push({
      id: "landfall",
      label: "Landfall",
      weight: 9,
      queries: [
        `o:landfall`,
        `(o:"search your library" o:land o:battlefield)`,
        `(o:"play an additional land" or o:"play two additional lands")`,
      ],
    });
  }
  if (/equip|equipped creature|attach/.test(blob)) {
    push({
      id: "equipment",
      label: "Equipment",
      weight: 7,
      queries: [
        `t:equipment`,
        `o:"equipped creature"`,
      ],
    });
  }
  // Auto-tribal: commander text says "other <Type>"
  const tribalMatch = text.match(/other ([a-z]+)s?\b/);
  if (tribalMatch) {
    const tribe = tribalMatch[1];
    // skip generic words
    if (!["creatures", "permanents", "spells", "players", "lands"].includes(tribe + "s")) {
      push({
        id: `tribal-${tribe}`,
        label: `${tribe[0].toUpperCase()}${tribe.slice(1)} tribal`,
        weight: 8,
        queries: [`t:creature t:${tribe}`],
      });
    }
  }
  return out;
}


// Normalize a free-text tribe input into a Scryfall-safe type token.
// Accepts "Elves", "elf", "Goblin Warrior" → quoted multi-word as needed.
function sanitizeTribe(input?: string): string {
  if (!input) return "";
  const t = input.trim().toLowerCase().replace(/[^a-z\s-]/g, "");
  if (!t) return "";
  // Naive singularize for common plurals.
  const singular = t
    .split(/\s+/)
    .map((w) =>
      w.endsWith("ies") ? w.slice(0, -3) + "y" :
      w.endsWith("ves") ? w.slice(0, -3) + "f" :
      w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w
    )
    .join(" ");
  return singular.includes(" ") ? `"${singular}"` : singular;
}



// Build a Commander (100-card) decklist using Scryfall searches per role.
export async function buildCommanderDeck(opts: {
  commander: ScryfallCard;
  partner?: ScryfallCard | null;
  archetypes: string[];
  tribe?: string;
  budget?: number;
  powerLevel: number; // 1-10
}): Promise<{
  commander: ScryfallCard;
  partner: ScryfallCard | null;
  cards: ScryfallCard[];
  synergies: CommanderSynergy[];
}> {
  const tribeTok = sanitizeTribe(opts.tribe);
  const partner = opts.partner ?? null;
  // Color identity = union of commander + partner identities.
  const ciSet = new Set<string>([
    ...(opts.commander.color_identity ?? []),
    ...(partner?.color_identity ?? []),
  ].map((c) => c.toLowerCase()));
  const ci = ciSet.size === 0 ? "c" : [...ciSet].sort().join("");
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
      if (a === "tribal" && tribeTok) return `t:${tribeTok}`;
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
    tribal: tribeTok
      ? [
          { q: `t:creature t:${tribeTok}`, count: 16 },
          { q: `t:${tribeTok} (o:"other" o:"creatures you control" or o:"each other")`, count: 4 },
        ]
      : [{ q: `t:creature (o:"other" o:"creatures you control" or o:"lord")`, count: 6 }],
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
  if (partner) { seen.add(partner.id); seen.add(partner.name); }
  const nonlandTarget = partner ? 62 : 63;
  const finalCardCap = partner ? 98 : 99;
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

  // PASS 1b — Commander synergy (driven by commander's oracle text).
  const synergies = extractCommanderSynergies(opts.commander);
  if (synergies.length > 0) {
    const SYN_BUDGET = 22; // total slots reserved across synergies
    const weightSum = synergies.reduce((a, s) => a + s.weight, 0);
    for (const syn of synergies) {
      const slotsForSyn = Math.max(2, Math.round((syn.weight / weightSum) * SYN_BUDGET));
      const perQuery = Math.max(1, Math.ceil(slotsForSyn / syn.queries.length));
      for (const q of syn.queries) {
        if (picked.length >= nonlandTarget) break;
        await fillRole(`${idClause} ${q}`, perQuery);
      }
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
  const NONLAND_CAP = nonlandTarget;
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
  const remainder = Math.max(0, finalCardCap - picked.length);
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

  return { commander: opts.commander, partner, cards: picked.slice(0, finalCardCap), synergies };
}

// Constructed (60-card) for Standard/Modern.
export async function buildConstructedDeck(opts: {
  format: Format;
  colors: ManaColor[];
  archetypes: string[];
  tribe?: string;
  budget?: number;
}): Promise<{ commander: null; cards: ScryfallCard[] }> {
  const ci = opts.colors.join("").toLowerCase() || "c";
  const budgetPer = opts.budget ? Math.max(0.25, opts.budget / 60) : undefined;
  const priceClause = budgetPer ? ` usd<=${budgetPer.toFixed(2)}` : "";
  const fmt = `f:${opts.format}`;
  const tribeTok = sanitizeTribe(opts.tribe);

  const archKw: Record<string, string> = {
    aggro: "haste", control: "counter", midrange: "", combo: "search",
    tokens: "token", ramp: "ramp", tribal: "creature", voltron: "equipment",
    reanimator: "graveyard",
  };
  // For tribal with a tribe, use `t:<tribe>` instead of an oracle keyword.
  const themeClauses: string[] = opts.archetypes
    .map((a) => {
      if (a === "tribal" && tribeTok) return `t:${tribeTok}`;
      const kw = archKw[a];
      return kw ? `o:${kw}` : "";
    })
    .filter(Boolean);

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
    if (!role.themed || themeClauses.length === 0) {
      await fillRole(role.base, role.count);
      continue;
    }
    const shares = splitByPriority(role.count, themeClauses.length);
    let unfilled = 0;
    for (let i = 0; i < themeClauses.length; i++) {
      const want = shares[i] + unfilled;
      const got = await fillRole(`${role.base} ${themeClauses[i]}`, want);
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

export function deckToText(
  commander: ScryfallCard | null,
  cards: ScryfallCard[],
  partner: ScryfallCard | null = null,
): string {
  const counts = new Map<string, number>();
  for (const c of cards) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  const lines: string[] = [];
  if (commander) {
    lines.push("// Commander");
    lines.push(`1 ${commander.name}`);
    if (partner) lines.push(`1 ${partner.name}`);
    lines.push("");
    lines.push("// Deck");
  }
  for (const [name, n] of counts) lines.push(`${n} ${name}`);
  return lines.join("\n");
}
