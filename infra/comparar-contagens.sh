#!/usr/bin/env bash
# comparar-contagens.sh (T191, OPS-02): compara a contagem de linhas por tabela (schema public) entre a
# origem e o banco restaurado. Sai com codigo 1 em qualquer divergencia (valor diferente, tabela ausente
# em um dos lados ou nenhuma tabela). Imprime so nomes de tabela e contagens, nunca a URL.
# Uso: infra/comparar-contagens.sh <url_origem> <url_restaurado>
set -euo pipefail
ORIGEM="${1:-}"; RESTAURADO="${2:-}"
[[ -n "$ORIGEM" && -n "$RESTAURADO" ]] || { echo "uso: comparar-contagens.sh <url_origem> <url_restaurado>"; exit 2; }

contagens() {
  local url="$1" t
  for t in $(psql -X -q -v ON_ERROR_STOP=1 -tA -d "$url" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1" 2>/dev/null | tr -d '\r'); do
    echo "$t $(psql -X -q -v ON_ERROR_STOP=1 -tA -d "$url" -c "SELECT count(*) FROM public.\"$t\"" 2>/dev/null | tr -d '\r')"
  done
}
A=$(contagens "$ORIGEM") || { echo "falha: nao leu a origem"; exit 1; }
B=$(contagens "$RESTAURADO") || { echo "falha: nao leu o restaurado"; exit 1; }
[[ -n "$A" ]] || { echo "falha: origem sem tabelas"; exit 1; }

falhas=0
while read -r t n; do
  m=$(awk -v t="$t" '$1==t{print $2}' <<< "$B")
  if [[ -z "$m" ]]; then echo "DIVERGE tabela=$t origem=$n restaurado=ausente"; falhas=$((falhas+1))
  elif [[ "$m" != "$n" ]]; then echo "DIVERGE tabela=$t origem=$n restaurado=$m"; falhas=$((falhas+1))
  else echo "OK tabela=$t linhas=$n"; fi
done <<< "$A"
while read -r t _; do
  [[ -z "$t" ]] || awk -v t="$t" '$1==t{f=1}END{exit !f}' <<< "$A" || { echo "DIVERGE tabela=$t origem=ausente"; falhas=$((falhas+1)); }
done <<< "$B"
if [[ "$falhas" -ne 0 ]]; then echo "resultado=falha divergencias=$falhas"; exit 1; fi
echo "resultado=ok"
