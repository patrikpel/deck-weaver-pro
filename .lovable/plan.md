
## Problem

Right now `buildCommanderDeck` only uses the chosen archetypes + tribe to decide what cards to pull. The commander itself is just used for color identity. So picking Karlov of the Ghost Council (gains counters whenever you gain life) builds the same deck as any other Orzhov legendary — there is no lifegain payoff search at all.

We want the commander's oracle text to drive a dedicated synergy pass so the deck is actually shaped around what the commander does.

## Approach

Add a new "commander synergy" pass to `src/lib/mtg.ts` that runs **before** the necessities pass, so synergy cards get first pick of slots after the archetype core. It extracts one or more synergy themes from the commander's `oracle_text` and pulls cards that trigger / enable / pay off those themes.

### 1. New helper: `extractCommanderSynergies(commander)`

Pure function over `commander.oracle_text` + `type_line`. Returns an ordered list of `{ label, queries: string[], weight }`, strongest signal first. Detection is keyword/regex based — no LLM.

Synergies it recognizes (initial set, extensible):

- **lifegain** — text matches `/gain .* life|whenever you gain life|lifelink/i` → queries for `o:"whenever you gain life"`, `o:lifelink`, `o:"gain ... life"`.
- **+1/+1 counters** — `/\+1\/\+1 counter/i` → `o:"+1/+1 counter"`, `o:proliferate`, `o:"put ... counters"`.
- **tokens** — `/create .* token/i` → `o:"create" o:"token"`, `o:"creature tokens you control"`, anthems.
- **sacrifice** — `/sacrifice (a|another) (creature|permanent)/i` → `o:"sacrifice a creature"`, `o:"when ... dies"`, treasure/clue producers.
- **graveyard / reanimator** — `/from (your )?graveyard|mill|discard/i` → mill/self-mill, reanimate spells.
- **artifacts matter** — `/artifact/i` (when commander rewards them) → `t:artifact`, `o:"artifact you control"`.
- **enchantments matter** — `/enchantment/i` (constellation/aura payoffs) → `t:enchantment`, `o:constellation`, auras.
- **spellslinger** — `/instant or sorcery|noncreature spell|cast.*spell/i` → cheap instants/sorceries, `o:"whenever you cast"`, prowess.
- **+attack / combat triggers** — `/whenever .* attacks|combat damage/i` → evasion, extra-combat, anthems.
- **counters spells** — `/counter target .* spell/i` → more counterspells.
- **draw matters** — `/whenever you draw|draw your second/i` → cantrips, wheels.
- **landfall** — `/landfall|land enters the battlefield/i` → extra land drops, fetches/ramp lands.
- **+1/+1 voltron-ish (equip / attach)** — already handled by archetype, but boost when commander has `equip` or `aura` keywords.
- **tribal fallback** — if commander text mentions `other <Type>` and no tribe was chosen, auto-add that creature type as a synergy.

Each synergy carries a default `weight` (e.g. lifegain=10, +1/+1=10, sacrifice=8, etc.) used to allocate slots.

### 2. New pass in `buildCommanderDeck`

Insert between PASS 1 (archetype core) and PASS 2 (necessities), call it **PASS 1b — Commander synergy**:

```text
synergies = extractCommanderSynergies(commander)
totalSynergySlots = min(20, sum of weights capped)
for each synergy (priority order):
    for each query in synergy.queries:
        fillRole(`${idClause} ${query}`, share)
```

Slot budget is taken from the themed-fill pass (PASS 3), not from necessities — necessities stay guaranteed. We lower the `NONLAND_CAP`-bound themed fill accordingly so total nonland still lands around 63.

Also lightly **boost necessities counts** when synergy reinforces them (e.g. lifegain commander → keep draw/removal but skew filler toward lifegain payoffs).

### 3. Surface synergies in the UI (small)

In `src/components/DeckBuilder.tsx`, after generation, show the detected synergy labels as small badges under the commander on the final step ("Synergies detected: Lifegain, +1/+1 counters"). This makes the behavior visible and debuggable. No new step, no new inputs.

### 4. No schema / DB changes

Everything is runtime search behavior. The stored deck already captures the resulting card list.

## Files to change

- `src/lib/mtg.ts` — add `extractCommanderSynergies`, add PASS 1b in `buildCommanderDeck`, expose detected synergies on the return value (`{ commander, cards, synergies }`).
- `src/components/DeckBuilder.tsx` — read `synergies` from the build result, render as badges on the final step.

## Out of scope

- LLM-based oracle parsing.
- Applying commander synergy to `buildConstructedDeck` (no commander there).
- Reworking the archetype core or necessities lists.

## Open question

Should the synergy pass be **additive** (always on, regardless of archetypes) or **replace** the archetype when they conflict? Plan above keeps it additive — synergy runs in addition to archetypes, with synergy getting first pick after archetype core. Let me know if you'd rather have it override the archetype when the commander strongly implies a different game plan.
