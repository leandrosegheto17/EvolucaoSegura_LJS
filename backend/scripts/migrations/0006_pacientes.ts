import type { MigrationBuilder } from 'node-pg-migrate';

// 0006_pacientes (T67; PAC-01, PAC-05, PAC-07, ISO-01, ISO-02, ISO-03, ISO-04). Pacientes e TCLE,
// adaptados da migration 0005 do legado, sem as colunas de IA (ia_ciencia_em, fora do escopo).
// - paciente: nome de 1 a 200 (obrigatório), telefone até 40, e-mail até 254 no formato x@y sem
//   espaços, endereço até 500. Texto vazio não é gravado: a API converte em null. Nasce ativo e
//   nunca é apagado (PAC-07): a app só troca `ativo` (com row_version e atualizado_em), sem
//   DELETE nem TRUNCATE. Sem tabela de revisão nem edição dos dados: a spec não pede.
// - consentimento_tcle: só inclusão (PAC-05). A app tem só SELECT e INSERT, e o trigger
//   negar_alteracao (0002) barra UPDATE, DELETE e TRUNCATE para qualquer role. A FK composta
//   (paciente_id, usuario_id) impede TCLE de paciente de outro profissional (ISO-02).
// RLS forçada nas duas: a app só lê e cria o que é do usuário da transação; evolucao_backup_ro lê tudo.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.paciente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  nome text NOT NULL CHECK (btrim(nome) <> '' AND char_length(nome) <= 200),
  telefone text CHECK (btrim(telefone) <> '' AND char_length(telefone) <= 40),
  email text CHECK (char_length(email) <= 254 AND email ~ '^[^[:space:]@]+@[^[:space:]@]+$'),
  endereco text CHECK (btrim(endereco) <> '' AND char_length(endereco) <= 500),
  ativo boolean NOT NULL DEFAULT true,
  row_version integer NOT NULL DEFAULT 1,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT paciente_id_usuario_uq UNIQUE (id, usuario_id)
);
ALTER TABLE public.paciente OWNER TO "evolucao_owner";
CREATE INDEX paciente_usuario_nome_idx ON public.paciente (usuario_id, lower(nome));

CREATE TABLE public.consentimento_tcle (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  paciente_id uuid NOT NULL,
  finalidade text NOT NULL
    CHECK (btrim(finalidade) <> '' AND char_length(finalidade) <= 500),
  data_consentimento date NOT NULL,
  versao_termo text NOT NULL
    CHECK (btrim(versao_termo) <> '' AND char_length(versao_termo) <= 50),
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (paciente_id, usuario_id) REFERENCES public.paciente (id, usuario_id)
);
ALTER TABLE public.consentimento_tcle OWNER TO "evolucao_owner";
CREATE INDEX consentimento_tcle_paciente_idx ON public.consentimento_tcle (paciente_id);

CREATE TRIGGER consentimento_tcle_so_inclusao BEFORE UPDATE OR DELETE
  ON public.consentimento_tcle FOR EACH ROW EXECUTE FUNCTION public.negar_alteracao();
CREATE TRIGGER consentimento_tcle_sem_truncate BEFORE TRUNCATE ON public.consentimento_tcle
  FOR EACH STATEMENT EXECUTE FUNCTION public.negar_alteracao();

ALTER TABLE public.paciente ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paciente FORCE ROW LEVEL SECURITY;
CREATE POLICY paciente_usuario ON public.paciente
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY paciente_backup_ro ON public.paciente FOR SELECT TO evolucao_backup_ro USING (true);

ALTER TABLE public.consentimento_tcle ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consentimento_tcle FORCE ROW LEVEL SECURITY;
CREATE POLICY consentimento_tcle_usuario ON public.consentimento_tcle
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY consentimento_tcle_backup_ro ON public.consentimento_tcle FOR SELECT
  TO evolucao_backup_ro USING (true);

REVOKE ALL ON public.paciente, public.consentimento_tcle FROM PUBLIC, evolucao_app;
GRANT SELECT ON public.paciente, public.consentimento_tcle TO evolucao_backup_ro;
GRANT SELECT ON public.paciente, public.consentimento_tcle TO evolucao_app;
GRANT INSERT (usuario_id, nome, telefone, email, endereco) ON public.paciente TO evolucao_app;
GRANT UPDATE (ativo, row_version, atualizado_em) ON public.paciente TO evolucao_app;
GRANT INSERT (usuario_id, paciente_id, finalidade, data_consentimento, versao_termo)
  ON public.consentimento_tcle TO evolucao_app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`DROP TABLE IF EXISTS public.consentimento_tcle, public.paciente;`);
};
