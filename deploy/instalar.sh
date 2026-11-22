#!/usr/bin/env bash
# Instala (o actualiza) «Tareas de casa» en este portátil con Bazzite / Fedora Atomic.
# Convive con el menú y con gastos SIN TOCARLOS: otro puerto (8789), otro contenedor y HTTPS en el 10000.
# Antes y después comprueba que las otras dos apps siguen respondiendo y publicadas en Tailscale.
#
# Uso (como el usuario normal, NO como root):   bash instalar.sh
# Se puede volver a ejecutar sin miedo: no borra datos.
set -euo pipefail

PROPIETARIO="${TAREAS_PROPIETARIO:-isaacff2000-cloud}"
APP=tareas-casa
IMAGEN="ghcr.io/${PROPIETARIO}/${APP}:latest"
DATOS="$HOME/.local/share/${APP}"
QUADLET_DIR="$HOME/.config/containers/systemd"
PUERTO=8789
HTTPS=10000
# Las otras apps: solo se comprueba que siguen igual (nombre, puerto local, puerto HTTPS)
OTRAS=("menu-casa 8787 443" "gastos-casa 8788 8443")

azul() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
aviso() { printf '  \033[33m!\033[0m %s\n' "$*"; }
mal() { printf '  \033[31m✗\033[0m %s\n' "$*"; }
fallo() { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] && fallo "Ejecútalo con tu usuario, no como root (el servicio es de usuario). Desde root:
  sudo -u <usuario> XDG_RUNTIME_DIR=/run/user/<uid> DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/<uid>/bus bash $0"

salud() { curl -fs --max-time 5 "http://127.0.0.1:$1/api/salud" >/dev/null 2>&1; }
serve_estado() { tailscale serve status 2>/dev/null || true; }
# A qué apunta un puerto HTTPS de Tailscale Serve ("" si a nada)
destino() {
  serve_estado | awk -v p="$1" '
    /^https?:\/\// {
      u = $1; sub(/\/$/, "", u); puerto = (u ~ /^https/) ? 443 : 80
      if (match(u, /:[0-9]+$/)) puerto = substr(u, RSTART + 1)
      dentro = (puerto == p); next
    }
    /^$/ { dentro = 0 }
    dentro && match($0, /http:\/\/127\.0\.0\.1:[0-9]+/) { print substr($0, RSTART, RLENGTH); exit }'
}

# Estado de las otras apps: "nombre local https responde destino"
declare -A ANTES_SALUD ANTES_SERVE
foto_otras() {
  local nombre local_ https
  for o in "${OTRAS[@]}"; do
    read -r nombre local_ https <<<"$o"
    if salud "$local_"; then ANTES_SALUD[$nombre]=1; else ANTES_SALUD[$nombre]=0; fi
    ANTES_SERVE[$nombre]="$(destino "$https")"
  done
}
comprobar_otras() {  # $1 = antes | despues
  local nombre local_ https bien=1
  for o in "${OTRAS[@]}"; do
    read -r nombre local_ https <<<"$o"
    if salud "$local_"; then ok "$nombre responde en el puerto $local_"
    elif [[ $1 == antes ]]; then aviso "$nombre no responde ahora mismo (no se toca igualmente)"
    elif [[ ${ANTES_SALUD[$nombre]} == 1 ]]; then mal "¡$nombre ya no responde! Mira: systemctl --user status $nombre"; bien=0
    else aviso "$nombre tampoco respondía antes"; fi
    local d; d="$(destino "$https")"
    if [[ "$d" == "http://127.0.0.1:$local_" ]]; then ok "Tailscale sigue publicando $nombre en el $https"
    elif [[ $1 == antes ]]; then aviso "Tailscale no publica $nombre en el $https (no se toca)"
    elif [[ "${ANTES_SERVE[$nombre]}" == "http://127.0.0.1:$local_" ]]; then
      mal "¡Tailscale ya no publica $nombre! Para dejarlo como estaba: tailscale serve --bg --https=$https http://127.0.0.1:$local_"; bien=0
    fi
  done
  return $((1 - bien))
}

azul "1/6 Comprobaciones (no se cambia nada todavía)"
command -v podman >/dev/null || fallo "Falta podman (en Bazzite viene instalado)."
command -v curl >/dev/null || fallo "Falta curl."
systemctl --user show-environment >/dev/null 2>&1 || fallo "No hay sesión de systemd de usuario (¿falta XDG_RUNTIME_DIR?)."
ok "podman $(podman --version | awk '{print $3}')"
TS=0
if command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; then TS=1; ok "Tailscale conectado"; else aviso "Tailscale no está activo: la app funcionará solo en este portátil hasta activarlo."; fi
foto_otras
comprobar_otras antes || true
if ss -ltnH "sport = :${PUERTO}" 2>/dev/null | grep -q . && ! podman container exists "$APP" 2>/dev/null; then
  fallo "El puerto ${PUERTO} ya lo usa otro programa. No sigo para no pisar nada."
