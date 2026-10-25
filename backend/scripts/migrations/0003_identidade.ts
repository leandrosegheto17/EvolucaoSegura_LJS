import type { MigrationBuilder } from 'node-pg-migrate';

// 0003_identidade (T40; AUTH-12, CAD-03, ISO-03, ISO-04). Tabelas de identidade, adaptadas da
// 0003 do legado. Ficam SEM RLS, conforme o design: o login, o cadastro e a confirmação rodam
// antes de existir usuário na transação. O acesso é limitado por grants mínimos por coluna e por
// funções; o harness de isolamento lista cada tabela daqui como exceção justificada.
// - Senha: hash bcrypt de custo 12 calculado só no Postgres (OPS-14), sempre com a senha como
//   parâmetro, por definir_senha() e conferir_senha(). A app não lê credencial_senha.
// - Token de e-mail e sessão: só o SHA-256 (32 bytes) do valor de 256 bits. Código 2FA: só o
//   HMAC-SHA256 (32 bytes). Nenhuma coluna guarda o valor em claro.
// - A app nunca apaga nem trunca: encerrar, usar e invalidar são UPDATE de data. Limpeza e purga
//   ficam para funções tarefas.* (ADR-005).
// - tentativa_login guarda o SHA-256 da chave (e-mail ou IP), não o e-mail.

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.usuario (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  nome text NOT NULL CHECK (length(nome) BETWEEN 1 AND 200),
  confirmado_em timestamptz,
  bloqueado_exclusao_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.credencial_senha (
  usuario_id uuid PRIMARY KEY REFERENCES public.usuario (id),
  hash text NOT NULL CHECK (hash ~ '^[$]2[abxy][$][0-9]{2}[$][./A-Za-z0-9]{53}$'),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.sessao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  criada_em timestamptz NOT NULL DEFAULT now(),
  ultimo_uso_em timestamptz NOT NULL DEFAULT now(),
  encerrada_em timestamptz
);
CREATE INDEX sessao_usuario_idx ON public.sessao (usuario_id) WHERE encerrada_em IS NULL;

CREATE TABLE public.desafio_2fa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  codigo_hmac bytea NOT NULL CHECK (octet_length(codigo_hmac) = 32),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  erros integer NOT NULL DEFAULT 0 CHECK (erros BETWEEN 0 AND 5),
  usado_em timestamptz,
  invalidado_em timestamptz
);
CREATE INDEX desafio_2fa_usuario_idx ON public.desafio_2fa (usuario_id, criado_em DESC);

CREATE TABLE public.token_email (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  tipo text NOT NULL CHECK (tipo IN ('confirmacao', 'recuperacao', 'exclusao', 'desistencia')),
  token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz,
  invalidado_em timestamptz
);
CREATE INDEX token_email_usuario_tipo_idx ON public.token_email (usuario_id, tipo);

CREATE TABLE public.tentativa_login (
  tipo text NOT NULL CHECK (tipo IN ('email', 'ip')),
  chave_hash bytea NOT NULL CHECK (octet_length(chave_hash) = 32),
  falhas integer NOT NULL DEFAULT 0 CHECK (falhas >= 0),
  janela_inicio timestamptz,
  bloqueado_ate timestamptz,
  PRIMARY KEY (tipo, chave_hash)
);

