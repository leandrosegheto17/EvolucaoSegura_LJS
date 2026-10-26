import type { MigrationBuilder } from 'node-pg-migrate';

// 0008_anamnese (T89; ANA-02, ANA-03, ANA-04, ANA-05, ANA-06, ISO-01, ISO-02, ISO-03, ISO-04).
// Anamnese configurável, adaptada das migrations 0009, 0028 e 0029 do legado.
// - modelo_anamnese: um por especialidade do profissional (o perfil tem uma só; trocar de
//   especialidade sem anamnese usa o modelo da nova). `revisao` sobe a cada edição do modelo.
// - modelo_anamnese_item: campo (texto livre) ou alerta, com id estável. Rótulo aparado de 1 a 60,
//   único no modelo sem diferenciar maiúsculas entre os itens vigentes; no máximo um campo
//   especial "Frequência" (ANA-02). "Remover" é marcar `removido` (a app não tem DELETE).
//   `revisao_inclusao` diz em que revisão do modelo o item entrou (ANA-04: revisão futura).
//   O bloqueio do ANA-03 (com anamnese, só incluir) é da API, que trava o modelo FOR UPDATE.
// - anamnese: uma por paciente (ANA-04), `valores jsonb` (objeto por id de item) e
//   `modelo_revisao`. Editável só no dia do cadastro em America/Sao_Paulo pelo relógio do banco
//   (ANA-05): o trigger recusa a alteração depois (SQLSTATE ES002), também na virada do dia.
//   `data_sessao` vem da anamnese do legado (0009).
// - anamnese_retificacao: nova versão completa (valores e modelo_revisao) com motivo de 1 a
//   5.000 e `seq` único por anamnese; só de inclusão (negar_alteracao, ES001), a original fica
//   intacta (ANA-06). "Só depois do dia do cadastro" (ANA-07) é checado pela API.
// - Sem o schema morto do legado (texto de 20.000 e observação de 5.000) nem as colunas fixas
//   de psicologia: o conteúdo vai em `valores`.
// - FKs compostas com usuario_id: nada referencia linha de outro profissional (ISO-02).
// RLS forçada nas quatro: a app só lê e escreve o que é do usuário da transação, sem DELETE nem
// TRUNCATE; backup_ro lê tudo.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.modelo_anamnese (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  especialidade text NOT NULL
    CHECK (especialidade IN ('psicologia', 'nutricao', 'fisioterapia', 'outra')),
  revisao integer NOT NULL DEFAULT 1 CHECK (revisao >= 1),
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modelo_anamnese_especialidade_uq UNIQUE (usuario_id, especialidade),
  CONSTRAINT modelo_anamnese_id_usuario_uq UNIQUE (id, usuario_id)
);
ALTER TABLE public.modelo_anamnese OWNER TO "owner";

CREATE TABLE public.modelo_anamnese_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  modelo_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('campo', 'alerta')),
  especial boolean NOT NULL DEFAULT false,
  rotulo text NOT NULL CHECK (rotulo = btrim(rotulo) AND char_length(rotulo) BETWEEN 1 AND 60),
  ordem integer NOT NULL CHECK (ordem >= 0),
  revisao_inclusao integer NOT NULL CHECK (revisao_inclusao >= 1),
  removido boolean NOT NULL DEFAULT false,
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  -- "Frequência" (ANA-02) só existe em campo.
  CONSTRAINT modelo_anamnese_item_especial_ck CHECK (NOT especial OR tipo = 'campo'),
  FOREIGN KEY (modelo_id, usuario_id) REFERENCES public.modelo_anamnese (id, usuario_id)
);
ALTER TABLE public.modelo_anamnese_item OWNER TO "owner";
CREATE UNIQUE INDEX modelo_anamnese_item_rotulo_uq
  ON public.modelo_anamnese_item (modelo_id, lower(rotulo)) WHERE NOT removido;
CREATE UNIQUE INDEX modelo_anamnese_item_especial_uq
  ON public.modelo_anamnese_item (modelo_id) WHERE especial AND NOT removido;
CREATE INDEX modelo_anamnese_item_modelo_idx ON public.modelo_anamnese_item (modelo_id, ordem);

CREATE TABLE public.anamnese (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  paciente_id uuid NOT NULL,
  modelo_id uuid NOT NULL,
  data_sessao date NOT NULL,
  modelo_revisao integer NOT NULL CHECK (modelo_revisao >= 1),
  valores jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(valores) = 'object'),
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anamnese_paciente_uq UNIQUE (paciente_id),
  CONSTRAINT anamnese_id_usuario_uq UNIQUE (id, usuario_id),
  FOREIGN KEY (paciente_id, usuario_id) REFERENCES public.paciente (id, usuario_id),
  FOREIGN KEY (modelo_id, usuario_id) REFERENCES public.modelo_anamnese (id, usuario_id)
);
ALTER TABLE public.anamnese OWNER TO "owner";

