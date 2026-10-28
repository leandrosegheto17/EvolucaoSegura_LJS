import type { MigrationBuilder } from 'node-pg-migrate';

// 0016_funcoes_limpeza (T139; CAD-03, AUTH-09, ISO-03, ADR-005). Função tarefas.* com que o cron
// marca como vencidos, entre todos os usuários, os tokens de e-mail e as sessões cujo tempo
// acabou. Só marca (UPDATE de data), nunca apaga: a app não tem DELETE (0003).
// - tarefas.vencer_tokens_e_sessoes(agora): token_email aberto (sem usado_em nem invalidado_em) com
//   expira_em <= agora recebe invalidado_em = agora (CAD-03: no instante exato já não vale);
//   sessao aberta (sem encerrada_em) com 15 minutos desde o último uso ou 12 horas desde o login,
//   o que vier primeiro, recebe encerrada_em = agora (AUTH-09, a regra de sessaoExpirada em
//   backend/dominio/src/identidade/regras-acesso.ts). Devolve quantos tokens e sessões marcou.
//   Reexecução não muda nada (só linhas abertas entram). agora nulo: 22023.
// - As tabelas de identidade não têm RLS (0003); a função é do owner, dono delas.
// SECURITY DEFINER do owner, search_path fixo, parâmetro tipado, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); evolucao_backup_ro não executa.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE FUNCTION tarefas.vencer_tokens_e_sessoes(p_agora timestamptz)
RETURNS TABLE (tokens integer, sessoes integer)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_tokens integer;
  v_sessoes integer;
BEGIN
  IF p_agora IS NULL THEN
    RAISE EXCEPTION 'vencer_tokens_e_sessoes: agora ausente' USING ERRCODE = '22023';
  END IF;

  UPDATE public.token_email t SET invalidado_em = p_agora
  WHERE t.usado_em IS NULL AND t.invalidado_em IS NULL AND t.expira_em <= p_agora;
  GET DIAGNOSTICS v_tokens = ROW_COUNT;

  UPDATE public.sessao s SET encerrada_em = p_agora
  WHERE s.encerrada_em IS NULL
    AND (s.ultimo_uso_em + interval '15 minutes' <= p_agora
         OR s.criada_em + interval '12 hours' <= p_agora);
  GET DIAGNOSTICS v_sessoes = ROW_COUNT;

  RETURN QUERY SELECT v_tokens, v_sessoes;
END $$;
ALTER FUNCTION tarefas.vencer_tokens_e_sessoes(timestamptz) OWNER TO "evolucao_owner";
REVOKE ALL ON FUNCTION tarefas.vencer_tokens_e_sessoes(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.vencer_tokens_e_sessoes(timestamptz) TO evolucao_app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP FUNCTION IF EXISTS tarefas.vencer_tokens_e_sessoes(timestamptz);`);
};
