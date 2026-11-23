# Tareas de casa · servidor de casa — documento de diseño

Tercera app de casa, con el mismo sistema que **menu-casa** y **gastos-casa**: un servidor en el
portátil y una app instalable en los móviles, sin depender de Google ni de nadie.
Estado (23-nov-2026): **fase 1 y avisos push (fase 2a) construidos, probados y publicados.** Repositorio público
`isaacff2000-cloud/tareas-casa`. **Instalada en el portátil el 22-nov a las 14:29** en el puerto 10000 de
Tailscale; el instalador comprobó antes y después que menú (443) y gastos (8443) siguen respondiendo y
publicados, sin reiniciarlos. El 23-nov, avisos push (versión 0.3.0): 29 pruebas y la prueba con dos móviles
(52 comprobaciones). Pendiente: activar los avisos en cada móvil (Ana, desde el icono de la pantalla de
inicio) y el resto de la fase 2 (tareas típicas, historial de puntos, CSV).
Modelo principal: `gastos-casa` (versión con carpetas y arrastre). Se copia su arquitectura y su forma de
trabajar, no su contenido.

## 1. Qué hace

- **Calendario semanal (lunes a domingo)** de tareas del hogar. Cada tarea tiene un día y una persona:
  **Isaac, Ana, cualquiera o los dos**. Sin hora por defecto; se le puede poner hora cuando haga falta.
- **Tareas que se repiten solas:** semanales (en uno o varios días), cada N semanas y mensuales (el día N
  o «el primer/último sábado del mes»). Además, tareas sueltas de un solo día.
- **Puntos por tarea.** Los puntos de la semana desbloquean dos premios: **pedir a domicilio** y **salir**.
- Lo que hace uno le aparece al otro al momento; funciona sin cobertura; lo que se escribe no se borra.

## 2. Reglas de los puntos (tus respuestas)

1. **Meta conjunta + mínimo por persona.** Cada premio se desbloquea cuando **los puntos de los dos juntos**
   llegan a su meta **y** cada uno ha llegado al **mínimo personal**.
2. **Dos metas fijas**, editables en Ajustes. Propuesta para empezar (ajústala tras la primera semana):
   **domicilio 20 · salir 30 · mínimo 8 cada uno**. Un cambio de metas vale **desde la semana en curso**;
   las semanas pasadas conservan las metas que tenían (igual que los importes «desde este mes» de gastos).
3. **Cuenta la semana en curso, en directo.** Semáforo arriba: en cuanto llegáis, queda desbloqueado.
   Si después se devuelve una tarea y bajáis de la meta, se vuelve a bloquear (es un cálculo, no un sello).
4. **Cada semana empieza de cero.** No se arrastran sobrantes ni deudas.
5. **Una tarea hecha cuenta al momento.** El otro ve «hecha por Isaac» y puede **devolverla** a pendiente con
   una nota («falta el baño de arriba»): los puntos se quitan hasta que se vuelva a hacer.
6. **Tarea no hecha:** el día siguiente aparece como **atrasada** y suma si se hace antes del domingo.
   Al cerrar la semana queda **«no hecha»**, con 0 puntos y **sin restar**.
7. **Quién se lleva los puntos** (*decisión mía, revisable*): quien la hace, aunque estuviera asignada al
   otro (al marcarla se elige «la hice yo / Ana / los dos»). Una tarea hecha por **los dos** suma sus puntos
   **una vez** al total conjunto y **a cada uno** para su mínimo.
8. **Los puntos se congelan al hacerla:** si luego cambias lo que vale una tarea, lo ya hecho no cambia.
9. **Cierre de la semana** (*decisión mía*): se puede marcar como hecha una tarea solo con fecha (del móvil)
   de su semana —también por adelantado, p. ej. la del jueves el martes—, nunca después del domingo. Para
   que un móvil sin cobertura el domingo por la noche no pierda nada, el servidor acepta esos cambios y las
   devoluciones **hasta el martes siguiente a las 23:59**; después la semana queda cerrada para siempre.
10. **Aviso de semana imposible:** si lo planificado no alcanza una meta («esta semana hay 24 puntos: no
    llega para salir»), se avisa al planificar.

## 3. Decisiones de diseño (revisables)

