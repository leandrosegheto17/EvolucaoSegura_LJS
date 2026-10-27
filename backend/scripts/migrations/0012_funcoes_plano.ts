import type { MigrationBuilder } from 'node-pg-migrate';

// 0012_funcoes_plano (T126; PLANO-08, ISO-03, ADR-005). Funções tarefas.* com que o webhook do
// Asaas (T129 a T131) e o cron (T137) localizam e mudam a assinatura sem a RLS do usuário: o
// webhook chega sem sessão e o cron passa por todos os profissionais.
// - tarefas.localizar_assinatura_asaas(assinatura, cliente): acha pelo id da assinatura no Asaas
//   e, sem ela (ou sem achar), pelo id do cliente (o webhook pode chegar antes de a criação gravar
//   o id da assinatura). Devolve só usuario_id, status, periodo_fim e vencimento_atraso; id
//   inexistente devolve nenhuma linha. Não lê outra tabela (nada clínico, nada de identidade).
// - tarefas.mudar_estado_assinatura(usuario, status, periodo_fim, vencimento_atraso): aplica a
//   máquina de estados do PLANO-01, a mesma de TRANSICOES_ASSINATURA no domínio (T125), com a
//   linha travada (FOR UPDATE), e devolve o resultado e o estado anterior para a auditoria:
//   'permitida' (mudou), 'transicao_invalida' (ignorada, nada muda; quem chama registra),
//   'mesmo_estado' (renovação de ativa só adianta periodo_fim, sem regredir; nos demais nada
//   muda, e atrasada mantém o início da tolerância) e 'inexistente'. Campos: entrar ou ficar em
//   ativa exige periodo_fim (próximo vencimento, PLANO-08); entrar em atrasada exige
//   vencimento_atraso (início da tolerância, D-21), que só vale para atrasada e é limpo ao sair
//   dela; periodo_fim nulo mantém o atual; o plano segue o estado (free com free, pro com os
//   outros). Parâmetro fora disso é erro 22023.
// - Por que usuario_id e não id do Asaas na mudança: o cron leva trial vencido a free, e o trial
//   pode não ter id no Asaas; o webhook acha o usuario_id pela função de localizar.
// - A RLS forçada vale também para o owner (0004), então a função sozinha não veria linha alheia.
//   Cada função liga app.tarefa_assinatura só durante a própria execução (SET na definição) e duas
//   policies, só para o owner e só SELECT e UPDATE, liberam a assinatura com esse contexto. A app
//   ligar a variável não muda nada para ela (as policies são do owner) e o owner fora das funções
//   continua sem ver linha. Cuidado: outra função SECURITY DEFINER do owner que toque a
//   assinatura herdaria a variável que a app ligasse; uma assim deve fixar
//   SET app.tarefa_assinatura = 'off' na definição (hoje não existe nenhuma).
// - Ids do Asaas passam a ser únicos: localizar devolve no máximo uma assinatura.
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); backup_ro não executa. A app continua sem UPDATE direto.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE UNIQUE INDEX assinatura_asaas_subscription_uq ON public.assinatura (asaas_subscription_id);
CREATE UNIQUE INDEX assinatura_asaas_customer_uq ON public.assinatura (asaas_customer_id);

CREATE POLICY assinatura_tarefas_leitura ON public.assinatura FOR SELECT TO "owner"
  USING (current_setting('app.tarefa_assinatura', true) = 'on');
CREATE POLICY assinatura_tarefas_mudanca ON public.assinatura FOR UPDATE TO "owner"
  USING (current_setting('app.tarefa_assinatura', true) = 'on')
  WITH CHECK (current_setting('app.tarefa_assinatura', true) = 'on');

