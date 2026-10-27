import type { MigrationBuilder } from 'node-pg-migrate';

// 0018_funcoes_push_sessao (T144; PUSH-02, PUSH-05, ISO-03, ADR-005, ADR-010). Função tarefas.*
// com que o cron acha, entre todos os profissionais (o cron não tem sessão), as sessões que pedem
// o push "sessão próxima".
// - tarefas.listar_sessoes_para_aviso(de, ate, limite): sessões `agendada` com inicio em
//   [de, ate] (o intervalo vem do domínio, intervaloSessaoProxima: agora + 10 min a agora + 15
//   min), cujo profissional tem ao menos uma push_subscription e que ainda não têm registro
//   'sessao_proxima' em notificacao_enviada. Devolve só usuario_id, sessao_id e inicio (nada do
//   paciente, PUSH-05), até `limite` linhas (orçamento do cron, ADR-010), das que começam antes
//   para as que começam depois. Parâmetro nulo, de > ate ou limite fora de 1 a 1000: 22023.
// - A RLS forçada vale também para o owner, então a função liga app.tarefa_push só durante a
//   própria execução (SET na definição) e três policies, só para o owner e só SELECT, liberam a
//   leitura de sessao_atendimento, push_subscription e notificacao_enviada nesse contexto (mesmo
//   desenho da 0012). A app ligar a variável não muda nada para ela (as policies são do owner).
//   Cuidado: outra função SECURITY DEFINER do owner que leia essas tabelas herdaria a variável
//   que a app ligasse; uma assim deve fixar SET app.tarefa_push = 'off' (hoje não existe nenhuma).
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); backup_ro não executa. Gravar o envio e ler as assinaturas fica
// com a tarefa, numa transação do próprio profissional (RLS).

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE POLICY sessao_atendimento_tarefa_push ON public.sessao_atendimento FOR SELECT TO "owner"
  USING (current_setting('app.tarefa_push', true) = 'on');
CREATE POLICY push_subscription_tarefa_push ON public.push_subscription FOR SELECT TO "owner"
  USING (current_setting('app.tarefa_push', true) = 'on');
CREATE POLICY notificacao_enviada_tarefa_push ON public.notificacao_enviada FOR SELECT TO "owner"
  USING (current_setting('app.tarefa_push', true) = 'on');

-- Sessões agendadas por início, entre todos os profissionais.
CREATE INDEX sessao_atendimento_agendada_inicio_idx ON public.sessao_atendimento (inicio)
  WHERE status = 'agendada';

CREATE FUNCTION tarefas.listar_sessoes_para_aviso(
  p_de timestamptz,
  p_ate timestamptz,
  p_limite integer
) RETURNS TABLE (
  usuario_id uuid,
  sessao_id uuid,
  inicio timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET app.tarefa_push = 'on'
AS $$
BEGIN
  IF p_de IS NULL OR p_ate IS NULL OR p_de > p_ate THEN
    RAISE EXCEPTION 'listar_sessoes_para_aviso: intervalo inválido' USING ERRCODE = '22023';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'listar_sessoes_para_aviso: limite fora de 1 a 1000' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
    SELECT s.usuario_id, s.id, s.inicio
    FROM public.sessao_atendimento s
    WHERE s.status = 'agendada'
      AND s.inicio >= p_de AND s.inicio <= p_ate
      AND EXISTS (SELECT 1 FROM public.push_subscription p WHERE p.usuario_id = s.usuario_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.notificacao_enviada n
        WHERE n.usuario_id = s.usuario_id AND n.tipo = 'sessao_proxima' AND n.ref = s.id::text)
    ORDER BY s.inicio, s.id
    LIMIT p_limite;
END $$;
ALTER FUNCTION tarefas.listar_sessoes_para_aviso(timestamptz, timestamptz, integer) OWNER TO "owner";
REVOKE ALL ON FUNCTION tarefas.listar_sessoes_para_aviso(timestamptz, timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.listar_sessoes_para_aviso(timestamptz, timestamptz, integer) TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS tarefas.listar_sessoes_para_aviso(timestamptz, timestamptz, integer);
DROP INDEX IF EXISTS public.sessao_atendimento_agendada_inicio_idx;
DROP POLICY IF EXISTS notificacao_enviada_tarefa_push ON public.notificacao_enviada;
DROP POLICY IF EXISTS push_subscription_tarefa_push ON public.push_subscription;
DROP POLICY IF EXISTS sessao_atendimento_tarefa_push ON public.sessao_atendimento;
`);
};
