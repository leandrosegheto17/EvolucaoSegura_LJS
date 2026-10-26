import type { MigrationBuilder } from 'node-pg-migrate';

// 0009_evolucao (T98; EVO-01, EVO-02, EVO-04, EVO-05, EVO-07, RAS-01, RAS-03, ISO-01 a ISO-04).
// Evolução, retificação, rascunho e modelo de texto, adaptados das migrations 0010, 0011 e 0018
// do legado.
// - evolucao: texto com algum caractere que não seja espaço em branco (não vazio depois de aparar,
//   como o trim do contrato), até 100.000 (EVO-01), de um paciente do
//   profissional e com `sessao_id` opcional. Uma evolução por sessão: índice único parcial em
//   `sessao_id` (EVO-02). Editável só no dia do cadastro em America/Sao_Paulo pelo relógio do
//   banco (EVO-04): o trigger recusa a alteração depois (SQLSTATE ES002, o mesmo da anamnese).
//   PREMISSA: a FK da sessão é (sessao_id, usuario_id), sem o paciente, porque a edição da sessão
//   pode trocar o paciente (T80) e uma FK com o paciente faria essa edição falhar; a API confere
//   na gravação que a sessão é do mesmo paciente.
// - evolucao_retificacao: texto novo e motivo, cada um não vazio e até 100.000 (EVO-05), com `seq`
//   único por evolução; só de inclusão (negar_alteracao, ES001), a original fica intacta.
//   "Só depois do dia do cadastro" (EVO-06) é da API, como na anamnese.
// - rascunho: um por (profissional, tipo, ref) (RAS-01), payload JSON objeto; substituído por
//   upsert e nunca apagado. Tipo e ref no formato do legado (`[A-Za-z0-9._:-]{1,120}`); o limite
//   de 512 KiB é da API, medido nos bytes do JSON enviado.
// - modelo_texto: só do tipo `evolucao` (RAS-03; `relatorio` saiu com D-01), nome aparado de 1 a
//   200, único sem diferenciar maiúsculas entre os não arquivados (como o índice do legado),
//   corpo até 50.000. Arquivar é preencher `arquivado_em`.
// - FKs compostas com usuario_id: nada referencia linha de outro profissional (ISO-02).
// RLS forçada nas quatro: a app só lê e escreve o que é do usuário da transação, sem DELETE nem
// TRUNCATE (EVO-07, ISO-03); backup_ro lê tudo.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.evolucao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  paciente_id uuid NOT NULL,
  sessao_id uuid,
  texto text NOT NULL CHECK (texto ~ '[^[:space:]]' AND char_length(texto) <= 100000),
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evolucao_id_usuario_uq UNIQUE (id, usuario_id),
  FOREIGN KEY (paciente_id, usuario_id) REFERENCES public.paciente (id, usuario_id),
  FOREIGN KEY (sessao_id, usuario_id) REFERENCES public.sessao_atendimento (id, usuario_id)
);
ALTER TABLE public.evolucao OWNER TO "owner";
CREATE UNIQUE INDEX evolucao_sessao_uq ON public.evolucao (sessao_id) WHERE sessao_id IS NOT NULL;
CREATE INDEX evolucao_paciente_idx ON public.evolucao (paciente_id, criado_em);

CREATE TABLE public.evolucao_retificacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  evolucao_id uuid NOT NULL,
  seq integer NOT NULL CHECK (seq >= 1),
  texto text NOT NULL CHECK (texto ~ '[^[:space:]]' AND char_length(texto) <= 100000),
  motivo text NOT NULL CHECK (motivo ~ '[^[:space:]]' AND char_length(motivo) <= 100000),
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT evolucao_retificacao_seq_uq UNIQUE (evolucao_id, seq),
  FOREIGN KEY (evolucao_id, usuario_id) REFERENCES public.evolucao (id, usuario_id)
);
ALTER TABLE public.evolucao_retificacao OWNER TO "owner";

