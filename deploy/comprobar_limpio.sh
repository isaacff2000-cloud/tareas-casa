#!/usr/bin/env bash
# Falla si el repositorio lleva algo que no debe ser público: claves, correos, datos o nombres de vuestra red.
set -euo pipefail
cd "$(dirname "$0")/.."
patrones=(
  'PRIVATE KEY' 'private_key' 'client_secret' 'refresh_token' 'access_token"'
  '@gmail\.com' '@hotmail\.' '@outlook\.' '@icloud\.com'
  'docs\.google\.com/spreadsheets/d/[A-Za-z0-9_-]{20}' '\b1[A-Za-z0-9_-]{43}\b'
  'ghp_[A-Za-z0-9]{20}' 'github_pat_' 'tskey-' '"d" *: *"[A-Za-z0-9_-]{40,}"'
  '[a-z0-9-]+\.tail[0-9a-f]{4,}\.ts\.net'
  '\b(192\.168|10\.[0-9]+)\.[0-9]+\.[0-9]+\b' '\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+\b'
)
fallo=0
for p in "${patrones[@]}"; do
  if git ls-files -z | grep -zv '^deploy/comprobar_limpio.sh$' | xargs -0 grep -nIE "$p" 2>/dev/null; then
    echo "→ Encontrado algo que parece privado: $p"; fallo=1
  fi
done
if git ls-files | grep -E '\.(db|db-wal|db-shm|keystore|jks|p12|pem|key|csv|xlsx)$|(^|/)(rclone\.conf|vapid[^/]*\.json)$'; then echo '→ Hay archivos de datos o claves en el repositorio'; fallo=1; fi
[[ $fallo == 0 ]] && echo 'Repositorio limpio: sin datos ni claves.'
exit $fallo