1. **Registro de operaciones + un único módulo de reglas** (`src/nucleo.js`), compartido por servidor y
   móvil, exactamente como gastos: operaciones con id propio, `validar()` puede rechazar, `aplicar()` nunca
   falla, el historial se rehace siempre igual.
2. **Las repeticiones no se guardan día a día.** Una tarea guarda su **regla** y las apariciones de cada
   semana se **calculan**. Solo se guarda lo que pasa a una aparición concreta (hecha, movida, saltada,
   reasignada, devuelta). Así una tarea semanal no llena la base con miles de filas.
3. **«Desde esta semana» o «solo esta vez»**, el mismo patrón que «desde este mes / solo este mes» de gastos:
   - Cambiar días, persona, hora, puntos o frecuencia de una tarea vale **desde la semana que elijas**
     (por defecto la actual); las semanas anteriores siguen como estaban.
   - Mover una aparición a otro día, cambiarle la hora o la persona, o **saltarla** («esta semana no toca»)
     afecta **solo a esa vez**. Mover solo dentro de su semana, para que los puntos sigan siendo de esa semana.
   - Nombre y emoji cambian en todas las semanas (como el nombre de un concepto en gastos).
4. **Quitar una tarea** la archiva **desde una semana**: las anteriores la siguen mostrando con lo que se hizo.
5. **Puntos enteros de 1 a 20**, con sugerencias rápidas 1 · 2 · 3 · 5 · 8.
6. **Cualquiera de los dos puede editarlo todo**, como en gastos. Borrar o devolver muestra «Deshacer».
7. **Notificaciones push con recordatorios** (pedidas el 22-nov, fase 2): ver el apartado 7 bis.
8. **Empezar rápido:** la primera vez, la pestaña Tareas ofrece una lista de **tareas típicas** (fregar,
   aspirar, baño, cocina, ropa, sábanas, basura, plantas, nevera…) con puntos sugeridos para marcar las que
   hacéis y asignarlas.

## 4. Arquitectura (copia de gastos-casa)

```
tareas-casa/
  src/
    nucleo.js      reglas: fechas y semanas, repeticiones, validar/aplicar operaciones, puntos y desbloqueos
    db.js          SQLite (node:sqlite): tablas meta y op; estado en memoria (igual que gastos)
    servidor.js    http + SSE + estáticos + cabeceras de seguridad (igual que gastos)
    copias.js      copias nocturnas y mensuales (en las otras apps se llama tareas.js; aquí sería confuso)
    cli.js         servir | copia | restaurar | desligar | resumen | csv
  web/             PWA: Preact + htm en vendor/ (copiados de gastos, con sus licencias), sin compilar
    index.html, app.js, app.css, almacen.js (estado, cola, SSE), sw.js, manifest, iconos/
  deploy/          Containerfile, tareas-casa.container, instalar.sh, comprobar_limpio.sh
  test/            node:test + e2e_app.py (Playwright, dos móviles)
  .github/workflows/ci.yml
```

Node 22.13+, **sin dependencias**. Sin importador: no hay hoja antigua de tareas. Datos fuera del repo, en
`~/.local/share/tareas-casa`. Variables: `TAREAS_DATOS`, `PUERTO=8789`, `TAREAS_PRUEBAS=1` (solo pruebas) y,
solo junto a esta, `TAREAS_HOY=AAAA-MM-DD` para fijar el día en la prueba con dos móviles.

### Fechas
Días `AAAA-MM-DD`; una semana se nombra por la fecha de su **lunes**. La zona es `Europe/Madrid` (el
contenedor lleva `TZ`). Hora opcional `HH:MM`. Días de la semana 1 = lunes … 7 = domingo.

