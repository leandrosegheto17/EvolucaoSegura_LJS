import type { MigrationBuilder } from 'node-pg-migrate';

// 0014_funcoes_webhook (T169; PLANO-06, PLANO-07, ISO-03, ADR-005). Funções tarefas.* com que o
// webhook do Asaas (T129 a T131) grava o evento antes de processar e o marca como processado: o
// webhook chega sem sessão e a app só lê webhook_evento (0004).
// - tarefas.gravar_webhook_evento(event_id, tipo, payload): insere o evento com usuario_id nulo e
//   devolve 'novo'; event_id já gravado devolve 'repetido' sem alterar o registro (PLANO-07).
//   Entregas simultâneas do mesmo evento: uma grava, a outra espera e recebe 'repetido'.
// - tarefas.marcar_webhook_processado(event_id, usuario_id): preenche processado_em (now()) e o
//   usuario_id do profissional achado (nulo quando não houver), só se o evento existe e ainda não
//   foi processado. Devolve 'marcado', 'ja_processado' (nada muda) ou 'inexistente'.
// - O webhook roda gravar, processar e marcar numa transação só (decisão do usuário,
//   2026-10-27): erro desfaz tudo e o reenvio do Asaas chega como 'novo'.
// - A RLS forçada vale também para o owner (0004). Cada função liga app.tarefa_webhook só durante
//   a própria execução e três policies, só para o owner (SELECT, INSERT e UPDATE), liberam
//   webhook_evento nesse contexto. A app ligar a variável não muda nada para ela. Outra função
//   SECURITY DEFINER do owner que toque webhook_evento deve desligar app.tarefa_webhook no corpo
//   (hoje não existe nenhuma).
//   O contexto vai no corpo (set_config local) e o valor que a transação tinha volta antes de cada
//   RETURN; erro desfaz a mudança junto com a transação. Sem SET app.* na definição: no Neon
//   (PG 18) o neondb_owner não é superusuário e o SET de parâmetro personalizado na definição
//   falha com "permission denied to set parameter" (T197).
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); backup_ro não executa. A app continua sem INSERT e UPDATE.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE POLICY webhook_evento_tarefas_leitura ON public.webhook_evento FOR SELECT TO "owner"
  USING (current_setting('app.tarefa_webhook', true) = 'on');
CREATE POLICY webhook_evento_tarefas_inclusao ON public.webhook_evento FOR INSERT TO "owner"
  WITH CHECK (current_setting('app.tarefa_webhook', true) = 'on');
CREATE POLICY webhook_evento_tarefas_mudanca ON public.webhook_evento FOR UPDATE TO "owner"
  USING (current_setting('app.tarefa_webhook', true) = 'on')
  WITH CHECK (current_setting('app.tarefa_webhook', true) = 'on');

CREATE FUNCTION tarefas.gravar_webhook_evento(
  p_event_id text,
  p_tipo text,
  p_payload jsonb
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_ant_tarefa text := coalesce(current_setting('app.tarefa_webhook', true), '');
  v_novo boolean;
BEGIN
  PERFORM set_config('app.tarefa_webhook', 'on', true);
  IF coalesce(p_event_id, '') = '' OR coalesce(p_tipo, '') = '' OR p_payload IS NULL THEN
    RAISE EXCEPTION 'gravar_webhook_evento: parâmetro ausente' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.webhook_evento (event_id, tipo, payload)
  VALUES (p_event_id, p_tipo, p_payload)
  ON CONFLICT (event_id) DO NOTHING;
  -- O PERFORM abaixo muda o FOUND: guardar antes.
  v_novo := FOUND;
  PERFORM set_config('app.tarefa_webhook', v_ant_tarefa, true);
  RETURN CASE WHEN v_novo THEN 'novo' ELSE 'repetido' END;
END $$;
ALTER FUNCTION tarefas.gravar_webhook_evento(text, text, jsonb) OWNER TO "owner";
REVOKE ALL ON FUNCTION tarefas.gravar_webhook_evento(text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.gravar_webhook_evento(text, text, jsonb) TO app;

CREATE FUNCTION tarefas.marcar_webhook_processado(
  p_event_id text,
  p_usuario_id uuid
) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_processado timestamptz;
  v_ant_tarefa text := coalesce(current_setting('app.tarefa_webhook', true), '');
BEGIN
  PERFORM set_config('app.tarefa_webhook', 'on', true);
  IF coalesce(p_event_id, '') = '' THEN
    RAISE EXCEPTION 'marcar_webhook_processado: event_id ausente' USING ERRCODE = '22023';
  END IF;
  SELECT w.processado_em INTO v_processado
  FROM public.webhook_evento w WHERE w.event_id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    PERFORM set_config('app.tarefa_webhook', v_ant_tarefa, true);
    RETURN 'inexistente';
  END IF;
  IF v_processado IS NOT NULL THEN
    PERFORM set_config('app.tarefa_webhook', v_ant_tarefa, true);
    RETURN 'ja_processado';
  END IF;
  UPDATE public.webhook_evento w SET processado_em = now(), usuario_id = p_usuario_id
  WHERE w.event_id = p_event_id;
  PERFORM set_config('app.tarefa_webhook', v_ant_tarefa, true);
  RETURN 'marcado';
END $$;
ALTER FUNCTION tarefas.marcar_webhook_processado(text, uuid) OWNER TO "owner";
REVOKE ALL ON FUNCTION tarefas.marcar_webhook_processado(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.marcar_webhook_processado(text, uuid) TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS tarefas.marcar_webhook_processado(text, uuid);
DROP FUNCTION IF EXISTS tarefas.gravar_webhook_evento(text, text, jsonb);
DROP POLICY IF EXISTS webhook_evento_tarefas_mudanca ON public.webhook_evento;
DROP POLICY IF EXISTS webhook_evento_tarefas_inclusao ON public.webhook_evento;
DROP POLICY IF EXISTS webhook_evento_tarefas_leitura ON public.webhook_evento;
`);
};
