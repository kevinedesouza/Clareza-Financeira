-- Origem e confiança das sugestões de categoria nas linhas de importação (regra ou IA)
ALTER TABLE public.import_rows
  ADD COLUMN IF NOT EXISTS suggestion_source TEXT CHECK (suggestion_source IN ('rule', 'ai')),
  ADD COLUMN IF NOT EXISTS suggestion_confidence NUMERIC(4, 3) CHECK (suggestion_confidence >= 0 AND suggestion_confidence <= 1);