### Estado (lo que recibe el móvil)
```
personas { a:{nombre, ligada}, b:{nombre, ligada} }       yo: 'a' | 'b' | null (los logins no salen del servidor)
metas    { '<lunes>': { domicilio, salir, minimo } }       vale desde esa semana hasta la siguiente entrada
tareas   { id: { id, nombre, emoji, creada:'<lunes>', hasta:'<lunes>'|null,
                 versiones: [{ desde:'<lunes>', puntos, quien, hora|null, rep }] } }
   quien: 'a' | 'b' | 'cualquiera' | 'ambos'
   rep:   { tipo:'una', fecha }
        | { tipo:'semanal', dias:[1..7], cada:N, ancla:'<lunes>' }       cada 1 = todas las semanas
        | { tipo:'mensual', dia:1..31 | 'ultimo' }                        si el mes no tiene día 31, el último
        | { tipo:'mensual', orden:1..4 | 'ultimo', diaSemana:1..7 }       «primer sábado», «último domingo»
apariciones { '<lunes>': { '<tarea>|<fecha original>': {      agrupadas por semana
                 fecha?, hora?, quien?,              cambios de solo esta vez (fecha dentro de su semana)
                 saltada?: true,
                 hecha?:   { por:['a'] | ['b'] | ['a','b'], puntos, dia, marco:'a'|'b', ts },
                 devuelta?: { por, nota, ts } } } }   la última devolución, para mostrarla
```

### Cálculo de una semana (`semana(e, lunes, hoy)`)
Para cada tarea activa, la versión vigente esa semana genera sus apariciones; se les aplican los cambios
guardados. Cada aparición sale con su estado: **pendiente · atrasada · hecha · no hecha · saltada**.
Resultado: lista por día (ordenada por hora; las sin hora al final del día), puntos **hechos** (total, de
Isaac, de Ana), puntos **planificados**, metas vigentes y, por premio: `desbloqueado`, puntos que faltan y
a quién le falta el mínimo. La misma función sirve para el historial de semanas pasadas.

### Operaciones (todas con `id` único; el servidor pone `por` y `ts`)
`persona.reclamar` · `persona.renombrar` · `persona.nombrar` · `persona.desligar` (las dos últimas solo
desde el portátil) · `tarea.crear` · `tarea.renombrar` · `tarea.cambiar` (nueva versión desde una semana) ·
`tarea.archivar` · `tarea.recuperar` · `aparicion.hecha` · `aparicion.deshacer` (quien la marcó) ·
`aparicion.devolver` (el otro, con nota) · `aparicion.cambiar` (día, hora o persona solo esta vez) ·
`aparicion.saltar` · `aparicion.restaurar` · `metas.desde`.
Un id repetido se confirma sin aplicarse otra vez; una operación inválida se rechaza con mensaje claro.

El móvil recibe las apariciones de las **últimas 12 semanas** (el historial completo se queda en el portátil),
para que su copia no crezca sin fin con los años.

### API (igual que gastos)
`GET /api/salud` · `GET /api/estado` (ETag) · `POST /api/ops` · `GET /api/eventos` (SSE) ·
`GET /api/copia` · `GET /api/csv`.

### Sin cobertura y escritura
Como gastos: estado y cola en el móvil, cambios aplicados al instante con `nucleo.js` y enviados al volver la
red. **Ningún campo en edición se pisa** con lo que llega del otro (nombre de tarea, nota de devolución,
puntos). Marcar una casilla es una operación pequeña: si los dos marcan la misma tarea a la vez, gana la
primera que llega y la otra se confirma sin efecto (el resultado es el mismo).

## 5. Pantallas

Cuatro pestañas abajo, color propio (**violeta**, para no confundirla con el verde del menú y de gastos), y
cada persona con su color (azul y naranja de la paleta validada de gastos, aptos para daltonismo, con
inicial además del color).

- **Hoy** (la de cada día). Semáforo compacto: dos barras, 🛵 domicilio y 🍻 salir, con «os faltan 6 ·
  Ana: mínimo hecho, Isaac: faltan 2». Debajo, **atrasadas**, las de **hoy** (por hora) y un vistazo a las de
  **mañana**. Casillas grandes; al marcar, si la tarea era de «cualquiera» o de los dos, pregunta quién la ha
  hecho (por defecto tú). Filtro: todas · mías.
- **Semana** (planificar). Navegación ‹ 23–29 nov ›, el semáforo y los 7 días en columna (en el móvil caben
  mejor así que en rejilla), cada tarea con emoji, hora, persona y puntos; hoy resaltado. Total de puntos
  planificados frente a las metas. Al tocar una tarea, una hoja con: hecha · cambiar día/hora/persona solo
  esta vez · saltar esta semana · devolver (si la hizo el otro) · editar la tarea. Botón ＋ para una tarea
  nueva en el día elegido.
