import type { MigrationBuilder } from 'node-pg-migrate';

// 0019_funcoes_push_pendente (T145; PUSH-03, PUSH-05, ISO-03, ADR-005, ADR-010). Função tarefas.*
// com que o cron acha, entre todos os profissionais (o cron não tem sessão), quem pede o push
// "evolução pendente" das 20:00.
// - tarefas.listar_pendencias_evolucao(dia, limite): para o dia de calendário `dia` em
//   America/Sao_Paulo (de 00:00, inclusive, a 00:00 do dia seguinte, exclusivo), os profissionais
//   com sessões `realizada` nesse dia sem evolução, com ao menos uma push_subscription e ainda sem
//   registro 'evolucao_pendente' com ref = o dia ('YYYY-MM-DD', a chave do domínio,
//   chaveEvolucaoPendente). Devolve só usuario_id e a quantidade (nada do paciente nem da
//   evolução, PUSH-05), até `limite` profissionais (orçamento do cron, ADR-010). Dia nulo ou
//   limite fora de 1 a 1000: 22023.
// - Mesmo desenho da 0018: a função liga app.tarefa_push só durante a própria execução (no
//   corpo, sem SET na definição). As policies de sessao_atendimento, push_subscription e notificacao_enviada já vêm
//   da 0018; esta acrescenta uma, só para o owner e só SELECT, em evolucao. A app ligar a variável
//   não muda nada para ela (as policies são do owner). O cuidado da 0018 vale também para
//   evolucao: outra função SECURITY DEFINER do owner que a leia deve desligar app.tarefa_push no
//   corpo.
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); evolucao_backup_ro não executa. Gravar o envio e ler as assinaturas fica
// com a tarefa, numa transação do próprio profissional (RLS).

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE POLICY evolucao_tarefa_push ON public.evolucao FOR SELECT TO "evolucao_owner"
  USING (current_setting('app.tarefa_push', true) = 'on');

-- Sessões realizadas por início, entre todos os profissionais.
CREATE INDEX sessao_atendimento_realizada_inicio_idx ON public.sessao_atendimento (inicio)
  WHERE status = 'realizada';

CREATE FUNCTION tarefas.listar_pendencias_evolucao(
  p_dia date,
  p_limite integer
) RETURNS TABLE (
  usuario_id uuid,
  quantidade integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_ant_tarefa text := coalesce(current_setting('app.tarefa_push', true), '');
  v_de timestamptz;
  v_ate timestamptz;
  v_ref text;
BEGIN
  PERFORM set_config('app.tarefa_push', 'on', true);
  IF p_dia IS NULL THEN
    RAISE EXCEPTION 'listar_pendencias_evolucao: dia nulo' USING ERRCODE = '22023';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'listar_pendencias_evolucao: limite fora de 1 a 1000' USING ERRCODE = '22023';
  END IF;
  v_de := p_dia::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_ate := (p_dia + 1)::timestamp AT TIME ZONE 'America/Sao_Paulo';
  v_ref := to_char(p_dia, 'YYYY-MM-DD');
  RETURN QUERY
    SELECT s.usuario_id, count(*)::integer
    FROM public.sessao_atendimento s
    WHERE s.status = 'realizada'
      AND s.inicio >= v_de AND s.inicio < v_ate
      AND NOT EXISTS (SELECT 1 FROM public.evolucao e WHERE e.sessao_id = s.id)
      AND EXISTS (SELECT 1 FROM public.push_subscription p WHERE p.usuario_id = s.usuario_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.notificacao_enviada n
        WHERE n.usuario_id = s.usuario_id AND n.tipo = 'evolucao_pendente' AND n.ref = v_ref)
    GROUP BY s.usuario_id
    ORDER BY s.usuario_id
    LIMIT p_limite;
  PERFORM set_config('app.tarefa_push', v_ant_tarefa, true);
END $$;
ALTER FUNCTION tarefas.listar_pendencias_evolucao(date, integer) OWNER TO "evolucao_owner";
REVOKE ALL ON FUNCTION tarefas.listar_pendencias_evolucao(date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.listar_pendencias_evolucao(date, integer) TO evolucao_app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS tarefas.listar_pendencias_evolucao(date, integer);
DROP INDEX IF EXISTS public.sessao_atendimento_realizada_inicio_idx;
DROP POLICY IF EXISTS evolucao_tarefa_push ON public.evolucao;
`);
};
