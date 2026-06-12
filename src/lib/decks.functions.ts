import { createServerFn } from "@tanstack/react-start";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { z } from "zod";

// HMAC key: derived from the server-only service role secret.
// Never sent to the client. Used to sign captcha challenges and verify answers.
function hmacKey() {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!k) throw new Error("Server misconfigured");
  return k;
}

function sign(payload: string) {
  return createHmac("sha256", hmacKey()).update(payload).digest("hex");
}

function verify(payload: string, sig: string) {
  const expected = sign(payload);
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function genShareCode() {
  // 8-char base32-ish code, no ambiguous chars
  const alpha = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
  const buf = randomBytes(8);
  let out = "";
  for (let i = 0; i < 8; i++) out += alpha[buf[i] % alpha.length];
  return out;
}

// --- Captcha ---------------------------------------------------------------

export const getCaptcha = createServerFn({ method: "GET" }).handler(async () => {
  const a = Math.floor(Math.random() * 9) + 2; // 2..10
  const b = Math.floor(Math.random() * 9) + 2;
  const op = Math.random() < 0.5 ? "+" : "×";
  const answer = op === "+" ? a + b : a * b;
  const issued = Date.now();
  const payload = `${answer}.${issued}`;
  const token = `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
  return { question: `${a} ${op} ${b}`, token };
});

// --- Save deck -------------------------------------------------------------

const CardSchema = z.object({
  id: z.string(),
  name: z.string().max(200),
  type_line: z.string().max(200).optional(),
  mana_cost: z.string().max(100).optional(),
  cmc: z.number().optional(),
  oracle_text: z.string().max(2000).optional(),
  colors: z.array(z.string()).optional(),
  color_identity: z.array(z.string()).optional(),
  image_uris: z.any().optional(),
  card_faces: z.any().optional(),
  prices: z.any().optional(),
  scryfall_uri: z.string().url().max(500).optional(),
});

const SaveDeckSchema = z.object({
  captchaToken: z.string().max(500),
  captchaAnswer: z.string().max(10),
  format: z.enum(["commander", "standard", "modern"]),
  archetypes: z.array(z.string().min(1).max(40)).min(1).max(5),
  commander: CardSchema.nullable(),
  cards: z.array(CardSchema).min(1).max(200),
});

export const saveDeck = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => SaveDeckSchema.parse(input))
  .handler(async ({ data }) => {
    // Verify captcha
    const [b64, sig] = data.captchaToken.split(".");
    if (!b64 || !sig) throw new Error("Invalid captcha");
    const payload = Buffer.from(b64, "base64url").toString("utf8");
    if (!verify(payload, sig)) throw new Error("Captcha verification failed");
    const [answer, issuedStr] = payload.split(".");
    const issued = Number(issuedStr);
    if (!issued || Date.now() - issued > 10 * 60_000) throw new Error("Captcha expired");
    if (data.captchaAnswer.trim() !== answer) throw new Error("Wrong answer");

    const price = data.cards.reduce((s, c) => {
      const p = parseFloat((c.prices as { usd?: string | null } | undefined)?.usd ?? "0");
      return s + (isFinite(p) ? p : 0);
    }, 0) + (data.commander
      ? parseFloat((data.commander.prices as { usd?: string | null } | undefined)?.usd ?? "0") || 0
      : 0);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Retry on rare collision
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = genShareCode();
      const { data: row, error } = await supabaseAdmin
        .from("decks")
        .insert({
          share_code: code,
          format: data.format,
          archetype: data.archetypes.join(" + "),
          archetypes: data.archetypes,
          commander_name: data.commander?.name ?? null,
          commander_image:
            (data.commander?.image_uris as { normal?: string } | undefined)?.normal ??
            (data.commander?.card_faces as Array<{ image_uris?: { normal?: string } }> | undefined)?.[0]
              ?.image_uris?.normal ??
            null,
          card_count: data.cards.length + (data.commander ? 1 : 0),
          price_usd: Number(price.toFixed(2)),
          payload: { commander: data.commander, cards: data.cards } as never,
        } as never)
        .select("share_code")
        .single();
      if (!error && row) return { shareCode: row.share_code };
      if (error && !String(error.message).toLowerCase().includes("duplicate")) {
        throw new Error(error.message);
      }
    }
    throw new Error("Could not generate a unique share code");
  });

// --- Load deck -------------------------------------------------------------

export const getDeckByCode = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => z.object({ code: z.string().min(4).max(16) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("decks")
      .select("share_code, format, archetype, archetypes, commander_name, commander_image, card_count, price_usd, payload, created_at")
      .eq("share_code", data.code.toUpperCase())
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return row;
  });