- **Tareas** (el resumen, hecho en la fase 1.1). Las tareas agrupadas (semanales con su rejilla L–D · cada N
  semanas · mensuales · sueltas pendientes), con sus días, persona, puntos y la próxima vez que tocan. Editar
  «desde esta semana», reasignar y recuperar las quitadas. En la fase 2, la lista de tareas típicas para empezar.
- **Puntos**. La semana en curso con detalle (por persona y por tarea) y el **historial** de las últimas
  semanas: puntos, ✓/✗ de domicilio y salir, y el reparto Isaac/Ana. Las semanas cerradas, con sus metas de
  entonces.
- **Ajustes** (botón con tu nombre): nombre, **metas** (domicilio, salir, mínimo; desde esta semana),
  descargar copia, copiar CSV, estado de la sincronización y versión.
- **Alta**: «Soy Isaac / Soy Ana» la primera vez; una tercera cuenta ve «Ya sois dos»; sin identidad, nada.

## 6. Seguridad (igual que gastos)

- **Nada en internet:** `tailscale serve` (no Funnel). El servidor escucha en `127.0.0.1:8789` del portátil.
- **Identidad:** cabecera `Tailscale-User-Login`; cada uno elige «Soy …» una vez y queda ligado a su cuenta.
  **Sin identidad no se ve ningún dato.** La cabecera `x-quien` solo existe con `TAREAS_PRUEBAS=1`.
- **Contra webs maliciosas:** `POST` solo con `Content-Type: application/json` y `Sec-Fetch-Site`
  `same-origin`/`none` (rechaza también `same-site`, que es lo que enviarían el menú o gastos desde otro
  puerto del mismo portátil); CSP estricta (solo recursos propios), `nosniff`, `no-referrer`,
  `frame-ancestors 'none'`. Nada de `innerHTML`.
- **Límites:** cuerpo 256 KB, ≤500 operaciones por envío, textos acotados (nombre ≤40, nota ≤120), puntos
  1–20, ≤14 apariciones por tarea y semana, fechas validadas.
- **Contenedor:** solo lectura, sin capacidades, `NoNewPrivileges`, usuario 1000, solo su volumen de datos.
- **Repositorio público sin datos:** `deploy/comprobar_limpio.sh` en CI (mismos patrones que gastos).
- **Riesgo residual de AutoUpdate:** el mismo que ya aceptaste para menú y gastos (cuenta de GitHub con
  verificación en dos pasos).

## 7. Copias de seguridad

Como gastos: **cada noche** a las 03:30 (o al arrancar si estaba apagado), copia consistente con
`VACUUM INTO`, se guardan 30; **el día 1 de cada mes** una mensual que no se borra; botón **«Descargar copia»**
en Ajustes; restaurar con `node src/cli.js restaurar copia.db` con el servicio parado. Sin copia a Drive salvo
que la pidas (se podría reutilizar el `copia_drive.sh` de gastos).

## 7 bis. Notificaciones push (fase 2)

**Cómo funcionan sin depender de nadie más de lo imprescindible.** Se usa el estándar Web Push que ya traen
los navegadores. El portátil genera **sus propias claves** (VAPID) la primera vez y las guarda en su carpeta
de datos, nunca en el repositorio; no hace falta cuenta ni registro en Apple ni en Google. Lo que sí es
inevitable: el aviso viaja **cifrado de extremo a extremo** a través del servicio de avisos del móvil
(Apple para el iPhone de Ana, Google para Chrome en Android). Ellos no pueden leer el texto, pero sí ven que
llega un aviso, cuándo y su tamaño. Si ese servicio fallara, solo dejarían de llegar los avisos; la app
sigue funcionando igual. El portátil solo necesita **salir** a internet (ya lo hace para descargar las
imágenes); no se abre nada hacia dentro. Se implementa con `node:crypto`, **sin dependencias**.

**Avisos (todos los que veo útiles; cada uno apaga los suyos en Ajustes):**