CREATE TABLE public.anamnese_retificacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  anamnese_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  motivo text NOT NULL CHECK (btrim(motivo) <> '' AND char_length(motivo) <= 5000),
  modelo_revisao integer NOT NULL CHECK (modelo_revisao >= 1),
  valores jsonb NOT NULL CHECK (jsonb_typeof(valores) = 'object'),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT anamnese_retificacao_seq_uq UNIQUE (anamnese_id, seq),
  FOREIGN KEY (anamnese_id, usuario_id) REFERENCES public.anamnese (id, usuario_id)
);
ALTER TABLE public.anamnese_retificacao OWNER TO "owner";

-- ANA-05: a anamnese só muda no dia do cadastro (America/Sao_Paulo, relógio do banco).
CREATE FUNCTION public.anamnese_janela_do_dia() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD.criado_em AT TIME ZONE 'America/Sao_Paulo')::date
     <> (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'janela de edição encerrada: use a retificação' USING ERRCODE = 'ES002';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.anamnese_janela_do_dia() OWNER TO "owner";
CREATE TRIGGER anamnese_janela BEFORE UPDATE ON public.anamnese
  FOR EACH ROW EXECUTE FUNCTION public.anamnese_janela_do_dia();

CREATE TRIGGER anamnese_retificacao_so_inclusao BEFORE UPDATE OR DELETE
  ON public.anamnese_retificacao FOR EACH ROW EXECUTE FUNCTION public.negar_alteracao();
CREATE TRIGGER anamnese_retificacao_sem_truncate BEFORE TRUNCATE ON public.anamnese_retificacao
  FOR EACH STATEMENT EXECUTE FUNCTION public.negar_alteracao();

ALTER TABLE public.modelo_anamnese ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modelo_anamnese FORCE ROW LEVEL SECURITY;
CREATE POLICY modelo_anamnese_usuario ON public.modelo_anamnese
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY modelo_anamnese_backup_ro ON public.modelo_anamnese FOR SELECT
  TO backup_ro USING (true);

ALTER TABLE public.modelo_anamnese_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modelo_anamnese_item FORCE ROW LEVEL SECURITY;
CREATE POLICY modelo_anamnese_item_usuario ON public.modelo_anamnese_item
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY modelo_anamnese_item_backup_ro ON public.modelo_anamnese_item FOR SELECT
  TO backup_ro USING (true);

ALTER TABLE public.anamnese ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anamnese FORCE ROW LEVEL SECURITY;
CREATE POLICY anamnese_usuario ON public.anamnese
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY anamnese_backup_ro ON public.anamnese FOR SELECT TO backup_ro USING (true);

ALTER TABLE public.anamnese_retificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anamnese_retificacao FORCE ROW LEVEL SECURITY;
CREATE POLICY anamnese_retificacao_usuario ON public.anamnese_retificacao
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY anamnese_retificacao_backup_ro ON public.anamnese_retificacao FOR SELECT
  TO backup_ro USING (true);

REVOKE ALL ON public.modelo_anamnese, public.modelo_anamnese_item, public.anamnese,
  public.anamnese_retificacao FROM PUBLIC, app;
GRANT SELECT ON public.modelo_anamnese, public.modelo_anamnese_item, public.anamnese,
  public.anamnese_retificacao TO backup_ro;
GRANT SELECT ON public.modelo_anamnese, public.modelo_anamnese_item, public.anamnese,
  public.anamnese_retificacao TO app;
GRANT INSERT (usuario_id, especialidade) ON public.modelo_anamnese TO app;
GRANT UPDATE (revisao, row_version, atualizado_em) ON public.modelo_anamnese TO app;
GRANT INSERT (usuario_id, modelo_id, tipo, especial, rotulo, ordem, revisao_inclusao)
  ON public.modelo_anamnese_item TO app;
GRANT UPDATE (tipo, especial, rotulo, ordem, removido, row_version, atualizado_em)
  ON public.modelo_anamnese_item TO app;
GRANT INSERT (usuario_id, paciente_id, modelo_id, data_sessao, modelo_revisao, valores)
  ON public.anamnese TO app;
GRANT UPDATE (modelo_revisao, valores, row_version, atualizado_em) ON public.anamnese TO app;
GRANT INSERT (usuario_id, anamnese_id, seq, motivo, modelo_revisao, valores)
  ON public.anamnese_retificacao TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP TABLE IF EXISTS public.anamnese_retificacao, public.anamnese, public.modelo_anamnese_item,
  public.modelo_anamnese;
DROP FUNCTION IF EXISTS public.anamnese_janela_do_dia();
`);
};
