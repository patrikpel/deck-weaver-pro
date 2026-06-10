CREATE TABLE public.decks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  share_code TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL,
  archetype TEXT NOT NULL,
  commander_name TEXT,
  commander_image TEXT,
  card_count INTEGER NOT NULL DEFAULT 0,
  price_usd NUMERIC(10,2) NOT NULL DEFAULT 0,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX decks_share_code_idx ON public.decks (share_code);
CREATE INDEX decks_created_at_idx ON public.decks (created_at DESC);

GRANT SELECT ON public.decks TO anon, authenticated;
GRANT ALL ON public.decks TO service_role;

ALTER TABLE public.decks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read shared decks"
  ON public.decks FOR SELECT
  TO anon, authenticated
  USING (true);