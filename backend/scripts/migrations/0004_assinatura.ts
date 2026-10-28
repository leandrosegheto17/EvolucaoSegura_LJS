import type { MigrationBuilder } from 'node-pg-migrate';

// 0004_assinatura (T41; PLANO-01, ISO-01, ISO-03, ISO-04). Cobrança do padrão LJS (tabela nova,
// sem origem no legado). As duas tabelas têm usuario_id e RLS forçada, então entram sozinhas no
// harness de isolamento.
// - assinatura: uma por profissional. O estado é restrito aos cinco do PLANO-01; o plano 'free'
//   anda só com o estado 'free', e 'pro' cobre trial, ativa, atrasada e cancelada (design). As
//   transições são do domínio; aqui fica só o que o banco consegue garantir sozinho.
// - webhook_evento: gravado antes de processar, com event_id único (PLANO-07). usuario_id fica
//   nulo quando o evento não corresponde a nenhum profissional (linha visível só ao evolucao_backup_ro).
//   A app só lê: gravar e processar ficam para as funções tarefas.* da etapa de cobrança.
// A app nunca apaga nem trunca. evolucao_backup_ro lê todas as linhas para o pg_dump.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.assinatura (
  usuario_id uuid PRIMARY KEY REFERENCES public.usuario (id),
  plano text NOT NULL CHECK (plano IN ('pro', 'free')),
  status text NOT NULL CHECK (status IN ('trial', 'ativa', 'atrasada', 'cancelada', 'free')),
  asaas_customer_id text CHECK (length(asaas_customer_id) BETWEEN 1 AND 100),
  asaas_subscription_id text CHECK (length(asaas_subscription_id) BETWEEN 1 AND 100),
  periodo_fim timestamptz NOT NULL,
  vencimento_atraso timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT assinatura_plano_status CHECK ((plano = 'free') = (status = 'free'))
);
ALTER TABLE public.assinatura OWNER TO "evolucao_owner";

CREATE TABLE public.webhook_evento (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id text NOT NULL UNIQUE CHECK (length(event_id) BETWEEN 1 AND 100),
  usuario_id uuid REFERENCES public.usuario (id),
  tipo text NOT NULL CHECK (length(tipo) BETWEEN 1 AND 100),
  payload jsonb NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz
);
ALTER TABLE public.webhook_evento OWNER TO "evolucao_owner";
CREATE INDEX webhook_evento_usuario_idx ON public.webhook_evento (usuario_id, recebido_em DESC);

ALTER TABLE public.assinatura ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assinatura FORCE ROW LEVEL SECURITY;
CREATE POLICY assinatura_usuario ON public.assinatura
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY assinatura_backup_ro ON public.assinatura FOR SELECT TO evolucao_backup_ro USING (true);

ALTER TABLE public.webhook_evento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_evento FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_evento_usuario ON public.webhook_evento
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY webhook_evento_backup_ro ON public.webhook_evento FOR SELECT TO evolucao_backup_ro
  USING (true);

REVOKE ALL ON public.assinatura, public.webhook_evento FROM PUBLIC, evolucao_app;
GRANT SELECT ON public.assinatura, public.webhook_evento TO evolucao_backup_ro;
-- CAD-04: a confirmação do e-mail cria a assinatura em trial. Mudanças de estado ficam para as
-- rotas e funções da etapa de cobrança, que concedem o que precisarem.
GRANT SELECT, INSERT (usuario_id, plano, status, periodo_fim) ON public.assinatura TO evolucao_app;
GRANT SELECT ON public.webhook_evento TO evolucao_app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TABLE IF EXISTS public.webhook_evento, public.assinatura;`);
};
