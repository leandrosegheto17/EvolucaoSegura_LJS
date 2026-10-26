import type { MigrationBuilder } from 'node-pg-migrate';

// 0010_financeiro (T107; FIN-01, FIN-02, FIN-05, FIN-08, ISO-01 a ISO-04). Preço por paciente,
// ajuste de preço por sessão e pagamento, adaptados das migrations 0013, 0017 e 0022 do legado,
// com uma troca: o legado gravava numeric(10,2) em reais; aqui o valor é `bigint` em centavos
// (FIN-01; ADR-007), de 0 a 9.999.999.999 (o mesmo teto do numeric(10,2)).
// - preco_paciente: um por paciente; preco_sessao: um ajuste por sessão; pagamento: um por sessão
//   (FIN-05), com data (date) e meio da lista fechada do legado (0022).
// - Revisão antes/depois (FIN-02): trigger AFTER UPDATE grava a linha antiga e a nova em
//   <tabela>_revisao quando algo além de row_version e atualizado_em muda. A função é SECURITY
//   DEFINER do owner (a app não insere revisão); as revisões são só de inclusão (negar_alteracao).
// - FKs compostas com usuario_id: nada referencia linha de outro profissional (ISO-02).
// RLS forçada nas seis: a app só lê e escreve o que é do usuário da transação, sem DELETE nem
// TRUNCATE (FIN-08, ISO-03); backup_ro lê tudo (ISO-04).

const VALOR = `valor_centavos bigint NOT NULL CHECK (valor_centavos BETWEEN 0 AND 9999999999)`;

// Tabela de revisão + trigger da tabela principal.
const revisao = (tabela: string): string => `
CREATE TABLE public.${tabela}_revisao (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  ${tabela}_id uuid NOT NULL,
  antes jsonb NOT NULL,
  depois jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (${tabela}_id, usuario_id) REFERENCES public.${tabela} (id, usuario_id)
);
ALTER TABLE public.${tabela}_revisao OWNER TO "owner";
CREATE INDEX ${tabela}_revisao_idx ON public.${tabela}_revisao (${tabela}_id, criado_em);

CREATE FUNCTION public.${tabela}_registrar_revisao() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF to_jsonb(NEW) - 'row_version' - 'atualizado_em'
     = to_jsonb(OLD) - 'row_version' - 'atualizado_em' THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.${tabela}_revisao (usuario_id, ${tabela}_id, antes, depois)
  VALUES (OLD.usuario_id, OLD.id, to_jsonb(OLD), to_jsonb(NEW));
  RETURN NEW;
END $$;
ALTER FUNCTION public.${tabela}_registrar_revisao() OWNER TO "owner";
REVOKE ALL ON FUNCTION public.${tabela}_registrar_revisao() FROM PUBLIC;
CREATE TRIGGER ${tabela}_revisao AFTER UPDATE ON public.${tabela}
  FOR EACH ROW EXECUTE FUNCTION public.${tabela}_registrar_revisao();

CREATE TRIGGER ${tabela}_revisao_so_inclusao BEFORE UPDATE OR DELETE
  ON public.${tabela}_revisao FOR EACH ROW EXECUTE FUNCTION public.negar_alteracao();
CREATE TRIGGER ${tabela}_revisao_sem_truncate BEFORE TRUNCATE ON public.${tabela}_revisao
  FOR EACH STATEMENT EXECUTE FUNCTION public.negar_alteracao();
`;

const rls = (tabela: string): string => `
ALTER TABLE public.${tabela} ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.${tabela} FORCE ROW LEVEL SECURITY;
CREATE POLICY ${tabela}_usuario ON public.${tabela}
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY ${tabela}_backup_ro ON public.${tabela} FOR SELECT TO backup_ro USING (true);
`;

const TODAS = [
  'preco_paciente',
  'preco_paciente_revisao',
  'preco_sessao',
  'preco_sessao_revisao',
  'pagamento',
  'pagamento_revisao',
];

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.preco_paciente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  paciente_id uuid NOT NULL,
  ${VALOR},
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preco_paciente_paciente_uq UNIQUE (paciente_id),
  CONSTRAINT preco_paciente_id_usuario_uq UNIQUE (id, usuario_id),
  FOREIGN KEY (paciente_id, usuario_id) REFERENCES public.paciente (id, usuario_id)
);
ALTER TABLE public.preco_paciente OWNER TO "owner";

CREATE TABLE public.preco_sessao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  sessao_id uuid NOT NULL,
  ${VALOR},
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT preco_sessao_sessao_uq UNIQUE (sessao_id),
  CONSTRAINT preco_sessao_id_usuario_uq UNIQUE (id, usuario_id),
  FOREIGN KEY (sessao_id, usuario_id) REFERENCES public.sessao_atendimento (id, usuario_id)
);
ALTER TABLE public.preco_sessao OWNER TO "owner";

CREATE TABLE public.pagamento (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  sessao_id uuid NOT NULL,
  ${VALOR},
  data_pagamento date NOT NULL,
  meio text NOT NULL CHECK (meio IN ('dinheiro', 'pix', 'cartao', 'transferencia', 'outro')),
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pagamento_sessao_uq UNIQUE (sessao_id),
  CONSTRAINT pagamento_id_usuario_uq UNIQUE (id, usuario_id),
  FOREIGN KEY (sessao_id, usuario_id) REFERENCES public.sessao_atendimento (id, usuario_id)
);
ALTER TABLE public.pagamento OWNER TO "owner";

${revisao('preco_paciente')}
${revisao('preco_sessao')}
${revisao('pagamento')}
${TODAS.map(rls).join('')}

REVOKE ALL ON ${TODAS.map((t) => `public.${t}`).join(', ')} FROM PUBLIC, app;
GRANT SELECT ON ${TODAS.map((t) => `public.${t}`).join(', ')} TO backup_ro;
GRANT SELECT ON ${TODAS.map((t) => `public.${t}`).join(', ')} TO app;
GRANT INSERT (usuario_id, paciente_id, valor_centavos) ON public.preco_paciente TO app;
GRANT UPDATE (valor_centavos, row_version, atualizado_em) ON public.preco_paciente TO app;
GRANT INSERT (usuario_id, sessao_id, valor_centavos) ON public.preco_sessao TO app;
GRANT UPDATE (valor_centavos, row_version, atualizado_em) ON public.preco_sessao TO app;
GRANT INSERT (usuario_id, sessao_id, valor_centavos, data_pagamento, meio) ON public.pagamento TO app;
GRANT UPDATE (valor_centavos, data_pagamento, meio, row_version, atualizado_em)
  ON public.pagamento TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP TABLE IF EXISTS public.pagamento_revisao, public.preco_sessao_revisao,
  public.preco_paciente_revisao, public.pagamento, public.preco_sessao, public.preco_paciente;
DROP FUNCTION IF EXISTS public.pagamento_registrar_revisao();
DROP FUNCTION IF EXISTS public.preco_sessao_registrar_revisao();
DROP FUNCTION IF EXISTS public.preco_paciente_registrar_revisao();
`);
};