CREATE FUNCTION tarefas.localizar_assinatura_asaas(
  p_asaas_subscription_id text,
  p_asaas_customer_id text
) RETURNS TABLE (
  usuario_id uuid,
  status text,
  periodo_fim timestamptz,
  vencimento_atraso timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET app.tarefa_assinatura = 'on'
AS $$
BEGIN
  IF p_asaas_subscription_id IS NOT NULL THEN
    RETURN QUERY
      SELECT a.usuario_id, a.status, a.periodo_fim, a.vencimento_atraso
      FROM public.assinatura a WHERE a.asaas_subscription_id = p_asaas_subscription_id;
    IF FOUND THEN
      RETURN;
    END IF;
  END IF;
  IF p_asaas_customer_id IS NOT NULL THEN
    RETURN QUERY
      SELECT a.usuario_id, a.status, a.periodo_fim, a.vencimento_atraso
      FROM public.assinatura a WHERE a.asaas_customer_id = p_asaas_customer_id;
  END IF;
END $$;
ALTER FUNCTION tarefas.localizar_assinatura_asaas(text, text) OWNER TO "owner";
REVOKE ALL ON FUNCTION tarefas.localizar_assinatura_asaas(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.localizar_assinatura_asaas(text, text) TO app;

CREATE FUNCTION tarefas.mudar_estado_assinatura(
  p_usuario_id uuid,
  p_status text,
  p_periodo_fim timestamptz,
  p_vencimento_atraso timestamptz
) RETURNS TABLE (resultado text, status_anterior text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET app.tarefa_assinatura = 'on'
AS $$
DECLARE
  v_atual public.assinatura%ROWTYPE;
  v_permitida boolean;
BEGIN
  IF p_usuario_id IS NULL THEN
    RAISE EXCEPTION 'mudar_estado_assinatura: usuário ausente' USING ERRCODE = '22023';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('trial', 'ativa', 'atrasada', 'cancelada', 'free') THEN
    RAISE EXCEPTION 'mudar_estado_assinatura: estado inválido' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'ativa' AND p_periodo_fim IS NULL THEN
    RAISE EXCEPTION 'mudar_estado_assinatura: ativa exige periodo_fim' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'atrasada' AND p_vencimento_atraso IS NULL THEN
    RAISE EXCEPTION 'mudar_estado_assinatura: atrasada exige vencimento_atraso'
      USING ERRCODE = '22023';
  END IF;
  IF p_status <> 'atrasada' AND p_vencimento_atraso IS NOT NULL THEN
    RAISE EXCEPTION 'mudar_estado_assinatura: vencimento_atraso só com atrasada'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_atual FROM public.assinatura a WHERE a.usuario_id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'inexistente'::text, NULL::text;
    RETURN;
  END IF;

  IF v_atual.status = p_status THEN
    IF p_status = 'ativa' AND p_periodo_fim > v_atual.periodo_fim THEN
      UPDATE public.assinatura a SET periodo_fim = p_periodo_fim, atualizado_em = now()
      WHERE a.usuario_id = p_usuario_id;
    END IF;
    RETURN QUERY SELECT 'mesmo_estado'::text, v_atual.status;
    RETURN;
  END IF;

  -- PLANO-01 (igual a TRANSICOES_ASSINATURA em backend/dominio/src/plano/assinatura.ts).
  v_permitida := CASE v_atual.status
    WHEN 'trial' THEN p_status IN ('ativa', 'free')
    WHEN 'ativa' THEN p_status IN ('atrasada', 'cancelada')
    WHEN 'atrasada' THEN p_status IN ('ativa', 'free')
    WHEN 'cancelada' THEN p_status IN ('free')
    WHEN 'free' THEN p_status IN ('ativa')
    ELSE false
  END;
  IF NOT v_permitida THEN
    RETURN QUERY SELECT 'transicao_invalida'::text, v_atual.status;
    RETURN;
  END IF;

  UPDATE public.assinatura a SET
    plano = CASE WHEN p_status = 'free' THEN 'free' ELSE 'pro' END,
    status = p_status,
    periodo_fim = coalesce(p_periodo_fim, v_atual.periodo_fim),
    vencimento_atraso = p_vencimento_atraso,
    atualizado_em = now()
  WHERE a.usuario_id = p_usuario_id;
  RETURN QUERY SELECT 'permitida'::text, v_atual.status;
END $$;
ALTER FUNCTION tarefas.mudar_estado_assinatura(uuid, text, timestamptz, timestamptz)
  OWNER TO "owner";
REVOKE ALL ON FUNCTION tarefas.mudar_estado_assinatura(uuid, text, timestamptz, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.mudar_estado_assinatura(uuid, text, timestamptz, timestamptz)
  TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS tarefas.mudar_estado_assinatura(uuid, text, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS tarefas.localizar_assinatura_asaas(text, text);
DROP POLICY IF EXISTS assinatura_tarefas_mudanca ON public.assinatura;
DROP POLICY IF EXISTS assinatura_tarefas_leitura ON public.assinatura;
DROP INDEX IF EXISTS public.assinatura_asaas_customer_uq;
DROP INDEX IF EXISTS public.assinatura_asaas_subscription_uq;
`);
};
