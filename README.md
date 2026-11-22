# Tareas de casa · servidor de casa

Calendario semanal de las tareas de casa para dos personas, con puntos que desbloquean pedir a
domicilio y salir. Corre en un portátil que está siempre encendido; los móviles usan una app web
instalable a través de Tailscale: nada queda publicado en internet.

Este repositorio solo tiene código: ningún dato, correo ni clave. Los datos viven en
`~/.local/share/tareas-casa` del portátil.

## Qué hace

- **Hoy:** lo que toca hoy, lo atrasado de la semana y lo de mañana, con casillas grandes.
- **Semana:** los siete días (lunes a domingo) para planificar; cada tarea con su día, su hora si la
  tiene, a quién le toca (una persona, cualquiera o los dos) y sus puntos.
- **Tareas:** resumen de todo lo programado, agrupado por frecuencia (cada semana, cada N semanas, una vez
  al mes, de un solo día), con sus días, a quién le toca, sus puntos y cuándo toca la próxima vez; desde ahí
  se reasignan o cambian. Incluye los puntos planificados por semana frente a las metas.
- **Tareas que se repiten solas:** ciertos días de cada semana, cada N semanas o una vez al mes
  (un día del mes o «el primer sábado»). Cambiarlas vale desde la semana que elijas; mover, cambiar la
  hora o la persona, o saltar una tarea vale **solo esa vez**.
- **Puntos:** dos metas semanales (pedir a domicilio y salir) que se alcanzan **entre los dos**, con un
  **mínimo para cada uno**. Cada semana empieza de cero. Una tarea hecha cuenta al momento y el otro
  puede devolverla con una nota. La semana se puede corregir hasta el martes siguiente.
- Funciona sin cobertura (los cambios esperan y se envían al volver la red) y lo que hace uno le
  aparece al otro al momento. Lo que se está escribiendo nunca se borra por cambios del otro.
- Copia de seguridad cada noche (30 días) y una cada mes que no se borra.

## Cómo funciona

- Node 22 sin dependencias: `node:sqlite`, `http` y avisos en directo (SSE).
- Los cambios llegan como **operaciones con id propio** (si llegan dos veces, se aplican una) y se
  guardan en orden. El estado se obtiene aplicándolas con las reglas de `src/nucleo.js`, el mismo
  archivo que usa el móvil. Las tareas repetidas guardan su regla, no cada día.
- App web con Preact y htm copiados en `web/vendor` (sin compilación).
- Quién es quién lo dice Tailscale (cabecera `Tailscale-User-Login`): cada persona elige una vez
  «Soy …» y queda unida a su cuenta. Sin esa cabecera no se ve ningún dato.

## Instalar en el portátil (Bazzite / Fedora Atomic)

Convive con otras apps del portátil sin tocarlas: usa el puerto local 8789 y el HTTPS 10000 de Tailscale.

1. Tailscale activo, con `tailscale set --operator=$USER` y HTTPS activado en la consola de Tailscale.
2. Como tu usuario (no root):
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/isaacff2000-cloud/tareas-casa/main/deploy/instalar.sh
   bash instalar.sh
   ```
   El instalador comprueba antes y después que las otras apps del portátil siguen respondiendo y
   publicadas, y se detiene si el 8789 o el 10000 ya están en uso.
3. En cada móvil (con Tailscale activo): abrir `https://<portátil>.<tu-red>.ts.net:10000`, añadir a la
   pantalla de inicio y elegir «Soy …».

El servicio de Podman arranca solo, se reinicia si falla y se actualiza solo con cada versión nueva.

## Mantenimiento

```bash
systemctl --user status tareas-casa                      # estado
journalctl --user -u tareas-casa -f                      # mensajes
podman exec tareas-casa node src/cli.js resumen          # qué hay guardado y cómo va la semana
podman exec tareas-casa node src/cli.js desligar b && systemctl --user restart tareas-casa   # que una persona vuelva a elegir
# Restaurar una copia (con el servicio parado):
systemctl --user stop tareas-casa
podman run --rm --userns=keep-id:uid=1000,gid=1000 -v ~/.local/share/tareas-casa:/datos:Z \
  ghcr.io/isaacff2000-cloud/tareas-casa node src/cli.js restaurar /datos/copias/mensual/tareas-AAAA-MM.db
systemctl --user start tareas-casa
```

## Desarrollo

```bash
npm test                                               # pruebas (Node 22.13 o superior, sin dependencias)
TAREAS_PRUEBAS=1 node src/cli.js servir                # http://127.0.0.1:8789 (acepta la cabecera x-quien)
TAREAS_PRUEBAS=1 TAREAS_HOY=2026-11-25 node src/cli.js servir   # además, con el día fijado
bash deploy/comprobar_limpio.sh                        # que no se cuele nada privado
python3 test/e2e_app.py                                # la app en dos móviles a la vez (Playwright)
```

El diseño completo está en [docs/DISENO.md](docs/DISENO.md).