CREATE TABLE public.aceite_termos (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  versao_termos text NOT NULL CHECK (length(versao_termos) BETWEEN 1 AND 20),
  versao_privacidade text NOT NULL CHECK (length(versao_privacidade) BETWEEN 1 AND 20),
  aceito_em timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX aceite_termos_usuario_idx ON public.aceite_termos (usuario_id);

ALTER TABLE public.usuario OWNER TO "owner";
ALTER TABLE public.credencial_senha OWNER TO "owner";
ALTER TABLE public.sessao OWNER TO "owner";
ALTER TABLE public.desafio_2fa OWNER TO "owner";
ALTER TABLE public.token_email OWNER TO "owner";
ALTER TABLE public.tentativa_login OWNER TO "owner";
ALTER TABLE public.aceite_termos OWNER TO "owner";

-- Grants mínimos da app, por coluna. Nada de DELETE nem TRUNCATE; credencial_senha só pelas
-- funções abaixo. backup_ro lê tudo para o pg_dump.
REVOKE ALL ON public.usuario, public.credencial_senha, public.sessao, public.desafio_2fa,
  public.token_email, public.tentativa_login, public.aceite_termos FROM PUBLIC, app;
GRANT SELECT ON public.usuario, public.credencial_senha, public.sessao, public.desafio_2fa,
  public.token_email, public.tentativa_login, public.aceite_termos TO backup_ro;

GRANT SELECT, INSERT (email, nome) ON public.usuario TO app;
GRANT UPDATE (nome, confirmado_em, bloqueado_exclusao_em) ON public.usuario TO app;
GRANT SELECT, INSERT (usuario_id, token_hash) ON public.sessao TO app;
GRANT UPDATE (ultimo_uso_em, encerrada_em) ON public.sessao TO app;
GRANT SELECT, INSERT (usuario_id, codigo_hmac, expira_em) ON public.desafio_2fa TO app;
GRANT UPDATE (erros, usado_em, invalidado_em) ON public.desafio_2fa TO app;
GRANT SELECT, INSERT (usuario_id, tipo, token_hash, expira_em) ON public.token_email TO app;
GRANT UPDATE (usado_em, invalidado_em) ON public.token_email TO app;
GRANT SELECT, INSERT (tipo, chave_hash, falhas, janela_inicio, bloqueado_ate)
  ON public.tentativa_login TO app;
GRANT UPDATE (falhas, janela_inicio, bloqueado_ate) ON public.tentativa_login TO app;
GRANT SELECT, INSERT (usuario_id, versao_termos, versao_privacidade) ON public.aceite_termos TO app;

-- A 0001 tira o EXECUTE padrão de PUBLIC em funções novas, e isso alcança as do pgcrypto. As
-- funções abaixo rodam como owner e precisam só destas duas.
GRANT EXECUTE ON FUNCTION public.crypt(text, text), public.gen_salt(text, integer) TO "owner";

-- AUTH-12: grava (ou troca) o hash bcrypt de custo 12. A senha chega como parâmetro e nunca
-- sai do banco.
CREATE FUNCTION public.definir_senha(p_usuario_id uuid, p_senha text) RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
  INSERT INTO public.credencial_senha (usuario_id, hash)
  VALUES (p_usuario_id, public.crypt(p_senha, public.gen_salt('bf', 12)))
  ON CONFLICT (usuario_id) DO UPDATE SET hash = EXCLUDED.hash, atualizado_em = now();
$$;

-- AUTH-12, AUTH-02: devolve o id do usuário se a senha confere e null em qualquer outro caso.
-- Sem credencial para o e-mail, calcula um hash de mesmo custo para o tempo ser equivalente.
-- Confirmação e bloqueio da conta são checados pela rota, com a mesma resposta.
CREATE FUNCTION public.conferir_senha(p_email text, p_senha text) RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
AS $$
DECLARE
  v_id uuid;
  v_hash text;
BEGIN
  SELECT u.id, c.hash INTO v_id, v_hash
  FROM public.usuario u JOIN public.credencial_senha c ON c.usuario_id = u.id
  WHERE u.email = p_email;
  IF v_hash IS NULL THEN
    PERFORM public.crypt(p_senha, public.gen_salt('bf', 12));
    RETURN NULL;
  END IF;
  IF public.crypt(p_senha, v_hash) = v_hash THEN
    RETURN v_id;
  END IF;
  RETURN NULL;
END $$;

ALTER FUNCTION public.definir_senha(uuid, text) OWNER TO "owner";
ALTER FUNCTION public.conferir_senha(text, text) OWNER TO "owner";
REVOKE ALL ON FUNCTION public.definir_senha(uuid, text), public.conferir_senha(text, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.definir_senha(uuid, text), public.conferir_senha(text, text)
  TO app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS public.conferir_senha(text, text);
DROP FUNCTION IF EXISTS public.definir_senha(uuid, text);
DROP TABLE IF EXISTS public.aceite_termos, public.tentativa_login, public.token_email,
  public.desafio_2fa, public.sessao, public.credencial_senha, public.usuario;
`);
};