| Aviso | Cuándo | A quién |
|---|---|---|
| **Lo que te queda hoy** | 20:00, si tienes tareas de hoy o atrasadas sin hacer: «Te quedan 2: fregar, basura» | A quien le toca |
| **Tarea con hora** | 30 min después de su hora si sigue sin hacer (una vez por tarea) | A quien le toca |
| **Faltan puntos** | Viernes 18:00 y domingo 12:00, si algún premio está bloqueado: «Os faltan 6 para salir; a Isaac, 2 para su mínimo» | A los dos |
| **Te han devuelto una tarea** | Al momento, con la nota | A quien la hizo |
| **Mañana toca** *(apagado por defecto)* | 21:30, resumen de tus tareas de mañana | A quien le toca |

Reglas comunes:
- Las tareas de «cualquiera» o «los dos» avisan a ambos; en cuanto uno la marca, deja de contar para el otro.
- **Silencio de 23:00 a 08:00**: lo que tocaría de noche (p. ej. una devolución) llega a las 08:00.
- **Nunca se repite** un aviso (queda apuntado en la base, también tras un reinicio) y si el portátil
  estaba apagado a la hora, **no se manda tarde** un recordatorio ya pasado (más de 30 min).
- Al tocar el aviso se abre la app en **Hoy**. En el icono aparece el número de tareas que te quedan hoy
  (iPhone y Android lo permiten en apps instaladas).
- Horas editables en Ajustes; hay botón **«Probar aviso»**.

**Activarlo en cada móvil:** en Ajustes, botón **«Activar avisos»** (el móvil pide permiso). En el iPhone de
Ana **solo funciona abriendo la app desde el icono de la pantalla de inicio**, no desde Safari, y hace falta
iOS 16.4 o posterior. Si se quita el icono de la pantalla de inicio, se pierden los avisos y hay que volver a
activarlos. Cada móvil es una suscripción; si uno cambia de móvil, la vieja se borra sola cuando el servicio
de avisos la da por caducada.

**Datos:** las suscripciones son de cada aparato, no del historial compartido: van en una tabla aparte
(`suscripcion`: persona, dirección del servicio, claves, fallos) y **nunca se envían a los móviles** en
`/api/estado`. Las preferencias de avisos de cada persona sí son operaciones normales (`avisos.preferencias`).
API nueva: `POST /api/avisos/suscribir` · `POST /api/avisos/quitar` · `POST /api/avisos/probar`, con las
mismas protecciones que `/api/ops`. Clave privada VAPID en `~/.local/share/tareas-casa/vapid.json` (`0600`);
`comprobar_limpio.sh` busca además claves privadas en formato JWK.

## 8. Convivencia en el portátil

| | Menú | Gastos | **Tareas (nueva)** |
|---|---|---|---|
| Puerto local | 8787 | 8788 | **8789** |
| HTTPS de Tailscale | 443 | 8443 | **10000** → `https://bazzite.<tu-red>.ts.net:10000` |
| Contenedor / quadlet | `menu-casa` | `gastos-casa` | **`tareas-casa`** / `tareas-casa.container` |
| Datos | `~/.local/share/menu-casa` | `~/.local/share/gastos-casa` | **`~/.local/share/tareas-casa`** |
| Imagen | `ghcr.io/…/menu-casa` | `ghcr.io/…/gastos-casa` | **`ghcr.io/…/tareas-casa`** |

**Puerto 10000, comprobado:** la limitación a 443, 8443 y 10000 es solo de Funnel; Serve (solo vuestra red)
acepta cualquier puerto, así que 10000 vale. Comando: `tailscale serve --bg --https=10000 http://127.0.0.1:8789`
(sin `sudo`, por `--operator=isaac`).

**Reglas del instalador** (como el de gastos, ampliado a las dos apps):
- Antes de nada guarda `tailscale serve status` y comprueba que **menú** (8787, `/api/salud`) y **gastos**
  (8788, `/api/salud`) responden y que Serve publica 443 → 8787 y 8443 → 8788.
- **Se detiene** si el 8789 lo usa otro programa o si el 10000 de Serve ya apunta a otra cosa.
- **No reinicia ni modifica** `menu-casa` ni `gastos-casa`; solo `systemctl --user restart tareas-casa`;
  nunca `tailscale serve reset`; no toca la suspensión ni el linger (solo avisa si faltan).
