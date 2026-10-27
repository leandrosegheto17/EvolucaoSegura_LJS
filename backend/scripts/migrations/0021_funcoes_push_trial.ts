import type { MigrationBuilder } from 'node-pg-migrate';

// 0021_funcoes_push_trial (T178; PUSH-04, PUSH-05, ISO-03, ADR-005, ADR-010). Função tarefas.*
// com que o cron acha, entre todos os profissionais (o cron não tem sessão), os trials que pedem o
// push "o teste termina em 3 dias".
// - tarefas.listar_trials_terminando(agora, limite): assinaturas `trial` com periodo_fim em
//   (agora, agora + 3 dias] (a janela do domínio, emJanelaTrialTerminando), de quem tem ao menos
//   uma push_subscription e sem registro 'trial_terminando' com ref = o periodo_fim em ISO 8601
//   UTC com milissegundos ('YYYY-MM-DDTHH:MM:SS.mmmZ', o Date.toISOString da chave do domínio,
//   chaveTrialTerminando; os microssegundos do Postgres são truncados, como o Date do JS faz).
//   A ref volta pronta para a tarefa gravar exatamente a mesma chave. Devolve só usuario_id,
//   periodo_fim e ref, até `limite` linhas, do fim mais próximo ao mais distante. Parâmetro nulo
//   ou limite fora de 1 a 1000: 22023.
// - Mesmo desenho da 0018: a função liga app.tarefa_push só durante a própria execução (SET na
//   definição). As policies de push_subscription e notificacao_enviada já vêm da 0018; esta
//   acrescenta uma, só para o owner e só SELECT, em assinatura (a 0012 liga a leitura do owner
//   por app.tarefa_assinatura, que também libera UPDATE; aqui basta ler). A app ligar a variável
//   não muda nada para ela (as policies são do owner).
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); backup_ro não executa. Gravar o envio e ler as assinaturas de
// push fica com a tarefa, numa transação do próprio profissional (RLS).

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE POLICY assinatura_tarefa_push ON public.assinatura FOR SELECT TO "owner"
  USING (current_setting('app.tarefa_push', true) = 'on');

-- Trials por fim, entre todos os profissionais.
CREATE INDEX assinatura_trial_periodo_fim_idx ON public.assinatura (periodo_fim)
  WHERE status = 'trial';

CREATE FUNCTION tarefas.listar_trials_terminando(
  p_agora timestamptz,
  p_limite integer
) RETURNS TABLE (
  usuario_id uuid,
  periodo_fim timestamptz,
  ref text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET app.tarefa_push = 'on'
AS $$
BEGIN
  IF p_agora IS NULL THEN
    RAISE EXCEPTION 'listar_trials_terminando: agora nulo' USING ERRCODE = '22023';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'listar_trials_terminando: limite fora de 1 a 1000' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT x.usuario_id, x.periodo_fim, x.ref
    FROM (
      SELECT a.usuario_id AS usuario_id, a.periodo_fim AS periodo_fim,
             to_char(a.periodo_fim AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS ref
      FROM public.assinatura a
      WHERE a.status = 'trial'
        AND a.periodo_fim > p_agora AND a.periodo_fim <= p_agora + interval '3 days'
    ) x
    WHERE EXISTS (SELECT 1 FROM public.push_subscription p WHERE p.usuario_id = x.usuario_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.notificacao_enviada n
        WHERE n.usuario_id = x.usuario_id AND n.tipo = 'trial_terminando' AND n.ref = x.ref)
    ORDER BY x.periodo_fim, x.usuario_id
    LIMIT p_limite;
END $$;
ALTER FUNCTION tarefas.listar_trials_terminando(timestamptz, integer) OWNER TO "owner";
REVOKE ALL ON FUNCTION tarefas.listar_trials_terminando(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.listar_trials_terminando(timestamptz, integer) TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS tarefas.listar_trials_terminando(timestamptz, integer);
DROP INDEX IF EXISTS public.assinatura_trial_periodo_fim_idx;
DROP POLICY IF EXISTS assinatura_tarefa_push ON public.assinatura;
`);
};
