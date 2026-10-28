import type { MigrationBuilder } from 'node-pg-migrate';

// 0020_funcoes_push_cobranca (T146; PUSH-04, PUSH-05, ISO-03, ADR-005, ADR-010). Função tarefas.*
// com que o cron acha, entre todos os profissionais (o cron não tem sessão), os eventos de
// cobrança do Asaas que pedem push.
// - tarefas.listar_eventos_cobranca_para_aviso(desde, ate, limite): eventos de webhook_evento já
//   processados (processado_em em (desde, ate]) e ligados a um profissional (usuario_id, gravado
//   por tarefas.marcar_webhook_processado), dos tipos PAYMENT_CREATED ('cobranca_gerada'),
//   PAYMENT_RECEIVED e PAYMENT_CONFIRMED ('pagamento_confirmado', o mesmo aviso: o Asaas pode
//   mandar os dois para o mesmo pagamento) e PAYMENT_OVERDUE ('cobranca_vencida'). A ref é o id do
//   pagamento (payment.id, texto de 1 a 200 caracteres; a chave do domínio, chaveEventoCobranca),
//   então o aviso sai uma vez por evento de cada cobrança. Uma linha por (profissional, tipo,
//   pagamento), só de quem tem ao menos uma push_subscription e sem registro em
//   notificacao_enviada. Devolve só usuario_id, tipo e ref (nada do payload, PUSH-05), até
//   `limite` linhas, pela ordem do primeiro processamento. Parâmetro nulo, desde > ate ou limite
//   fora de 1 a 1000: 22023.
// - Mesmo desenho da 0018: a função liga app.tarefa_push só durante a própria execução (no
//   corpo, sem SET na definição). As policies de push_subscription e notificacao_enviada já vêm da 0018; esta
//   acrescenta uma, só para o owner e só SELECT, em webhook_evento (a 0014 liga a leitura do owner
//   por app.tarefa_webhook, que também libera INSERT e UPDATE; aqui basta ler). A app ligar a
//   variável não muda nada para ela (as policies são do owner).
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); evolucao_backup_ro não executa. Gravar o envio e ler as assinaturas fica
// com a tarefa, numa transação do próprio profissional (RLS).

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE POLICY webhook_evento_tarefa_push ON public.webhook_evento FOR SELECT TO "evolucao_owner"
  USING (current_setting('app.tarefa_push', true) = 'on');

-- Eventos processados e ligados a um profissional, por instante de processamento.
CREATE INDEX webhook_evento_processado_idx ON public.webhook_evento (processado_em)
  WHERE usuario_id IS NOT NULL;

CREATE FUNCTION tarefas.listar_eventos_cobranca_para_aviso(
  p_desde timestamptz,
  p_ate timestamptz,
  p_limite integer
) RETURNS TABLE (
  usuario_id uuid,
  tipo text,
  ref text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_ant_tarefa text := coalesce(current_setting('app.tarefa_push', true), '');
BEGIN
  PERFORM set_config('app.tarefa_push', 'on', true);
  IF p_desde IS NULL OR p_ate IS NULL OR p_desde > p_ate THEN
    RAISE EXCEPTION 'listar_eventos_cobranca_para_aviso: janela inválida' USING ERRCODE = '22023';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'listar_eventos_cobranca_para_aviso: limite fora de 1 a 1000'
      USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT x.usuario_id, x.tipo, x.ref
    FROM (
      SELECT w.usuario_id AS usuario_id,
             CASE w.tipo
               WHEN 'PAYMENT_CREATED' THEN 'cobranca_gerada'
               WHEN 'PAYMENT_OVERDUE' THEN 'cobranca_vencida'
               ELSE 'pagamento_confirmado'
             END AS tipo,
             w.payload -> 'payment' ->> 'id' AS ref,
             min(w.processado_em) AS primeiro
      FROM public.webhook_evento w
      WHERE w.usuario_id IS NOT NULL
        AND w.processado_em > p_desde AND w.processado_em <= p_ate
        AND w.tipo IN ('PAYMENT_CREATED', 'PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED',
                       'PAYMENT_OVERDUE')
        AND jsonb_typeof(w.payload -> 'payment' -> 'id') = 'string'
        AND char_length(w.payload -> 'payment' ->> 'id') BETWEEN 1 AND 200
      GROUP BY 1, 2, 3
    ) x
    WHERE EXISTS (SELECT 1 FROM public.push_subscription p WHERE p.usuario_id = x.usuario_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.notificacao_enviada n
        WHERE n.usuario_id = x.usuario_id AND n.tipo = x.tipo AND n.ref = x.ref)
    ORDER BY x.primeiro, x.usuario_id, x.tipo, x.ref
    LIMIT p_limite;
  PERFORM set_config('app.tarefa_push', v_ant_tarefa, true);
END $$;
ALTER FUNCTION tarefas.listar_eventos_cobranca_para_aviso(timestamptz, timestamptz, integer)
  OWNER TO "evolucao_owner";
REVOKE ALL ON FUNCTION tarefas.listar_eventos_cobranca_para_aviso(timestamptz, timestamptz, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.listar_eventos_cobranca_para_aviso(timestamptz, timestamptz, integer)
  TO evolucao_app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS tarefas.listar_eventos_cobranca_para_aviso(timestamptz, timestamptz, integer);
DROP INDEX IF EXISTS public.webhook_evento_processado_idx;
DROP POLICY IF EXISTS webhook_evento_tarefa_push ON public.webhook_evento;
`);
};