- Al final repite las comprobaciones y muestra ✓/✗ de cada una; si algo de las otras dos cambió, lo dice con
  el comando exacto para volver a dejarlo.
- Se ejecuta como `isaac` (desde el Claude Code del portátil, con el `sudo -u isaac XDG_RUNTIME_DIR=…
  DBUS_SESSION_BUS_ADDRESS=…` de siempre). Cada puerto es un origen distinto: la app no comparte
  almacenamiento con las otras y en el móvil será **un tercer icono**.

## 9. Fases (cada una se puede usar al terminarla)

**Fase 1 — «La semana en marcha» (hecha el 22-nov).** Núcleo con pruebas; tareas sueltas, **semanales**
(días y cada N semanas) y **mensuales** (adelantadas de la fase 2: salían casi gratis); crear, editar «desde
esta semana» y quitar; hecha / deshacer / devolver; atrasadas y no hechas; cambiar solo esta vez y saltar;
puntos, metas y semáforo; servidor, identidad, sin cobertura; pestañas **Hoy** y **Semana**, Alta y Ajustes
(nombre, metas, descargar copia); copias nocturnas y mensuales; contenedor, CI con dos móviles, quadlet e
instalador (probado aquí con un portátil simulado: instalación, segunda pasada, puerto 10000 ocupado y una
app vecina que deja de publicarse). *Se puede usar* para toda la rutina semanal. **Aquí se instala.**

**Fase 1.1 — «Resumen de tareas» (22-nov, a petición tras cargar las tareas iniciales).** Pestaña **Tareas**
adelantada de la fase 2: todo lo programado agrupado por frecuencia (cada semana con su rejilla L–D, cada N
semanas, una vez al mes, sueltas pendientes), a quién le toca, puntos por vez y por semana, **próxima vez** que
toca, media de puntos planificados frente a las metas, filtro Todas/Mías/del otro, editar o reasignar desde
ahí y recuperar las quitadas. Las 22 tareas iniciales se cargaron como datos locales (no están en el repositorio).

**Fase 2a — «Avisos push» (hecha el 23-nov, versión 0.3.0, adelantada del resto de la fase 2).** Lo del
apartado 7 bis tal cual: los cinco avisos con sus horas, silencio de 23:00 a 08:00, sin repetir y sin mandar
tarde, preferencias por persona (operación `avisos.preferencias`, horas de 08:00 a 22:30 cada media hora y
retraso de 0, 15, 30 o 60 min), «Activar avisos» y «Probar aviso» en Ajustes, número en el icono y al tocar
el aviso se abre **Hoy**. Web Push con `node:crypto` y sin dependencias (`src/webpush.js`), comprobado con el
ejemplo oficial del RFC 8291; el «sujeto» VAPID es la dirección del repositorio (Apple exige https o mailto).
Las horas de «faltan puntos» (viernes 18:00 y domingo 12:00) son fijas. Pruebas: 13 nuevas en
`test/avisos.test.js` (servicio de avisos falso que descifra cada envío y una semana entera minuto a minuto) y
la prueba con dos móviles comprueba las preferencias y que el service worker muestra un aviso entregado.

**Fase 2 — «Historial y avisos» (lo que queda).** Lista de **tareas típicas** para empezar en la pestaña Tareas; pestaña **Puntos** (historial); aviso de semana que no
llega a la meta; **notificaciones push** (apartado 7 bis); «Deshacer» en todo; CSV y descarga de copia.
**Llega sola al portátil** por AutoUpdate: no hay que volver a PuTTY. Lo único que tendréis que hacer es
pulsar «Activar avisos» en cada móvil.

**Fase 3 — «El desbloqueo en gastos» (más adelante, tu respuesta).** Queda diseñado, sin fecha:
tareas-casa escribe en su carpeta de datos un archivo pequeño (`publico/semana.json`: semana, puntos, metas
y desbloqueos, sin nombres de tareas) y gastos lo lee montando esa carpeta **en solo lectura**; al apuntar un
gasto de Salidas o Restaurantes, gastos muestra «esta semana: desbloqueado / os faltan 6 puntos» sin
impedir apuntarlo. Exige una versión nueva de gastos y una línea `Volume=` en `gastos-casa.container`, así que
**sí toca gastos** y se hará solo cuando lo pidas.

