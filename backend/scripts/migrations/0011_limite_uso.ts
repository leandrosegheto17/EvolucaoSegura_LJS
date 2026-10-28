import type { MigrationBuilder } from 'node-pg-migrate';

// 0011_limite_uso (T120; EXP-05, ISO-01 a ISO-04). Contador de uso por chave e janela, guardado
// em tabela (EXP-05: mais de 5 exportações iniciadas em 60 s responde 429). Tabela nova, sem
// origem no legado: lá o contador era um Map em memória por processo (export-limits.ts), com a
// mesma regra de janela fixa, que aqui passa para o banco.
// - Uma linha por profissional e chave (ex.: 'exportacao'), com o início da janela e a contagem.
// - public.contar_uso(chave, janela_segundos) conta um uso e devolve a contagem da janela,
//   incluindo este. A janela começa no primeiro uso; quando now() chega a início + janela, a
//   próxima chamada abre outra (contagem volta a 1), como no legado. Quem chama compara com o
//   limite. É um único INSERT ... ON CONFLICT DO UPDATE: chamadas simultâneas da mesma chave
//   esperam o bloqueio da linha e nenhuma contagem se perde.
// - A função é SECURITY DEFINER do owner e conta só para app_usuario_id(): a app só lê a tabela e
//   não consegue zerar nem forjar o contador. Ela usa só app_usuario_id() (do owner) e funções do
//   pg_catalog; não precisa de GRANT EXECUTE extra ao owner (a 0003 precisou para o pgcrypto).
// RLS forçada: cada profissional só vê o próprio contador; evolucao_backup_ro lê tudo (ISO-04). Sem DELETE
// nem TRUNCATE para a app (ISO-03).

export const up = (pgm: MigrationBuilder): void => {
  pgm.sql(`
CREATE TABLE public.limite_uso (
  usuario_id uuid NOT NULL REFERENCES public.usuario (id),
  chave text NOT NULL CHECK (chave ~ '^[a-z0-9_.:-]{1,100}$'),
  janela_inicio timestamptz NOT NULL DEFAULT now(),
  contagem integer NOT NULL DEFAULT 1 CHECK (contagem >= 1),
  PRIMARY KEY (usuario_id, chave)
);
ALTER TABLE public.limite_uso OWNER TO "evolucao_owner";

ALTER TABLE public.limite_uso ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.limite_uso FORCE ROW LEVEL SECURITY;
CREATE POLICY limite_uso_usuario ON public.limite_uso
  USING (usuario_id = public.app_usuario_id())
  WITH CHECK (usuario_id = public.app_usuario_id());
CREATE POLICY limite_uso_backup_ro ON public.limite_uso FOR SELECT TO evolucao_backup_ro USING (true);

REVOKE ALL ON public.limite_uso FROM PUBLIC, evolucao_app;
GRANT SELECT ON public.limite_uso TO evolucao_backup_ro, evolucao_app;

CREATE FUNCTION public.contar_uso(p_chave text, p_janela_segundos integer) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_usuario uuid := public.app_usuario_id();
  v_contagem integer;
BEGIN
  IF v_usuario IS NULL THEN
    RAISE EXCEPTION 'contar_uso: sem usuário na transação' USING ERRCODE = '42501';
  END IF;
  IF p_janela_segundos IS NULL OR p_janela_segundos < 1 THEN
    RAISE EXCEPTION 'contar_uso: janela inválida' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.limite_uso AS l (usuario_id, chave, janela_inicio, contagem)
  VALUES (v_usuario, p_chave, now(), 1)
  ON CONFLICT (usuario_id, chave) DO UPDATE SET
    contagem = CASE WHEN now() >= l.janela_inicio + make_interval(secs => p_janela_segundos)
                    THEN 1 ELSE l.contagem + 1 END,
    janela_inicio = CASE WHEN now() >= l.janela_inicio + make_interval(secs => p_janela_segundos)
                         THEN now() ELSE l.janela_inicio END
  RETURNING l.contagem INTO v_contagem;
  RETURN v_contagem;
END $$;
ALTER FUNCTION public.contar_uso(text, integer) OWNER TO "evolucao_owner";
REVOKE ALL ON FUNCTION public.contar_uso(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.contar_uso(text, integer) TO evolucao_app;
`);
};

export const down = (pgm: MigrationBuilder): void => {
  pgm.sql(`
DROP FUNCTION IF EXISTS public.contar_uso(text, integer);
DROP TABLE IF EXISTS public.limite_uso;
`);
};