fi
YA="$(destino "$HTTPS")"
if [[ -n "$YA" && "$YA" != "http://127.0.0.1:${PUERTO}" ]]; then
  fallo "El puerto ${HTTPS} de Tailscale ya publica otra cosa (${YA}). No sigo para no pisar nada."
fi
ok "Puertos libres: ${PUERTO} en el portátil y ${HTTPS} en Tailscale"

azul "2/6 Descargando la app"
mkdir -p "$QUADLET_DIR"
mkdir -p -m 700 "$DATOS"
chmod 700 "$DATOS"
podman pull "$IMAGEN" >/dev/null || fallo "No se pudo descargar $IMAGEN (¿el paquete de ghcr.io es público?)"
ok "Imagen al día"
if [[ -f "$DATOS/tareas.db" ]]; then ok "Ya hay datos en $DATOS (no se tocan)"; else ok "Empieza vacía: cada uno elegirá «Soy …» en su móvil"; fi

azul "3/6 Servicio (solo el de tareas)"
curl -fsSL "https://raw.githubusercontent.com/${PROPIETARIO}/${APP}/main/deploy/${APP}.container" \
  | sed "s/IMAGEN_PROPIETARIO/${PROPIETARIO}/" > "$QUADLET_DIR/${APP}.container.nuevo" \
  || fallo "No se pudo descargar la definición del servicio"
mv "$QUADLET_DIR/${APP}.container.nuevo" "$QUADLET_DIR/${APP}.container"
systemctl --user daemon-reload                 # relee las definiciones; no reinicia nada
systemctl --user restart "${APP}.service"      # solo este servicio
systemctl --user enable --now podman-auto-update.timer >/dev/null 2>&1 || aviso "No se pudo activar la actualización automática"
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" == "yes" ]]; then ok "Arranca solo al encender"; else aviso "Falta: sudo loginctl enable-linger $USER  (para que arranque sin iniciar sesión)"; fi
for _ in $(seq 1 30); do salud "$PUERTO" && break; sleep 2; done
salud "$PUERTO" || fallo "El servicio no responde. Mira: journalctl --user -u ${APP} -n 50"
ok "En marcha en http://127.0.0.1:${PUERTO} ($(curl -fs "http://127.0.0.1:${PUERTO}/api/salud" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'))"

azul "4/6 Acceso desde los móviles (Tailscale, solo vuestra red)"
NOMBRE=""
if [[ $TS == 1 ]]; then
  if [[ "$(destino "$HTTPS")" == "http://127.0.0.1:${PUERTO}" ]]; then
    ok "Ya publicada en el puerto ${HTTPS}"
  else
    tailscale serve --bg --https=${HTTPS} "http://127.0.0.1:${PUERTO}" >/dev/null \
      || fallo "tailscale serve falló. ¿Está «tailscale set --operator=$USER»? Prueba: tailscale serve --bg --https=${HTTPS} http://127.0.0.1:${PUERTO}"
    ok "Publicada en el puerto ${HTTPS}"
  fi
  NOMBRE="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)"
  if [[ -n "$NOMBRE" ]]; then
    for _ in $(seq 1 10); do curl -fs --max-time 10 "https://${NOMBRE}:${HTTPS}/api/salud" >/dev/null 2>&1 && break; sleep 3; done
    if curl -fs --max-time 10 "https://${NOMBRE}:${HTTPS}/api/salud" >/dev/null 2>&1; then ok "Responde por HTTPS a través de Tailscale"
    else aviso "Aún no responde por https://${NOMBRE}:${HTTPS} (el certificado puede tardar un minuto la primera vez)"; fi
  fi
else
  aviso "Activa Tailscale y vuelve a ejecutar este script para publicarla."
fi

azul "5/6 El menú y gastos siguen igual"
INTACTAS=1
comprobar_otras despues || INTACTAS=0

azul "6/6 Resumen"
[[ -n "$NOMBRE" ]] && echo "  Dirección para los móviles:  https://${NOMBRE}:${HTTPS}"
echo "  Ver el estado:     systemctl --user status ${APP}"
echo "  Ver los mensajes:  journalctl --user -u ${APP} -f"
echo "  Datos y copias:    $DATOS"
if [[ $INTACTAS == 1 ]]; then ok "Listo. Menú y gastos intactos."; else mal "Tareas instalada, pero algo de las otras apps cambió: mira los ✗ de arriba."; exit 2; fi
