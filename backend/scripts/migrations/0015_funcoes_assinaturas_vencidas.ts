import type { MigrationBuilder } from 'node-pg-migrate';

// 0015_funcoes_assinaturas_vencidas (T170; PLANO-04, PLANO-10, PLANO-11, ISO-03, ADR-005). Funções
// tarefas.* com que o cron (T137) leva a free as assinaturas cujo tempo acabou, entre todos os
// profissionais (o cron não tem sessão).
// - tarefas.listar_assinaturas_vencidas(agora, limite): as regras de estadoPorTempo (T125,
//   backend/dominio/src/plano/assinatura.ts), com o tempo por parâmetro: trial e cancelada com
//   periodo_fim <= agora; atrasada com 7 dias completos (168 horas, TOLERANCIA_ATRASO_MS) desde
//   vencimento_atraso ou, sem ele, desde periodo_fim; ativa e free nunca. Devolve só usuario_id,
//   status e asaas_subscription_id, até `limite` linhas (orçamento do cron, ADR-010), das que
//   venceram há mais tempo para as mais recentes. Parâmetro nulo ou limite fora de 1 a 1000: 22023.
// - tarefas.desvincular_assinatura_asaas(usuario): limpa o asaas_subscription_id da assinatura já
//   em free (decisão do usuário, 2026-10-27: o cron cancela no Asaas a assinatura em atraso e limpa
//   o id, para o GET /api/plano não consultar mais o Asaas). Devolve 'desvinculada', 'sem_vinculo'
//   (já sem id), 'nao_free' (nada muda) ou 'inexistente'. Mantém o asaas_customer_id.
// - As duas passam pelas policies da 0012 ligando app.tarefa_assinatura só durante a execução.
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); backup_ro não executa. A app continua sem UPDATE direto.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE FUNCTION tarefas.listar_assinaturas_vencidas(
  p_agora timestamptz,
  p_limite integer
) RETURNS TABLE (
  usuario_id uuid,
  status text,
  asaas_subscription_id text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET app.tarefa_assinatura = 'on'
AS $$
BEGIN
  IF p_agora IS NULL THEN
    RAISE EXCEPTION 'listar_assinaturas_vencidas: agora ausente' USING ERRCODE = '22023';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'listar_assinaturas_vencidas: limite fora de 1 a 1000' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT v.usuario_id, v.status, v.asaas_subscription_id
    FROM (
      SELECT a.usuario_id, a.status, a.asaas_subscription_id,
             CASE a.status
               WHEN 'atrasada' THEN coalesce(a.vencimento_atraso, a.periodo_fim) + interval '168 hours'
               ELSE a.periodo_fim
             END AS vence_em
      FROM public.assinatura a
      WHERE a.status IN ('trial', 'cancelada', 'atrasada')
    ) v
    WHERE v.vence_em <= p_agora
    ORDER BY v.vence_em, v.usuario_id
    LIMIT p_limite;
END $$;
ALTER FUNCTION tarefas.listar_assinaturas_vencidas(timestamptz, integer) OWNER TO "owner";
REVOKE ALL ON FUNCTION tarefas.listar_assinaturas_vencidas(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.listar_assinaturas_vencidas(timestamptz, integer) TO app;

CREATE FUNCTION tarefas.desvincular_assinatura_asaas(p_usuario_id uuid) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET app.tarefa_assinatura = 'on'
AS $$
DECLARE
  v_atual public.assinatura%ROWTYPE;
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'desvincular_assinatura_asaas: usuário ausente' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_atual FROM public.assinatura a WHERE a.usuario_id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'inexistente';
  END IF;
  IF v_atual.status <> 'free' THEN
    RETURN 'nao_free';
  END IF;
  IF v_atual.asaas_subscription_id IS NULL THEN
    RETURN 'sem_vinculo';
  END IF;
  UPDATE public.assinatura a SET asaas_subscription_id = NULL, atualizado_em = now()
  WHERE a.usuario_id = p_usuario_id;
  RETURN 'desvinculada';
END $$;
ALTER FUNCTION tarefas.desvincular_assinatura_asaas(uuid) OWNER TO "owner";
REVOKE ALL ON FUNCTION tarefas.desvincular_assinatura_asaas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.desvincular_assinatura_asaas(uuid) TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS tarefas.desvincular_assinatura_asaas(uuid);
DROP FUNCTION IF EXISTS tarefas.listar_assinaturas_vencidas(timestamptz, integer);
`);
};
