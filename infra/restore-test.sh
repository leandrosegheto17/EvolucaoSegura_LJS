#!/usr/bin/env bash
# restore-test.sh (T162, OPS-02): restaura o dump cifrado do backup.yml (pg_dump -Fc | age) num banco
# DESCARTAVEL de um Postgres de teste, imprime a contagem de linhas por tabela e apaga o banco.
# Uso: infra/restore-test.sh <backup.dump.age|backup.dump>
# Env obrigatorio: RESTORE_ADMIN_URL  (Postgres descartavel com CREATEDB/CREATEROLE; NUNCA producao;
#                                      ex.: postgresql://postgres:postgres@localhost:5433/postgres)
# Env opcional: RESTORE_AGE_IDENTITY (arquivo da chave privada age; obrigatorio para .age)
#               RESTORE_ALLOWED_HOSTS (hosts aceitos, separados por virgula; padrao localhost,127.0.0.1)
#               RESTORE_SOURCE_URL  (se definido, compara as contagens com a origem via comparar-contagens.sh)
#               RESTORE_KEEP=1      (nao apaga o banco restaurado; imprime o nome em "banco=")
# Saida: so status, nomes de tabela, contagens e duracao. Nunca dado, segredo ou URL.
set -euo pipefail
umask 077

log() { printf '%s restore-test: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "status=falha $*"; exit 1; }

DUMP="${1:-}"
[[ -n "$DUMP" && -f "$DUMP" ]] || die "dump_ausente"
[[ -n "${RESTORE_ADMIN_URL:-}" ]] || die "config_ausente=RESTORE_ADMIN_URL"

# Guarda: recusa host fora da lista antes de qualquer conexao (evita CREATE/DROP DATABASE em Postgres real).
hp="${RESTORE_ADMIN_URL#*://}"; hp="${hp%%[/?]*}"; hp="${hp##*@}"; host="${hp%%:*}"
allowed=0
IFS=',' read -r -a hosts <<< "${RESTORE_ALLOWED_HOSTS:-localhost,127.0.0.1}"
for h in "${hosts[@]}"; do [[ "$h" == "$host" ]] && allowed=1; done
[[ "$allowed" -eq 1 ]] || die "host_nao_permitido (ajuste RESTORE_ALLOWED_HOSTS somente para Postgres descartavel)"
# host/hostaddr/service na query sobrescrevem o host do authority no libpq: recusa.
if [[ "$RESTORE_ADMIN_URL" == *\?* ]]; then
  q="${RESTORE_ADMIN_URL#*\?}"
  shopt -s nocasematch
  [[ "$q" =~ (^|[\&\;])(host|hostaddr|service)= || "$q" == *%* ]] && die "parametro_conexao_nao_permitido"
  shopt -u nocasematch
fi

if [[ "$DUMP" == *.age ]]; then
  [[ -n "${RESTORE_AGE_IDENTITY:-}" && -f "$RESTORE_AGE_IDENTITY" ]] || die "config_ausente=RESTORE_AGE_IDENTITY"
  command -v age >/dev/null || die "ferramenta_ausente=age"
fi
command -v pg_restore >/dev/null && command -v psql >/dev/null || die "ferramenta_ausente=pg_restore/psql"

DB="restore_test_$$_$(date +%s)"
base="${RESTORE_ADMIN_URL%%\?*}"; qs=""
[[ "$base" == "$RESTORE_ADMIN_URL" ]] || qs="?${RESTORE_ADMIN_URL#*\?}"
TARGET="${base%/*}/$DB$qs"
# remove o CR final: o psql.exe do Windows termina as linhas com CRLF
admin() { psql -X -q -v ON_ERROR_STOP=1 -tA -d "$RESTORE_ADMIN_URL" "$@" 2>/dev/null | tr -d '\r'; }
qry() { psql -X -q -v ON_ERROR_STOP=1 -tA -d "$TARGET" "$@" 2>/dev/null | tr -d '\r'; }
cleanup() {
  if [[ "${RESTORE_KEEP:-0}" != "1" ]]; then
    admin -c "DROP DATABASE IF EXISTS \"$DB\" WITH (FORCE)" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

START=$(date +%s)
log "etapa=inicio bytes=$(wc -c < "$DUMP" | tr -d ' ')"
admin -c "CREATE DATABASE \"$DB\"" >/dev/null || die "criar_banco_descartavel"
# roles citadas nos GRANTs do dump (pg_dump de um banco so nao leva roles). As tres do Neon aparecem
# em ALTER DEFAULT PRIVILEGES de um dump do Neon real; sem elas o pg_restore sai com erro (T165).
for r in evolucao_owner evolucao_app evolucao_backup_ro neondb_owner neon_superuser cloud_admin; do
  admin -c "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='$r') THEN CREATE ROLE \"$r\" NOLOGIN; END IF; END \$\$" >/dev/null || die "criar_role"
done

# decifra em pipe: o dump em claro nao toca o disco. stderr descartado (poderia ecoar dado).
if [[ "$DUMP" == *.age ]]; then
  age -d -i "$RESTORE_AGE_IDENTITY" "$DUMP" 2>/dev/null | pg_restore --no-owner --dbname="$TARGET" >/dev/null 2>&1 \
    || die "etapa=restore"
else
  pg_restore --no-owner --dbname="$TARGET" "$DUMP" >/dev/null 2>&1 || die "etapa=restore"
fi
NT=$(qry -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'") || NT=0
[[ "${NT:-0}" -gt 0 ]] || die "etapa=restore sem_tabelas"
log "etapa=restore status=ok tabelas=${NT}"

echo "-- contagens (public) --"
for t in $(qry -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1"); do
  n=$(qry -c "SELECT count(*) FROM public.\"$t\"") || die "contagem_falhou tabela=$t"
  echo "tabela=$t linhas=$n"
done
[[ "${RESTORE_KEEP:-0}" != "1" ]] || echo "banco=$DB"

if [[ -n "${RESTORE_SOURCE_URL:-}" ]]; then
  HERE=$(cd "$(dirname "$0")" && pwd)
  "$HERE/comparar-contagens.sh" "$RESTORE_SOURCE_URL" "$TARGET" || die "etapa=comparacao"
fi
log "status=ok duracao=$(( $(date +%s) - START ))s"
