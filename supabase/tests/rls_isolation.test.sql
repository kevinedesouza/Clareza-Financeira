-- Testes de Isolamento RLS e Propriedade (Supabase / PostgreSQL)
-- Executar via psql / supabase test db contra instância de homologação

BEGIN;

-- Simular dois usuários distintos (A e B)
DO $$
DECLARE
  v_user_a UUID := '11111111-1111-1111-1111-111111111111';
  v_user_b UUID := '22222222-2222-2222-2222-222222222222';
  v_acc_a UUID := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  v_count INTEGER;
BEGIN
  -- 1. Inserir conta como Usuário A
  PERFORM set_config('request.jwt.claim.sub', v_user_a::text, true);
  PERFORM set_config('role', 'authenticated', true);

  INSERT INTO public.accounts (id, owner_id, name, type, opening_balance_cents, opening_date)
  VALUES (v_acc_a, v_user_a, 'Conta A', 'checking', 100000, '2026-11-01');

  -- 2. Usuário B não deve enxergar Conta A
  PERFORM set_config('request.jwt.claim.sub', v_user_b::text, true);
  SELECT COUNT(*) INTO v_count FROM public.accounts WHERE id = v_acc_a;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'FALHA RLS: Usuário B enxergou conta de A';
  END IF;

  -- 3. Usuário B não pode criar movimentação referenciando Conta A
  BEGIN
    INSERT INTO public.account_movements (owner_id, account_id, signed_cents, effective_date, description)
    VALUES (v_user_b, v_acc_a, -5000, '2026-11-02', 'Tentativa cruzada');
    RAISE EXCEPTION 'FALHA ISOLAMENTO: FK composta permitiu vínculo entre proprietários';
  EXCEPTION WHEN foreign_key_violation OR insufficient_privilege THEN
    -- Comportamento esperado
    NULL;
  END;

  -- 4. Anônimo não acessa dados financeiros
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('role', 'anon', true);
  BEGIN
    SELECT COUNT(*) INTO v_count FROM public.accounts;
    IF v_count <> 0 THEN
      RAISE EXCEPTION 'FALHA ANON: Usuário anônimo acessou contas';
    END IF;
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$$;

ROLLBACK;
