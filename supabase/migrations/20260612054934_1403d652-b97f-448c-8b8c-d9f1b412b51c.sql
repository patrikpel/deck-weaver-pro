ALTER TABLE public.decks ADD COLUMN IF NOT EXISTS archetypes text[] NOT NULL DEFAULT '{}';
UPDATE public.decks SET archetypes = string_to_array(archetype, ' + ') WHERE archetypes = '{}';