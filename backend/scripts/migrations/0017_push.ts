import type { MigrationBuilder } from 'node-pg-migrate';

// 0017_push (T140; PUSH-01, PUSH-02 a PUSH-04, ISO-01, ISO-03, ISO-04). Tabelas do push (novas,
// padrão LJS, sem origem no legado). As duas têm usuario_id e RLS forçada, então entram sozinhas
// no harness de isolamento.
// - push_subscription: a assinatura Web Push de um dispositivo (PUSH-01). O endpoint é único
//   (design): o mesmo dispositivo nunca fica duas vezes. Chaves p256dh e auth em base64url, como
//   o navegador as entrega (PushSubscription.toJSON). Desativar remove a linha, então a app tem
//   DELETE (ISO-03 proíbe DELETE só em dado clínico, financeiro e de auditoria; a assinatura não é
//   nenhum deles). A app só atualiza as chaves, nunca o dono nem o endpoint.
// - notificacao_enviada: o que já foi enviado, único por profissional, tipo e referência (design:
//   "tipo, ref, única"). É a garantia de "uma única vez" das tarefas do cron e do webhook
//   (PUSH-02 a PUSH-04): a tarefa grava antes de enviar e a duplicata viola a restrição. A
//   referência é do profissional (ex.: o dia de "evolução pendente" é o mesmo para todos), por
//   isso a chave inclui usuario_id. A app só grava e lê: apagar ou alterar reabriria um envio.
// evolucao_backup_ro lê todas as linhas para o pg_dump.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.push_subscription (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  endpoint text NOT NULL UNIQUE
    CHECK (char_length(endpoint) <= 2048 AND endpoint ~ '^https://[^[:space:]]+$'),
  p256dh text NOT NULL CHECK (char_length(p256dh) <= 200 AND p256dh ~ '^[A-Za-z0-9_-]+={0,2}$'),
  auth text NOT NULL CHECK (char_length(auth) <= 100 AND auth ~ '^[A-Za-z0-9_-]+={0,2}$'),
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.push_subscription OWNER TO "evolucao_owner";
CREATE INDEX push_subscription_usuario_idx ON public.push_subscription (usuario_id);

CREATE TABLE public.notificacao_enviada (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  tipo text NOT NULL CHECK (tipo IN ('sessao_proxima', 'evolucao_pendente', 'cobranca_gerada',
    'pagamento_confirmado', 'cobranca_vencida', 'trial_terminando')),
  ref text NOT NULL CHECK (char_length(ref) BETWEEN 1 AND 200),
  enviada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notificacao_enviada_uq UNIQUE (usuario_id, tipo, ref)
);
ALTER TABLE public.notificacao_enviada OWNER TO "evolucao_owner";

ALTER TABLE public.push_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY push_subscription_usuario ON public.push_subscription
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY push_subscription_backup_ro ON public.push_subscription FOR SELECT TO evolucao_backup_ro
  USING (true);

ALTER TABLE public.notificacao_enviada ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacao_enviada FORCE ROW LEVEL SECURITY;
CREATE POLICY notificacao_enviada_usuario ON public.notificacao_enviada
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY notificacao_enviada_backup_ro ON public.notificacao_enviada FOR SELECT TO evolucao_backup_ro
  USING (true);

REVOKE ALL ON public.push_subscription, public.notificacao_enviada FROM PUBLIC, evolucao_app;
GRANT SELECT ON public.push_subscription, public.notificacao_enviada TO evolucao_backup_ro;
GRANT SELECT, INSERT, DELETE ON public.push_subscription TO evolucao_app;
GRANT UPDATE (p256dh, auth) ON public.push_subscription TO evolucao_app;
GRANT SELECT, INSERT ON public.notificacao_enviada TO evolucao_app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP TABLE IF EXISTS public.notificacao_enviada;
DROP TABLE IF EXISTS public.push_subscription;
`);
};