CREATE TABLE public.rascunho (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  tipo text NOT NULL CHECK (tipo ~ '^[A-Za-z0-9._:-]{1,120}$'),
  ref text NOT NULL CHECK (ref ~ '^[A-Za-z0-9._:-]{1,120}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rascunho_chave_uq UNIQUE (usuario_id, tipo, ref)
);
ALTER TABLE public.rascunho OWNER TO "owner";

CREATE TABLE public.modelo_texto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  tipo text NOT NULL CHECK (tipo = 'evolucao'),
  nome text NOT NULL CHECK (nome = btrim(nome) AND char_length(nome) BETWEEN 1 AND 200),
  corpo text NOT NULL CHECK (char_length(corpo) <= 50000),
  arquivado_em timestamptz,
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.modelo_texto OWNER TO "owner";
CREATE UNIQUE INDEX modelo_texto_nome_uq ON public.modelo_texto (usuario_id, tipo, lower(nome))
  WHERE arquivado_em IS NULL;

-- EVO-04: a evolução só muda no dia do cadastro (America/Sao_Paulo, relógio do banco).
CREATE FUNCTION public.evolucao_janela_do_dia() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (OLD.criado_em AT TIME ZONE 'America/Sao_Paulo')::date
     <> (now() AT TIME ZONE 'America/Sao_Paulo')::date THEN
    RAISE EXCEPTION 'janela de edição encerrada: use a retificação' USING ERRCODE = 'ES002';
  END IF;
  RETURN NEW;
END $$;
ALTER FUNCTION public.evolucao_janela_do_dia() OWNER TO "owner";
CREATE TRIGGER evolucao_janela BEFORE UPDATE ON public.evolucao
  FOR EACH ROW EXECUTE FUNCTION public.evolucao_janela_do_dia();

CREATE TRIGGER evolucao_retificacao_so_inclusao BEFORE UPDATE OR DELETE
  ON public.evolucao_retificacao FOR EACH ROW EXECUTE FUNCTION public.negar_alteracao();
CREATE TRIGGER evolucao_retificacao_sem_truncate BEFORE TRUNCATE ON public.evolucao_retificacao
  FOR EACH STATEMENT EXECUTE FUNCTION public.negar_alteracao();

ALTER TABLE public.evolucao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolucao FORCE ROW LEVEL SECURITY;
CREATE POLICY evolucao_usuario ON public.evolucao
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY evolucao_backup_ro ON public.evolucao FOR SELECT TO backup_ro USING (true);

ALTER TABLE public.evolucao_retificacao ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evolucao_retificacao FORCE ROW LEVEL SECURITY;
CREATE POLICY evolucao_retificacao_usuario ON public.evolucao_retificacao
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY evolucao_retificacao_backup_ro ON public.evolucao_retificacao FOR SELECT
  TO backup_ro USING (true);

ALTER TABLE public.rascunho ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rascunho FORCE ROW LEVEL SECURITY;
CREATE POLICY rascunho_usuario ON public.rascunho
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY rascunho_backup_ro ON public.rascunho FOR SELECT TO backup_ro USING (true);

ALTER TABLE public.modelo_texto ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modelo_texto FORCE ROW LEVEL SECURITY;
CREATE POLICY modelo_texto_usuario ON public.modelo_texto
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY modelo_texto_backup_ro ON public.modelo_texto FOR SELECT TO backup_ro USING (true);

REVOKE ALL ON public.evolucao, public.evolucao_retificacao, public.rascunho, public.modelo_texto
  FROM PUBLIC, app;
GRANT SELECT ON public.evolucao, public.evolucao_retificacao, public.rascunho, public.modelo_texto
  TO backup_ro;
GRANT SELECT ON public.evolucao, public.evolucao_retificacao, public.rascunho, public.modelo_texto
  TO app;
GRANT INSERT (usuario_id, paciente_id, sessao_id, texto) ON public.evolucao TO app;
GRANT UPDATE (texto, row_version, atualizado_em) ON public.evolucao TO app;
GRANT INSERT (usuario_id, evolucao_id, seq, texto, motivo) ON public.evolucao_retificacao TO app;
GRANT INSERT (usuario_id, tipo, ref, payload) ON public.rascunho TO app;
GRANT UPDATE (payload, row_version, atualizado_em) ON public.rascunho TO app;
GRANT INSERT (usuario_id, tipo, nome, corpo) ON public.modelo_texto TO app;
GRANT UPDATE (nome, corpo, arquivado_em, row_version, atualizado_em) ON public.modelo_texto TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP TABLE IF EXISTS public.modelo_texto, public.rascunho, public.evolucao_retificacao,
  public.evolucao;
DROP FUNCTION IF EXISTS public.evolucao_janela_do_dia();
`);
};
