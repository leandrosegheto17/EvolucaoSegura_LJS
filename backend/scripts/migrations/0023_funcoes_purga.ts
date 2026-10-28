import type { MigrationBuilder } from 'node-pg-migrate';

// 0023_funcoes_purga (T152; CONTA-05, ISO-03, ADR-005, ADR-012). Purga das contas cuja exclusão foi
// confirmada há 30 dias sem desistência.
// - tarefas.purgar_contas(agora, limite): acha, entre todos os usuários, as contas com
//   bloqueado_exclusao_em + 30 dias (720 horas, o mesmo cálculo do purga_em anunciado na
//   confirmação, DIAS_ATE_PURGA em backend/contrato/src/conta.ts) <= agora, das bloqueadas há mais
//   tempo para as mais recentes, até `limite` (orçamento do cron, ADR-010). Para cada uma, numa
//   só transação: grava conta_excluida (id, pedido_em, purgado_em = agora) e apaga todas as linhas
//   do profissional, auditoria inclusive, e por fim a linha de usuario. pedido_em = o último
//   conta.exclusao_pedida até o bloqueio; sem ele (não deveria acontecer), a data do bloqueio.
//   Apaga também a linha de tentativa_login do e-mail (a chave é o SHA-256 do e-mail, um dado
//   derivado dele); as linhas por IP não são do profissional e ficam. Devolve quantas purgou.
//   Conta bloqueada há menos de 30 dias, não bloqueada ou travada por uma desistência em curso
//   (SKIP LOCKED) fica intacta. Reexecução não muda nada: a conta purgada já não existe.
//   Parâmetro nulo ou limite fora de 1 a 1000: 22023.
// - O RLS forçado vale também para o owner: a função define app.usuario_id em tempo de execução
//   (set_config local, como a API faz por requisição), conta a conta, e no fim devolve os valores
//   que a transação tinha. Sem SET app.* na definição da função: roda no Neon (PG 18) com o
//   neondb_owner sem superusuário (achado do lote 20). app.tarefa_assinatura vai a 'off' durante a
//   execução (regra da 0012 para função do owner que toque a assinatura).
// - As tabelas só de inclusão (audit_log, consentimento_tcle, *_retificacao, *_revisao) barram
//   DELETE pelo trigger public.negar_alteracao (ES001). A função passa a aceitar um único caso: o
//   DELETE da linha de um profissional cuja purga está em curso (app.purga_usuario = usuario_id
//   da linha) e cuja conta está bloqueada para exclusão há 30 dias ou mais pelo relógio do banco.
//   UPDATE e TRUNCATE seguem barrados para qualquer role; DELETE fora da purga também. A app não
//   tem DELETE nessas tabelas (o GRANT não muda), então só o owner chega ao trigger.
// SECURITY DEFINER do owner, search_path fixo, parâmetros tipados, sem SQL dinâmico. EXECUTE só
// para a app (REVOKE de PUBLIC); backup_ro não executa.

const NEGAR_ALTERACAO_ORIGINAL = `
CREATE OR REPLACE FUNCTION public.negar_alteracao() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tabela % é só de inclusão (% proibido)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'ES001';
END $$;`;

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE OR REPLACE FUNCTION public.negar_alteracao() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_usuario text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_usuario := pg_catalog.to_jsonb(OLD) ->> 'usuario_id';
    IF v_usuario IS NOT NULL
       AND v_usuario = pg_catalog.current_setting('app.purga_usuario', true)
       AND EXISTS (
         SELECT 1 FROM public.usuario u
         WHERE u.id = v_usuario::uuid
           AND u.bloqueado_exclusao_em IS NOT NULL
           AND u.bloqueado_exclusao_em + interval '720 hours' <= pg_catalog.now()
       ) THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'tabela % é só de inclusão (% proibido)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'ES001';
END $$;

CREATE FUNCTION tarefas.purgar_contas(p_agora timestamptz, p_limite integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_conta record;
  v_pedido timestamptz;
  v_total integer := 0;
  v_ant_usuario text := coalesce(current_setting('app.usuario_id', true), '');
  v_ant_purga text := coalesce(current_setting('app.purga_usuario', true), '');
  v_ant_assinatura text := coalesce(current_setting('app.tarefa_assinatura', true), '');
BEGIN
  IF p_agora IS NULL THEN
    RAISE EXCEPTION 'purgar_contas: agora ausente' USING ERRCODE = '22023';
  END IF;
  IF p_limite IS NULL OR p_limite < 1 OR p_limite > 1000 THEN
    RAISE EXCEPTION 'purgar_contas: limite fora de 1 a 1000' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('app.tarefa_assinatura', 'off', true);

  FOR v_conta IN
    SELECT u.id, u.email, u.bloqueado_exclusao_em
    FROM public.usuario u
    WHERE u.bloqueado_exclusao_em IS NOT NULL
      AND u.bloqueado_exclusao_em + interval '720 hours' <= p_agora
    ORDER BY u.bloqueado_exclusao_em, u.id
    LIMIT p_limite
    FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM set_config('app.usuario_id', v_conta.id::text, true);
    PERFORM set_config('app.purga_usuario', v_conta.id::text, true);

    SELECT max(a.criado_em) INTO v_pedido
    FROM public.audit_log a
    WHERE a.usuario_id = v_conta.id
      AND a.acao = 'conta.exclusao_pedida'
      AND a.criado_em <= v_conta.bloqueado_exclusao_em;

    INSERT INTO public.conta_excluida (id, pedido_em, purgado_em)
    VALUES (v_conta.id, coalesce(v_pedido, v_conta.bloqueado_exclusao_em), p_agora);

    -- Filhas antes das mães (chaves estrangeiras compostas com usuario_id).
    DELETE FROM public.anamnese_retificacao t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.evolucao_retificacao t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.pagamento_revisao t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.preco_sessao_revisao t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.preco_paciente_revisao t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.pagamento t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.preco_sessao t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.preco_paciente t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.evolucao t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.anamnese t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.modelo_anamnese_item t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.modelo_anamnese t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.consentimento_tcle t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.sessao_atendimento t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.serie_recorrencia t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.paciente t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.rascunho t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.modelo_texto t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.perfil t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.configuracao_usuario t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.limite_uso t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.notificacao_enviada t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.push_subscription t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.webhook_evento t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.assinatura t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.audit_log t WHERE t.usuario_id = v_conta.id;
    -- Identidade (sem RLS).
    DELETE FROM public.aceite_termos t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.credencial_senha t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.desafio_2fa t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.sessao t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.token_email t WHERE t.usuario_id = v_conta.id;
    DELETE FROM public.tentativa_login t
    WHERE t.tipo = 'email' AND t.chave_hash = sha256(convert_to(v_conta.email, 'UTF8'));
    DELETE FROM public.usuario u WHERE u.id = v_conta.id;

    v_total := v_total + 1;
  END LOOP;

  PERFORM set_config('app.usuario_id', v_ant_usuario, true);
  PERFORM set_config('app.purga_usuario', v_ant_purga, true);
  PERFORM set_config('app.tarefa_assinatura', v_ant_assinatura, true);
  RETURN v_total;
END $$;
ALTER FUNCTION tarefas.purgar_contas(timestamptz, integer) OWNER TO "owner";
REVOKE ALL ON FUNCTION tarefas.purgar_contas(timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tarefas.purgar_contas(timestamptz, integer) TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS tarefas.purgar_contas(timestamptz, integer);
${NEGAR_ALTERACAO_ORIGINAL}
`);
};
