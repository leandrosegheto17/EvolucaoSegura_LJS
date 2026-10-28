import type { MigrationBuilder } from 'node-pg-migrate';

// 0013_ids_asaas (T128; PLANO-05, ISO-01, ISO-03). Ao assinar o Pro, a rota grava na assinatura
// do profissional os ids do cliente e da assinatura criados no Asaas; o webhook (T129 a T131) e o
// "Meu plano" (T134) acham a cobrança por eles. A app continua sem UPDATE direto na assinatura
// (teste da 0012): a gravação passa por esta função (decisão do usuário, 2026-10-27).
// - public.gravar_ids_asaas(cliente, assinatura): grava os dois ids e atualizado_em só na
//   assinatura de app_usuario_id(); devolve true se havia assinatura e false se não havia. Não
//   mexe em plano, status, periodo_fim nem vencimento_atraso. Sem usuário na transação: 42501;
//   id nulo ou vazio: 22023. Id já usado por outra assinatura: 23505 (índices únicos da 0012).
// - Enxerga a linha pela policy do usuário (assinatura_usuario vale também para o owner). Desliga
//   app.tarefa_assinatura durante a execução: as policies das funções tarefas.* (0012) não valem
//   aqui, mesmo que a app tenha ligado a variável antes de chamar.
//   O contexto vai no corpo (set_config local) e o valor que a transação tinha volta antes de cada
//   RETURN; erro desfaz a mudança junto com a transação. Sem SET app.* na definição: no Neon
//   (PG 18) o neondb_owner não é superusuário e o SET de parâmetro personalizado na definição
//   falha com "permission denied to set parameter" (T197).
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); backup_ro não executa.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE FUNCTION public.gravar_ids_asaas(
  p_asaas_customer_id text,
  p_asaas_subscription_id text
) RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_usuario uuid := public.app_usuario_id();
  v_ant_tarefa text := coalesce(current_setting('app.tarefa_assinatura', true), '');
  v_gravou boolean;
BEGIN
  PERFORM set_config('app.tarefa_assinatura', 'off', true);
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'gravar_ids_asaas: sem usuário na transação' USING ERRCODE = '42501';
  END IF;
  IF coalesce(p_asaas_customer_id, '') = '' OR coalesce(p_asaas_subscription_id, '') = '' THEN
    RAISE EXCEPTION 'gravar_ids_asaas: id ausente' USING ERRCODE = '22023';
  END IF;
  UPDATE public.assinatura a SET
    asaas_customer_id = p_asaas_customer_id,
    asaas_subscription_id = p_asaas_subscription_id,
    atualizado_em = now()
  WHERE a.usuario_id = v_usuario;
  -- O PERFORM abaixo muda o FOUND: guardar antes.
  v_gravou := FOUND;
  PERFORM set_config('app.tarefa_assinatura', v_ant_tarefa, true);
  RETURN v_gravou;
END $$;
ALTER FUNCTION public.gravar_ids_asaas(text, text) OWNER TO "owner";
REVOKE ALL ON FUNCTION public.gravar_ids_asaas(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.gravar_ids_asaas(text, text) TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP FUNCTION IF EXISTS public.gravar_ids_asaas(text, text);`);
};