## 10. Pruebas

- `node:test`: semanas y cambio de hora (marzo/octubre), repeticiones (cada N semanas con su ancla, día 31 en
  meses cortos, «último domingo»), versiones «desde esta semana», solo esta vez, puntos congelados, mínimo por
  persona y «los dos», cierre del martes, idempotencia y reproducción determinista del historial, validaciones
  y límites, identidad, CSRF y cabeceras, API y SSE, copias y rotación.
- Avisos: cifrado comparado con el ejemplo oficial del estándar (RFC 8291), firma VAPID verificada, y un
  **servicio de avisos falso** en la prueba que recibe cada envío, lo descifra y comprueba texto, destinatario,
  horas de silencio, que no se repite y que borra suscripciones caducadas (respuesta 404/410). Con el reloj
  fijado se recorre una semana entera de recordatorios.
- `test/e2e_app.py` (Playwright, **dos móviles a la vez**, reloj fijado): alta de los dos, lo que marca uno le
  aparece al otro sin recargar, semáforo que se desbloquea y se vuelve a bloquear al devolver, escribir sin
  que se borre lo tecleado, sin cobertura y reconexión, operación enviada dos veces, los dos marcando la misma
  tarea, atrasadas al pasar el día, semana cerrada, app instalada sin red. Corre también en CI.
- **Límites de lo que puedo probar aquí:** Chromium sí; **WebKit (Safari del iPhone de Ana) y Podman no**. El
  contenedor se prueba en GitHub Actions y de verdad al instalarlo. **Lo de Safari lo tendrá que comprobar
  Ana** (instalar en pantalla de inicio, casillas, hojas, sin cobertura). **La entrega real de avisos**
  (Apple y Google) tampoco se puede probar aquí ni en CI: se comprueba con «Probar aviso» en vuestros móviles.

## 11. Lo que tienes que hacer tú (y cuándo)

1. **Ahora:** darme el visto bueno o decirme qué cambiar (sobre todo los apartados 2 y 12).
2. **Al acabar la fase 1 (te aviso):** confirmarme que creo desde el navegador el repositorio **vacío y
   público** `github.com/isaacff2000-cloud/tareas-casa`; lo conecto y subo yo.
3. **Tras el primer push:** confirmarme que pongo el paquete `tareas-casa` de ghcr.io en **Public** (lo hago
   yo desde el navegador si me dejas; si no, GitHub → Packages → `tareas-casa` → *Package settings*).
4. **Instalar:** abrir PuTTY al portátil y pegarle a su Claude Code el texto que te prepararé; yo miro la
   ventana (solo ver) y te guío. Comprobará antes y después que menú y gastos siguen intactos.
5. **En los móviles:** abrir `https://bazzite.<tu-red>.ts.net:10000` con Tailscale activo, añadir a la
   pantalla de inicio y elegir «Soy …». **Ana, en Safari** (lo único que no puedo probar).
6. **Primera semana:** elegir las tareas típicas, repartirlas y, al cerrar el domingo, decirme si las metas
   (20/30/8) os han parecido justas.
7. **Cuando llegue la fase 2:** en cada móvil, Ajustes → «Activar avisos» → permitir, y «Probar aviso». Ana,
   abriendo la app **desde el icono** de la pantalla de inicio.

Confirmación: **no creo ni borro nada fuera de mi espacio de trabajo sin pedírtelo antes** (repositorio,
paquetes, portátil).

## 12. Suposiciones (dímelo si alguna no vale)

- Metas iniciales: domicilio 20, salir 30, mínimo 8 cada uno.
- Los puntos son de quien hace la tarea; «los dos» suma una vez al total y a cada uno para el mínimo.
- La semana se puede corregir hasta el martes siguiente; marcar hecha solo con fecha de su semana.
- Mover una aparición solo dentro de su semana.
- Avisos push en la fase 2, con las horas del apartado 7 bis (20:00 · +30 min · viernes 18:00 y domingo
  12:00 · al momento · silencio 23:00–08:00), editables.
- Nombre del repositorio `tareas-casa`; la app se llama «Tareas de casa» (icono «Tareas»).
- Ana ya está en vuestra red de Tailscale con su cuenta (como para gastos).
