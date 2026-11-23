import { h, render } from './vendor/preact.js';
import { useState, useEffect } from './vendor/hooks.js';
import htm from './vendor/htm.js';
import * as N from './nucleo.js';
import { S, suscribir, iniciar, hacer, nuevoId, mensaje, cerrarAviso } from './almacen.js';

const html = htm.bind(h);
const lunesHoy = () => N.lunesDe(N.hoy());

function useAlmacen() {
  const [, set] = useState(0);
  useEffect(() => {
    const quitar = suscribir(() => set((n) => n + 1));
    set((n) => n + 1);
    return quitar;
  }, []);
  return S;
}
function useGuardado(clave, inicial) {
  const [v, set] = useState(() => { try { return JSON.parse(sessionStorage.getItem(clave)) ?? inicial; } catch { return inicial; } });
  return [v, (x) => { set(x); try { sessionStorage.setItem(clave, JSON.stringify(x)); } catch { /* */ } }];
}
// El día cambia a medianoche aunque la app siga abierta
function useHoy() {
  const [d, set] = useState(N.hoy());
  useEffect(() => { const t = setInterval(() => set(N.hoy()), 30_000); return () => clearInterval(t); }, []);
  return d;
}

/* ---------- Piezas comunes ---------- */
function Hoja({ titulo, cerrar, children, pie }) {
  useEffect(() => {
    const esc = (ev) => { if (ev.key === 'Escape') cerrar(); };
    addEventListener('keydown', esc);
    document.body.classList.add('con-hoja');
    return () => { removeEventListener('keydown', esc); document.body.classList.remove('con-hoja'); };
  }, []);
  return html`<div class="velo" onClick=${(ev) => ev.target === ev.currentTarget && cerrar()}>
    <section class="hoja" role="dialog" aria-modal="true" aria-label=${titulo}>
      <header class="hoja-cab"><h2>${titulo}</h2><button class="icono" aria-label="Cerrar" onClick=${cerrar}>✕</button></header>
      <div class="hoja-cuerpo">${children}</div>
      ${pie && html`<footer class="hoja-pie">${pie}</footer>`}
    </section>
  </div>`;
}
const Chip = ({ activo, onClick, children, etiqueta }) => html`<button type="button" class=${'chip' + (activo ? ' activo' : '')} aria-pressed=${!!activo} aria-label=${etiqueta} onClick=${onClick}>${children}</button>`;

/** Círculo con la inicial y el color de la persona (o de «cualquiera» / «los dos»). */
function Av({ e, q }) {
  const texto = q === 'cualquiera' ? '?' : q === 'ambos' ? '2' : N.inicial(e, q);
  return html`<span class=${'av ' + q} title=${N.nombreQuien(e, q)} aria-hidden="true">${texto}</span>`;
}
const quienes = (e, yo) => [['a', N.nombre(e, 'a') + (yo === 'a' ? ' (tú)' : '')], ['b', N.nombre(e, 'b') + (yo === 'b' ? ' (tú)' : '')], ['cualquiera', 'Cualquiera'], ['ambos', 'Los dos']];
const pts = (n) => `${n} ${n === 1 ? 'punto' : 'puntos'}`;

function NavSemana({ lunes, poner }) {
  const actual = lunesHoy();
  return html`<div class="nav-semana">
    <button class="icono" aria-label="Semana anterior" onClick=${() => poner(N.sumarDias(lunes, -7))}>‹</button>
    <button class="mes" onClick=${() => poner(actual)} aria-label="Ir a esta semana">
      <strong>${N.etiquetaSemana(lunes)}</strong>
      <small>${lunes === actual ? 'esta semana' : lunes < actual ? 'pasada' : 'más adelante'}</small>
    </button>
    <button class="icono" aria-label="Semana siguiente" onClick=${() => poner(N.sumarDias(lunes, 7))}>›</button>
  </div>`;
}

/* ---------- Semáforo de puntos ---------- */
function Semaforo({ e, r, yo }) {
  const tope = Math.max(r.metas.salir, r.metas.domicilio, r.puntos.total, 1) * 1.08;
  const pc = (x) => Math.min(100, (x / tope) * 100) + '%';
  return html`<section class="tarjeta semaforo" aria-label="Puntos de la semana">
    <div class="cab-sem"><small>${r.terminada ? 'Semana terminada' : 'Puntos de la semana'}</small><span><b>${r.puntos.total}</b> <small>/ ${r.metas.salir}</small></span></div>
    <div class="pista2" role="img" aria-label=${`${r.puntos.total} puntos: ${r.metas.domicilio} para pedir a domicilio y ${r.metas.salir} para salir`}>
      <div class="relleno" style=${{ width: pc(r.puntos.total) }}></div>
      ${N.PREMIOS.map((p) => html`<div class="marca" key=${p.id} style=${{ left: `calc(${pc(r.metas[p.id])} - 1px)` }}><span>${p.emoji}</span></div>`)}
    </div>
    <div class="minimos">
      <span>Mínimo ${r.metas.minimo} cada uno:</span>
      ${N.PERSONAS.map((p) => html`<span class="m" key=${p}><${Av} e=${e} q=${p} /><span class=${r.faltaMin[p] ? '' : 'ok'}>${r.puntos[p]}${r.faltaMin[p] ? '' : ' ✓'}</span></span>`)}
    </div>
    <div class="premios">${r.premios.map((p) => html`<div class=${'premio' + (p.desbloqueado ? ' si' : '')} key=${p.id}>
      <span class="em" aria-hidden="true">${p.emoji}</span><b>${p.nombre}</b>
      <small>${textoPremio(e, p, r, yo)}</small></div>`)}</div>
  </section>`;
}
function textoPremio(e, p, r, yo) {
  if (p.desbloqueado) return r.terminada ? 'Conseguido ✓' : 'Desbloqueado ✓';
  const quien = N.PERSONAS.filter((q) => r.faltaMin[q]).map((q) => (q === yo ? 'tu' : 'el de ' + N.nombre(e, q)));
  const t = p.faltan ? `Faltan ${pts(p.faltan)}` : `Falta ${quien.join(' y ')} mínimo`;
  return r.terminada ? 'No conseguido · ' + t.toLowerCase() : t;
}

/* ---------- Una tarea en la lista ---------- */
function puedeMarcar(a, dia) { return N.semanaAbierta(a.lunes, dia) && dia >= a.lunes && dia <= N.domingoDe(a.lunes); }

function marcar(e, a, yo, dia, hechaPor) {
  const quien = hechaPor || (a.quien === 'ambos' ? ['a', 'b'] : [yo]);
  return hacer({ tipo: 'aparicion.hecha', aparicion: a.clave, hechaPor: quien, dia },
    { deshacer: { texto: `«${a.nombre}» hecha · +${a.puntos}`, ops: [{ tipo: 'aparicion.deshacer', aparicion: a.clave }] } });
}

function FilaTarea({ e, a, yo, dia, abrir, conDia }) {
  const est = N.estadoAp(a, dia);
  const sePuede = puedeMarcar(a, dia) && !a.saltada;
  const clic = () => {
    if (!a.hecha) return marcar(e, a, yo, dia);
    if (a.hecha.marco === yo) return hacer({ tipo: 'aparicion.deshacer', aparicion: a.clave });
    abrir(a); // la marcó el otro: desde la hoja se puede devolver
  };
  const sub = [];
  if (conDia || est === 'atrasada') sub.push(html`<span class=${est === 'atrasada' ? 'atr' : ''}>${est === 'atrasada' ? 'atrasada · ' : ''}${N.etiquetaDia(a.fecha)}</span>`);
  if (a.hora) sub.push(html`<span>🕒 ${a.hora}</span>`);
  if (a.hecha) sub.push(html`<span>hecha por ${a.hecha.por.map((p) => N.nombre(e, p)).join(' y ')}</span>`);
  else if (a.devuelta) sub.push(html`<span class="dev">↩ ${N.nombre(e, a.devuelta.por)}${a.devuelta.nota ? ': ' + a.devuelta.nota : ''}</span>`);
  if (a.saltada) sub.push(html`<span>esta semana no</span>`);
  if (est === 'nohecha') sub.push(html`<span>no hecha</span>`);
  if (a.cambiada && !a.hecha) sub.push(html`<span>cambiada esta vez</span>`);
  const etiqueta = `${a.nombre}${a.hecha ? ', hecha' : ''}`;
  return html`<div class=${'tarea ' + est}>
    <button class="abrir" onClick=${() => abrir(a)} aria-label=${'Detalles de ' + a.nombre}>
      <span class="em" aria-hidden="true">${a.emoji}</span>
      <span class="texto"><strong>${a.nombre}</strong>${sub.length > 0 && html`<small>${sub.map((x, i) => html`${i ? ' · ' : ''}${x}`)}</small>`}</span>
      <${Av} e=${e} q=${a.hecha ? (a.hecha.por.length === 2 ? 'ambos' : a.hecha.por[0]) : a.quien} />
      <span class="pts">${a.puntos}</span>
    </button>
    <button class=${'marcar' + (a.hecha ? ' si' : '')} role="checkbox" aria-checked=${!!a.hecha} aria-label=${etiqueta}
      disabled=${!sePuede} onClick=${clic}>${a.hecha ? '✓' : ''}</button>
  </div>`;
}

const Lista = ({ e, aps, yo, dia, abrir, conDia, vacio }) => (aps.length
  ? html`<section class="tarjeta lista">${aps.map((a) => html`<${FilaTarea} key=${a.clave} e=${e} a=${a} yo=${yo} dia=${dia} abrir=${abrir} conDia=${conDia} />`)}</section>`
  : vacio ? html`<div class="tarjeta vacia">${vacio}</div>` : null);

function Filtro({ filtro, poner, e, yo }) {
  return html`<div class="segmento" role="group" aria-label="Qué tareas ver">
    <${Chip} activo=${filtro === 'todas'} onClick=${() => poner('todas')}>Todas</${Chip}>
    <${Chip} activo=${filtro === 'mias'} onClick=${() => poner('mias')}>Mías</${Chip}>
    <${Chip} activo=${filtro === 'otro'} onClick=${() => poner('otro')}>De ${N.nombre(e, N.otro(yo))}</${Chip}>
  </div>`;
}
const filtrar = (aps, filtro, yo) => (filtro === 'todas' ? aps : aps.filter((a) => N.leToca(a, filtro === 'mias' ? yo : N.otro(yo)) || (a.hecha && a.hecha.por.includes(filtro === 'mias' ? yo : N.otro(yo)))));

/* ---------- Hoy ---------- */
function Hoy({ e, yo, dia, abrir }) {
  const [filtro, setFiltro] = useGuardado('tareas.filtro', 'todas');
  const r = N.resumenSemana(e, N.lunesDe(dia), dia);
  const aps = filtrar(r.aps, filtro, yo);
  const atrasadas = aps.filter((a) => N.estadoAp(a, dia) === 'atrasada');
  const deHoy = aps.filter((a) => a.fecha === dia);
  const manana = N.sumarDias(dia, 1);
  const deManana = N.lunesDe(manana) === r.lunes ? aps.filter((a) => a.fecha === manana && !a.saltada) : [];
  const quedan = deHoy.filter((a) => !a.hecha && !a.saltada).length + atrasadas.length;
  return html`<div>
    <p class="cab-sub cap2">${N.etiquetaDiaLarga(dia)}${quedan ? ` · te quedan ${quedan}` : ''}</p>
    <${Semaforo} e=${e} r=${r} yo=${yo} />
    <${Filtro} filtro=${filtro} poner=${setFiltro} e=${e} yo=${yo} />
    ${atrasadas.length > 0 && html`<h2 class="seccion">Atrasadas</h2><${Lista} e=${e} aps=${atrasadas} yo=${yo} dia=${dia} abrir=${abrir} conDia=${true} />`}
    <h2 class="seccion">Hoy</h2>
    <${Lista} e=${e} aps=${deHoy} yo=${yo} dia=${dia} abrir=${abrir} vacio=${Object.keys(e.tareas).length ? 'Nada para hoy 🎉' : 'Aún no hay tareas. Pulsa ＋ para crear la primera.'} />
    ${deManana.length > 0 && html`<h2 class="seccion">Mañana</h2><${Lista} e=${e} aps=${deManana} yo=${yo} dia=${dia} abrir=${abrir} />`}
  </div>`;
}

/* ---------- Semana ---------- */
function Semana({ e, yo, dia, lunes, setLunes, abrir, nueva }) {
  const [filtro, setFiltro] = useGuardado('tareas.filtro', 'todas');
  const r = N.resumenSemana(e, lunes, dia);
  const aps = filtrar(r.aps, filtro, yo);
  const noLlega = r.premios.filter((p) => !p.alcanzable);
  return html`<div>
    <${NavSemana} lunes=${lunes} poner=${setLunes} />
    <${Semaforo} e=${e} r=${r} yo=${yo} />
    <p class="nota">Planificado: ${pts(r.planificados)}.${noLlega.length > 0 && !r.terminada ? ` ⚠ No llega para ${noLlega.map((p) => p.nombre.toLowerCase()).join(' ni para ')}: añadid tareas o subid puntos.` : ''}</p>
    ${!r.abierta && html`<div class="cerrada">Semana cerrada: ya no se puede cambiar.</div>`}
    <${Filtro} filtro=${filtro} poner=${setFiltro} e=${e} yo=${yo} />
    ${N.diasDeSemana(lunes).map((f) => {
      const del = aps.filter((a) => a.fecha === f);
      const suma = del.filter((a) => !a.saltada).reduce((s, a) => s + a.puntos, 0);
      return html`<div class=${'dia' + (f === dia ? ' hoy' : '')} key=${f}>
        <div class="dia-cab"><h2 class="cap2">${N.etiquetaDia(f)}${f === dia ? ' · hoy' : ''}${suma ? html`<small>${pts(suma)}</small>` : ''}</h2>
          ${r.abierta && html`<button class="icono" aria-label=${'Añadir tarea el ' + N.etiquetaDia(f)} onClick=${() => nueva(f)}>＋</button>`}</div>
        <${Lista} e=${e} aps=${del} yo=${yo} dia=${dia} abrir=${abrir} vacio="Libre" />
      </div>`;
    })}
  </div>`;
}

/* ---------- Tareas: todo lo que se repite, de un vistazo ---------- */
const GRUPOS = [
  ['semanal', 'Cada semana'], ['nsemanas', 'Cada 2 semanas o más'], ['mensual', 'Una vez al mes'], ['una', 'De un solo día'],
];
function Catalogo({ e, yo, dia, editar }) {
  const [filtro, setFiltro] = useGuardado('tareas.filtro', 'todas');
  const [verQuitadas, setVerQuitadas] = useState(false);
  const lunes = N.lunesDe(dia);
  const prox = N.proximas(e, dia);
  const toca = (t) => filtro === 'todas' || N.destinatarios(t.v.quien).includes(filtro === 'mias' ? yo : N.otro(yo));
  const repetidas = N.tareasRepetidas(e, lunes).filter(toca);
  // Las de un solo día: solo las que aún tienen algo pendiente
  const sueltas = Object.values(e.tareas).filter((t) => !t.hasta && prox[t.id]).map((t) => ({ ...t, v: N.versionVigente(t, lunes) })).filter((t) => t.v && t.v.rep.tipo === 'una' && toca(t));
  const todas = [...repetidas, ...sueltas];
  const quitadas = N.tareasRepetidas(e, lunes, { archivadas: true });
  const porSemana = (t) => (t.v.rep.tipo === 'semanal' ? (t.v.puntos * t.v.rep.dias.length) / t.v.rep.cada : null);
  const metas = N.metasDe(e, lunes);
  const media = N.mediaSemanal(e, dia);
  const orden = (x, y) => (prox[x.id] || '9').localeCompare(prox[y.id] || '9') || x.nombre.localeCompare(y.nombre, 'es');
  const fila = (t) => {
    const r = t.v.rep, ps = porSemana(t);
    return html`<button class="fila pulsable cat" key=${t.id} onClick=${() => editar(e.tareas[t.id])} aria-label=${'Editar ' + t.nombre}>
      <span class="em" aria-hidden="true">${t.emoji}</span>
      <span class="texto"><strong>${t.nombre}</strong>
        ${r.tipo === 'semanal' && r.cada === 1
          ? html`<span class="semana7" aria-label=${N.textoRep(r)}>${N.DIAS_CORTOS.map((d, i) => html`<i key=${d} class=${r.dias.includes(i + 1) ? 'si' : ''}>${d}</i>`)}</span>`
          : html`<small class="cap2">${r.tipo === 'una' ? N.etiquetaDiaLarga(r.fecha) : N.textoRep(r)}</small>`}
        <small>${t.v.hora ? `🕒 ${t.v.hora} · ` : ''}${prox[t.id] ? (prox[t.id] === dia ? 'toca hoy' : 'próxima: ' + N.etiquetaDia(prox[t.id]) + (N.lunesDe(prox[t.id]) !== lunes ? ' ' + N.aFecha(prox[t.id]).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '') : '')) : 'sin fecha próxima'}</small>
      </span>
      <${Av} e=${e} q=${t.v.quien} />
      <span class="pts" title=${ps && ps !== t.v.puntos ? `${t.v.puntos} cada vez, ${Math.round(ps * 10) / 10} a la semana` : `${t.v.puntos} cada vez`}>${t.v.puntos}${ps && ps !== t.v.puntos ? html`<small> × ${Math.round((ps / t.v.puntos) * 10) / 10}</small>` : ''}</span>
    </button>`;
  };
  return html`<div>
    <section class="tarjeta resumen">
      <div class="par"><span>Tareas${filtro !== 'todas' ? ' (con este filtro)' : ''}</span><b>${todas.length}</b></div>
      <div class="par"><span>Puntos por semana, de media</span><b>${media}</b></div>
      <div class="par"><span>Metas: 🛵 ${metas.domicilio} · 🍻 ${metas.salir} · mínimo ${metas.minimo} c/u</span></div>
      ${media > 0 && html`<p class="nota">Para salir hace falta hacer el ${Math.round((metas.salir / media) * 100)} % de lo planificado; para pedir a domicilio, el ${Math.round((metas.domicilio / media) * 100)} %.</p>`}
    </section>
    <${Filtro} filtro=${filtro} poner=${setFiltro} e=${e} yo=${yo} />
    ${!todas.length && html`<p class="vacio">${Object.keys(e.tareas).length ? 'Ninguna con este filtro.' : 'Aún no hay tareas. Pulsa ＋ para crear la primera.'}</p>`}
    ${GRUPOS.map(([g, titulo]) => {
      const del = todas.filter((t) => N.grupoRep(t.v.rep) === g).sort(g === 'semanal' ? (x, y) => y.v.rep.dias.length - x.v.rep.dias.length || x.nombre.localeCompare(y.nombre, 'es') : orden);
      return del.length > 0 && html`<h2 class="seccion" key=${g}>${titulo} · ${del.length}</h2><section class="tarjeta lista">${del.map(fila)}</section>`;
    })}
    <p class="nota">Toca una tarea para cambiarla (días, persona, puntos…) desde esta semana o la siguiente. Para cambiar solo una vez, hazlo desde Hoy o Semana.</p>
    ${quitadas.length > 0 && html`<button class="enlace" onClick=${() => setVerQuitadas(!verQuitadas)}>Tareas quitadas (${quitadas.length})</button>
      ${verQuitadas && html`<section class="tarjeta lista">${quitadas.map((t) => html`<div class="fila" key=${t.id}>
        <span class="em" aria-hidden="true">${t.emoji}</span><div class="texto"><strong>${t.nombre}</strong><small>quitada desde la semana del ${N.etiquetaSemana(t.hasta)}</small></div>
        <button class="chip" onClick=${() => hacer({ tipo: 'tarea.recuperar', tarea: t.id })}>Recuperar</button></div>`)}</section>`}`}
  </div>`;
}

/* ---------- Hoja de una aparición ---------- */
function HojaAparicion({ e, yo, dia, clave, cerrar, editar }) {
  const lunesAp = N.lunesDe(N.partirClave(clave).fecha);
  const a = N.aparicionesSemana(e, lunesAp).find((x) => x.clave === clave);
  const [hechaPor, setHechaPor] = useState(() => (a && a.quien === 'ambos' ? ['a', 'b'] : [yo]));
  const [nota, setNota] = useState('');
  const [cambio, setCambio] = useState(null); // { fecha, conHora, hora, quien } mientras se edita «solo esta vez»
  if (!a) return html`<${Hoja} titulo="Tarea" cerrar=${cerrar}><p class="vacio">Esta tarea ya no está.</p></${Hoja}>`;
  const t = e.tareas[a.tarea];
  const abierta = N.semanaAbierta(a.lunes, dia);
  const marcable = puedeMarcar(a, dia) && !a.saltada;
  const opcionHecha = [[[yo], 'Yo'], [[N.otro(yo)], N.nombre(e, N.otro(yo))], [['a', 'b'], 'Los dos']];
  const igual = (x, y) => x.length === y.length && x.every((v) => y.includes(v));

  const guardarCambio = () => {
    const op = { tipo: 'aparicion.cambiar', aparicion: a.clave, fecha: cambio.fecha, hora: cambio.conHora ? cambio.hora || null : null, quien: cambio.quien };
    if (cambio.conHora && !N.RE_HORA.test(cambio.hora || '')) return mensaje('Escribe la hora, por ejemplo 18:30', 'error');
    if (hacer(op)) { setCambio(null); cerrar(); mensaje('Cambiado solo esta vez'); }
  };

  return html`<${Hoja} titulo=${`${a.emoji} ${a.nombre}`} cerrar=${cerrar}>
    <dl class="info">
      <dt>Día</dt><dd class="cap2">${N.etiquetaDiaLarga(a.fecha)}${a.fecha !== a.fechaOriginal ? ` (movida desde el ${N.etiquetaDia(a.fechaOriginal)})` : ''}</dd>
      <dt>Hora</dt><dd>${a.hora || 'sin hora'}</dd>
      <dt>Le toca a</dt><dd>${N.nombreQuien(e, a.quien)}</dd>
      <dt>Puntos</dt><dd>${a.puntos}</dd>
      <dt>Se repite</dt><dd>${N.textoRep(a.rep)}</dd>
      ${a.hecha && html`<dt>Hecha por</dt><dd>${a.hecha.por.map((p) => N.nombre(e, p)).join(' y ')}${a.hecha.marco && !a.hecha.por.includes(a.hecha.marco) ? ` (la marcó ${N.nombre(e, a.hecha.marco)})` : ''}</dd>`}
      ${a.devuelta && !a.hecha && html`<dt>Devuelta</dt><dd>por ${N.nombre(e, a.devuelta.por)}${a.devuelta.nota ? `: «${a.devuelta.nota}»` : ''}</dd>`}
    </dl>
    ${!abierta && html`<div class="cerrada">Semana cerrada: ya no se puede cambiar.</div>`}

    ${marcable && !a.hecha && html`<div class="campo"><span>¿Quién la ha hecho?</span><div class="chips">
        ${opcionHecha.map(([v, txt]) => html`<${Chip} key=${txt} activo=${igual(hechaPor, v)} onClick=${() => setHechaPor(v)}>${txt}</${Chip}>`)}</div></div>
      <button class="boton" onClick=${() => { if (marcar(e, a, yo, dia, hechaPor)) cerrar(); }}>Marcar como hecha · +${a.puntos}</button>`}
    ${abierta && !marcable && !a.hecha && !a.saltada && html`<p class="nota">Solo se puede marcar como hecha durante su semana.</p>`}

    ${abierta && a.hecha && (a.hecha.marco === yo || !a.hecha.marco
      ? html`<button class="boton suave" onClick=${() => { if (hacer({ tipo: 'aparicion.deshacer', aparicion: a.clave })) cerrar(); }}>Desmarcar (no está hecha)</button>`
      : html`<h3>¿No está bien hecha?</h3>
        <label>Nota para ${N.nombre(e, a.hecha.marco)} (opcional)<textarea maxlength="120" value=${nota} placeholder="Ej. falta el baño de arriba" onInput=${(ev) => setNota(ev.target.value)}></textarea></label>
        <button class="boton peligro" onClick=${() => { if (hacer({ tipo: 'aparicion.devolver', aparicion: a.clave, nota: nota.trim() },
          { deshacer: { texto: 'Tarea devuelta', ops: [{ tipo: 'aparicion.hecha', aparicion: a.clave, hechaPor: a.hecha.por, dia: a.hecha.dia }] } })) cerrar(); }}>Devolver a pendiente · −${a.puntos}</button>`)}

    ${abierta && !a.hecha && html`<h3>Solo esta vez</h3>
      ${cambio === null ? html`<div class="dos">
          <button class="boton suave" onClick=${() => setCambio({ fecha: a.fecha, conHora: !!a.hora, hora: a.hora || '', quien: a.quien })}>Cambiar día, hora o persona</button>
          ${a.saltada
            ? html`<button class="boton suave" onClick=${() => { if (hacer({ tipo: 'aparicion.restaurar', aparicion: a.clave })) cerrar(); }}>Volver a ponerla</button>`
            : html`<button class="boton suave" onClick=${() => { if (hacer({ tipo: 'aparicion.saltar', aparicion: a.clave }, { deshacer: { texto: 'Saltada esta semana', ops: [{ tipo: 'aparicion.restaurar', aparicion: a.clave }] } })) cerrar(); }}>Esta semana no toca</button>`}
        </div>
        ${a.cambiada && !a.saltada && html`<button class="enlace" onClick=${() => { if (hacer({ tipo: 'aparicion.restaurar', aparicion: a.clave })) cerrar(); }}>Deshacer los cambios de esta vez</button>`}`
      : html`<div class="campo"><span>Día</span><div class="dias7">${N.diasDeSemana(a.lunes).map((f, i) => html`<${Chip} key=${f} activo=${cambio.fecha === f}
            etiqueta=${N.etiquetaDia(f)} onClick=${() => setCambio({ ...cambio, fecha: f })}>${N.DIAS_CORTOS[i]}</${Chip}>`)}</div></div>
        <${CampoHora} con=${cambio.conHora} hora=${cambio.hora} poner=${(conHora, hora) => setCambio({ ...cambio, conHora, hora })} />
        <div class="campo"><span>Le toca a</span><div class="chips">${quienes(e, yo).map(([q, txt]) => html`<${Chip} key=${q} activo=${cambio.quien === q} onClick=${() => setCambio({ ...cambio, quien: q })}>${txt}</${Chip}>`)}</div></div>
        <div class="dos"><button class="boton suave" onClick=${() => setCambio(null)}>Cancelar</button><button class="boton" onClick=${guardarCambio}>Guardar esta vez</button></div>`}`}

    ${abierta && t && html`<button class="boton suave" onClick=${() => editar(t, a.lunes)}>✎ Editar la tarea${a.rep.tipo !== 'una' ? ' (todas las semanas)' : ''}</button>`}
  </${Hoja}>`;
}

function CampoHora({ con, hora, poner }) {
  return html`<div class="campo"><span>Hora</span><div class="fila-campo">
    <div class="segmento" role="group" aria-label="Hora">
      <${Chip} activo=${!con} onClick=${() => poner(false, hora)}>Sin hora</${Chip}>
      <${Chip} activo=${con} onClick=${() => poner(true, hora || '20:00')}>A una hora</${Chip}>
    </div>
    ${con && html`<input type="time" aria-label="Hora" value=${hora} onInput=${(ev) => poner(true, ev.target.value)} />`}
  </div></div>`;
}

/* ---------- Crear o editar una tarea ---------- */
const EMOJIS = ['🧹', '🍽️', '🧺', '🚿', '🛏️', '🗑️', '🪴', '🍳', '🛒', '🧽', '🐱', '🚗'];
function HojaTarea({ e, yo, dia, tarea, lunesVista, fechaInicial, cerrar }) {
  const nueva = !tarea;
  const lunesBase = nueva ? lunesVista : (lunesVista < lunesHoy() ? lunesHoy() : lunesVista);
  const vAntes = tarea ? N.versionVigente(tarea, lunesBase) || Object.values(tarea.versiones)[0] : null;
  const [f, setF] = useState(() => {
    const v = vAntes || { puntos: 2, quien: yo, hora: null, rep: { tipo: 'una', fecha: fechaInicial } };
    const r = v.rep;
    return {
      nombre: tarea ? tarea.nombre : '', emoji: tarea ? tarea.emoji : '🧹', puntos: String(v.puntos), quien: v.quien, conHora: !!v.hora, hora: v.hora || '',
      tipo: r.tipo, fecha: r.tipo === 'una' ? r.fecha : fechaInicial,
      dias: r.tipo === 'semanal' ? r.dias : [N.diaSemana(fechaInicial)], cada: r.tipo === 'semanal' ? r.cada : 1,
      modoMes: r.tipo === 'mensual' && r.diaSemana != null ? 'semana' : 'dia', diaMes: r.tipo === 'mensual' && r.dia != null ? String(r.dia) : String(Number(fechaInicial.slice(8))),
      orden: r.tipo === 'mensual' && r.orden != null ? r.orden : 1, diaSemana: r.tipo === 'mensual' && r.diaSemana != null ? r.diaSemana : N.diaSemana(fechaInicial),
      desde: lunesBase,
    };
  });
  const pon = (c, v) => setF({ ...f, [c]: v });
  const unaAntes = vAntes && vAntes.rep.tipo === 'una';

  const regla = () => {
    if (f.tipo === 'una') return { tipo: 'una', fecha: f.fecha };
    if (f.tipo === 'semanal') return { tipo: 'semanal', dias: f.dias, cada: f.cada, ancla: nueva ? lunesBase : (vAntes.rep.ancla || lunesBase) };
    if (f.modoMes === 'semana') return { tipo: 'mensual', orden: f.orden, diaSemana: f.diaSemana };
    return { tipo: 'mensual', dia: f.diaMes === 'ultimo' ? 'ultimo' : Number(f.diaMes) };
  };
  const guardar = () => {
    if (f.conHora && !N.RE_HORA.test(f.hora || '')) return mensaje('Escribe la hora, por ejemplo 18:30', 'error');
    const version = { puntos: Number(f.puntos), quien: f.quien, hora: f.conHora ? f.hora : null, rep: regla() };
    if (nueva) {
      const inicio = lunesBase === N.lunesDe(dia) ? dia : lunesBase;
      if (hacer({ tipo: 'tarea.crear', tarea: { id: nuevoId(), nombre: f.nombre, emoji: f.emoji }, inicio, version })) { cerrar(); mensaje('Tarea creada'); }
      return;
    }
    const ops = [];
    if (f.nombre.trim() !== tarea.nombre || f.emoji.trim() !== tarea.emoji) ops.push({ tipo: 'tarea.renombrar', tarea: tarea.id, nombre: f.nombre, emoji: f.emoji });
    if (JSON.stringify(version) !== JSON.stringify(vAntes)) ops.push({ tipo: 'tarea.cambiar', tarea: tarea.id, desde: f.desde, version });
    if (!ops.length) return cerrar();
    if (hacer(ops)) { cerrar(); mensaje(unaAntes || ops.every((o) => o.tipo === 'tarea.renombrar') ? 'Guardado' : `Cambiada desde la semana del ${N.etiquetaSemana(f.desde)}`); }
  };
  const quitar = () => {
    const desde = unaAntes ? N.lunesDe(vAntes.rep.fecha) : f.desde;
    if (hacer({ tipo: 'tarea.archivar', tarea: tarea.id, desde }, { deshacer: { texto: `«${tarea.nombre}» quitada`, ops: [{ tipo: 'tarea.recuperar', tarea: tarea.id }] } })) cerrar();
  };
  const tipos = nueva || !unaAntes ? (nueva ? [['una', 'Un día'], ['semanal', 'Cada semana'], ['mensual', 'Cada mes']] : [['semanal', 'Cada semana'], ['mensual', 'Cada mes']]) : [['una', 'Un día']];

  return html`<${Hoja} titulo=${nueva ? 'Nueva tarea' : 'Editar tarea'} cerrar=${cerrar} pie=${html`<button class="boton" onClick=${guardar}>${nueva ? 'Crear tarea' : 'Guardar'}</button>`}>
    <label>Nombre<input type="text" maxlength="40" value=${f.nombre} placeholder="Ej. Limpiar el baño" onInput=${(ev) => pon('nombre', ev.target.value)} /></label>
    <div class="chips sugerencias" role="group" aria-label="Emoji">${EMOJIS.map((x) => html`<${Chip} key=${x} activo=${f.emoji === x} onClick=${() => pon('emoji', x)}>${x}</${Chip}>`)}</div>
    <div class="campo"><span>Puntos</span><div class="fila-campo puntos-campo">
      <div class="chips">${N.PUNTOS_SUGERIDOS.map((p) => html`<${Chip} key=${p} activo=${f.puntos === String(p)} onClick=${() => pon('puntos', String(p))}>${p}</${Chip}>`)}</div>
      <input class="corto" type="number" inputmode="numeric" min="1" max=${N.MAX_PUNTOS} aria-label="Puntos" value=${f.puntos} onInput=${(ev) => pon('puntos', ev.target.value)} />
    </div></div>
    <div class="campo"><span>Le toca a</span><div class="chips">${quienes(e, yo).map(([q, txt]) => html`<${Chip} key=${q} activo=${f.quien === q} onClick=${() => pon('quien', q)}><${Av} e=${e} q=${q} />${txt}</${Chip}>`)}</div></div>
    <${CampoHora} con=${f.conHora} hora=${f.hora} poner=${(conHora, hora) => setF({ ...f, conHora, hora })} />

    <div class="campo"><span>Cuándo</span>${tipos.length > 1 && html`<div class="segmento" role="group" aria-label="Cuándo">${tipos.map(([k, txt]) => html`<${Chip} key=${k} activo=${f.tipo === k} onClick=${() => pon('tipo', k)}>${txt}</${Chip}>`)}</div>`}</div>
    ${f.tipo === 'una' && html`<label>Día<input type="date" value=${f.fecha} onInput=${(ev) => ev.target.value && pon('fecha', ev.target.value)} /></label>`}
    ${f.tipo === 'semanal' && html`<div class="campo"><span>Días</span><div class="dias7">${N.DIAS_CORTOS.map((d, i) => html`<${Chip} key=${d} etiqueta=${N.DIAS[i]} activo=${f.dias.includes(i + 1)}
        onClick=${() => pon('dias', f.dias.includes(i + 1) ? f.dias.filter((x) => x !== i + 1) : [...f.dias, i + 1].sort())}>${d}</${Chip}>`)}</div></div>
      <div class="campo"><span>Frecuencia</span><div class="chips">${[1, 2, 3, 4].map((n) => html`<${Chip} key=${n} activo=${f.cada === n} onClick=${() => pon('cada', n)}>${n === 1 ? 'Todas las semanas' : `Cada ${n}`}</${Chip}>`)}</div></div>
      ${f.cada > 1 && html`<p class="nota">Empieza la semana del ${N.etiquetaSemana(nueva ? lunesBase : vAntes.rep.ancla || lunesBase)}.</p>`}`}
    ${f.tipo === 'mensual' && html`<div class="segmento" role="group" aria-label="Qué día del mes" style=${{ marginTop: '10px' }}>
        <${Chip} activo=${f.modoMes === 'dia'} onClick=${() => pon('modoMes', 'dia')}>Un día del mes</${Chip}>
        <${Chip} activo=${f.modoMes === 'semana'} onClick=${() => pon('modoMes', 'semana')}>Un día de la semana</${Chip}>
      </div>
      ${f.modoMes === 'dia' ? html`<div class="fila-campo"><label>Día del mes<input type="number" inputmode="numeric" min="1" max="31" value=${f.diaMes === 'ultimo' ? '' : f.diaMes} onInput=${(ev) => pon('diaMes', ev.target.value)} /></label>
          <${Chip} activo=${f.diaMes === 'ultimo'} onClick=${() => pon('diaMes', 'ultimo')}>El último</${Chip}></div>`
        : html`<div class="campo"><div class="chips">${[[1, 'Primer'], [2, 'Segundo'], [3, 'Tercer'], [4, 'Cuarto'], ['ultimo', 'Último']].map(([o, txt]) => html`<${Chip} key=${o} activo=${f.orden === o} onClick=${() => pon('orden', o)}>${txt}</${Chip}>`)}</div></div>
          <div class="campo"><div class="dias7">${N.DIAS_CORTOS.map((d, i) => html`<${Chip} key=${d} etiqueta=${N.DIAS[i]} activo=${f.diaSemana === i + 1} onClick=${() => pon('diaSemana', i + 1)}>${d}</${Chip}>`)}</div></div>`}
      <p class="nota">${(() => { try { return 'Se hará ' + N.textoRep(regla()) + '.'; } catch { return ''; } })()}</p>`}

    ${!nueva && !unaAntes && html`<div class="campo"><span>Los cambios valen desde</span><div class="chips">
        ${[lunesBase, N.sumarDias(lunesBase, 7)].map((l) => html`<${Chip} key=${l} activo=${f.desde === l} onClick=${() => pon('desde', l)}>${l === lunesHoy() ? 'Esta semana' : l === N.sumarDias(lunesHoy(), 7) ? 'La semana que viene' : 'La semana del ' + N.etiquetaSemana(l)}</${Chip}>`)}</div></div>
      <p class="nota">Las semanas anteriores no cambian. El nombre y el emoji cambian en todas.</p>`}
    ${!nueva && html`<button class="boton peligro" onClick=${quitar}>${unaAntes ? 'Borrar la tarea' : `Quitar desde la semana del ${N.etiquetaSemana(f.desde)}`}</button>`}
  </${Hoja}>`;
}

/* ---------- Avisos push ---------- */
function b64(t) { const p = '='.repeat((4 - (t.length % 4)) % 4); const x = atob((t + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(x, (c) => c.charCodeAt(0)); }
const esIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
async function pedirApi(ruta, cuerpo) {
  const r = await fetch(ruta, cuerpo === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
  return d;
}
const nombreAparato = () => { const u = navigator.userAgent; return /iphone/i.test(u) ? 'iPhone' : /ipad/i.test(u) ? 'iPad' : /android/i.test(u) ? 'Android' : 'Navegador'; };

/** Activar o quitar los avisos en ESTE móvil. */
function ActivarAvisos() {
  const [estado, setEstado] = useState('comprobando');
  const [ocupado, setOcupado] = useState(false);
  async function comprobar() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { setEstado(esIOS() && !instalada() ? 'instalar' : 'sin-soporte'); return; }
    if (Notification.permission === 'denied') { setEstado('denegado'); return; }
    try {
      // Si el service worker no llega a registrarse (modo privado…), no se queda «Comprobando…» para siempre
      const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((_, mal) => setTimeout(() => mal(new Error('sin service worker')), 5000))]);
      setEstado((await reg.pushManager.getSubscription()) && Notification.permission === 'granted' ? 'activo' : 'inactivo');
    } catch { setEstado('sin-soporte'); }
  }
  useEffect(() => { comprobar(); }, []);
  async function activar() {
    setOcupado(true);
    try {
      if ((await Notification.requestPermission()) !== 'granted') { await comprobar(); return; }
      const { clave } = await pedirApi('/api/avisos');
      if (!clave) throw new Error('El portátil no tiene los avisos preparados');
      const reg = await navigator.serviceWorker.ready;
      let sus = await reg.pushManager.getSubscription();
      if (!sus) sus = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(clave) });
      await pedirApi('/api/avisos/suscribir', { suscripcion: sus.toJSON(), dispositivo: nombreAparato() });
      mensaje('Avisos activados en este móvil');
      await comprobar();
    } catch (err) { mensaje(err.message || 'No se pudieron activar los avisos', 'error'); } finally { setOcupado(false); }
  }
  async function quitar() {
    setOcupado(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sus = await reg.pushManager.getSubscription();
      if (sus) { await pedirApi('/api/avisos/quitar', { endpoint: sus.endpoint }).catch(() => {}); await sus.unsubscribe(); }
      mensaje('Avisos quitados de este móvil');
      await comprobar();
    } catch (err) { mensaje(err.message, 'error'); } finally { setOcupado(false); }
  }
  async function probar() {
    setOcupado(true);
    try {
      const r = await pedirApi('/api/avisos/probar', {});
      mensaje(r.enviados ? 'Aviso de prueba enviado: debería llegarte en unos segundos' : 'El servicio de avisos no lo aceptó; prueba a quitar y activar otra vez', r.enviados ? 'info' : 'error');
    } catch (err) { mensaje(err.message, 'error'); } finally { setOcupado(false); }
  }
  if (estado === 'comprobando') return html`<p class="nota">Comprobando…</p>`;
  if (estado === 'instalar') return html`<p class="nota">En iPhone los avisos solo funcionan con la app instalada: en Safari pulsa Compartir › «Añadir a pantalla de inicio», ábrela desde el icono y vuelve aquí (iOS 16.4 o posterior).</p>`;
  if (estado === 'sin-soporte') return html`<p class="nota">Este navegador no admite avisos push. En Android usa Chrome; en iPhone, la app instalada en la pantalla de inicio.</p>`;
  if (estado === 'denegado') return html`<p class="nota">Has bloqueado los avisos para esta app. Permítelos en los ajustes del móvil y vuelve aquí.</p>`;
  if (estado === 'inactivo') return html`<button class="boton" disabled=${ocupado} onClick=${activar}>Activar avisos en este móvil</button>`;
  return html`<p class="nota">✓ Activados en este móvil.</p>
    <div class="fila-campo"><button class="boton suave" disabled=${ocupado} onClick=${probar}>Probar aviso</button><button class="boton suave" disabled=${ocupado} onClick=${quitar}>Quitar</button></div>`;
}

const HORAS_AVISO = Array.from({ length: 30 }, (_, i) => { const m = 8 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; });
/** Qué avisos quiere cada uno (se guardan como un cambio más y valen para todos sus móviles). */
function PrefsAvisos({ e, yo }) {
  const pr = N.prefsAvisos(e, yo);
  const poner = (cambio) => hacer({ tipo: 'avisos.preferencias', ...cambio });
  const hora = (k) => html`<select class="hora-aviso" value=${pr[k]} onChange=${(ev) => poner({ [k]: ev.target.value })}>${HORAS_AVISO.map((h) => html`<option value=${h}>${h}</option>`)}</select>`;
  const fila = (k, titulo, detalle, extra = null) => html`<div class="pref-aviso">
    <label class="interruptor"><input type="checkbox" checked=${pr[k]} onChange=${(ev) => poner({ [k]: ev.target.checked })} /><span><b>${titulo}</b><small>${detalle}</small></span></label>
    ${extra && pr[k] && html`<div class="pref-extra">${extra}</div>`}
  </div>`;
  return html`<div class="prefs-avisos">
    ${fila('hoy', 'Lo que te queda hoy', 'Si tienes tareas de hoy o atrasadas sin hacer.', html`a las ${hora('horaHoy')}`)}
    ${fila('conHora', 'Tareas con hora', 'Si siguen sin hacer pasada su hora.', html`<select class="hora-aviso" value=${pr.retraso} onChange=${(ev) => poner({ retraso: Number(ev.target.value) })}>
      ${N.RETRASOS.map((r) => html`<option value=${r}>${r ? `${r} min después` : 'a su hora'}</option>`)}</select>`)}
    ${fila('puntos', 'Faltan puntos', 'Viernes a las 18:00 y domingo a las 12:00, si algún premio sigue bloqueado.')}
    ${fila('devuelta', 'Te devuelven una tarea', 'Al momento, con la nota.')}
    ${fila('manana', 'Mañana toca', 'Resumen de tus tareas de mañana.', html`a las ${hora('horaManana')}`)}
    <p class="nota">De 23:00 a 08:00 no llega nada: una devolución de noche espera a las 08:00. Estas preferencias valen para todos tus móviles.</p>
  </div>`;
}

/* ---------- Ajustes ---------- */
function Ajustes({ e, yo, cerrar }) {
  const [nom, setNom] = useState(N.nombre(e, yo));
  const lunes = lunesHoy();
  const [m, setM] = useState(() => { const x = N.metasDe(e, lunes); return { domicilio: String(x.domicilio), salir: String(x.salir), minimo: String(x.minimo) }; });
  const [salud, setSalud] = useState(null);
  useEffect(() => { fetch('/api/salud').then((r) => r.json()).then(setSalud).catch(() => {}); }, []);
  const guardarMetas = () => {
    const v = { domicilio: Number(m.domicilio), salir: Number(m.salir), minimo: Number(m.minimo) };
    if (hacer({ tipo: 'metas.desde', desde: lunes, ...v })) mensaje('Metas guardadas desde esta semana');
  };
  const casilla = (k, txt) => html`<label>${txt}<input type="number" inputmode="numeric" min="0" max=${N.MAX_META} value=${m[k]} onInput=${(ev) => setM({ ...m, [k]: ev.target.value })} /></label>`;
  return html`<${Hoja} titulo="Ajustes" cerrar=${cerrar}>
    <label>Tu nombre<input type="text" maxlength="24" value=${nom} onInput=${(ev) => setNom(ev.target.value)}
      onChange=${() => nom.trim() && nom.trim() !== N.nombre(e, yo) && hacer({ tipo: 'persona.renombrar', nombre: nom.trim() })} /></label>
    <h3>Metas de la semana</h3>
    <div class="fila-campo">${casilla('domicilio', '🛵 Domicilio')}${casilla('salir', '🍻 Salir')}${casilla('minimo', 'Mínimo c/u')}</div>
    <button class="boton suave" onClick=${guardarMetas}>Guardar metas desde esta semana</button>
    <p class="nota">Para desbloquear un premio, los puntos de los dos juntos tienen que llegar a su meta y cada uno a su mínimo. Las semanas pasadas conservan sus metas.</p>
    <h3>Avisos</h3>
    <${ActivarAvisos} />
    <${PrefsAvisos} e=${e} yo=${yo} />
    <h3>Copias</h3>
    <a class="boton suave" href="/api/copia" download>Descargar copia de seguridad</a>
    <p class="nota">El portátil guarda una copia cada noche (30 días) y una cada mes que no se borra.
      ${salud && salud.copia ? ` Última copia nocturna: ${salud.copia}.` : ''}${salud && salud.copiaError ? ' ⚠ La última copia falló.' : ''}</p>
    <h3>Estado</h3>
    <p class="nota">${S.conectado ? 'Conectado' : 'Sin conexión'}${S.cola.length ? ` · ${S.cola.length} cambios por enviar` : ' · todo enviado'}${salud ? ` · versión ${salud.version}` : ''}</p>
  </${Hoja}>`;
}

/* ---------- Alta: elegir quién eres ---------- */
function Alta({ personas }) {
  const libres = ['a', 'b'].filter((p) => !personas[p].ligada);
  const [noms, setNoms] = useState(() => Object.fromEntries(libres.map((p) => [p, personas[p].nombre || ''])));
  const nom = (p) => (noms[p] || '').trim() || (p === 'a' ? 'Persona 1' : 'Persona 2');
  return html`<main class="centro"><h1>¡Hola! 👋</h1><p>¿Quién eres? Solo se elige una vez: queda unido a tu cuenta de Tailscale.</p>
    ${libres.map((p) => html`<div class="tarjeta" key=${p}>
      <label>Nombre<input type="text" maxlength="24" value=${noms[p]} placeholder=${p === 'a' ? 'Persona 1' : 'Persona 2'} onInput=${(ev) => setNoms({ ...noms, [p]: ev.target.value })} /></label>
      <button class="boton" onClick=${() => hacer({ tipo: 'persona.reclamar', persona: p, nombre: nom(p) })}>Soy ${nom(p)}</button>
    </div>`)}
  </main>`;
}

/* ---------- App ---------- */
let numeroIcono = null;
/** Número de tareas que te quedan hoy en el icono de la app (si el móvil lo permite). */
function ponerNumeroIcono(n) {
  if (n === numeroIcono || !navigator.setAppBadge) return;
  numeroIcono = n;
  (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
const PESTANAS = [['hoy', '☀️', 'Hoy'], ['semana', '📅', 'Semana'], ['tareas', '📋', 'Tareas']];

function App() {
  const s = useAlmacen();
  const dia = useHoy();
  const [tab, setTab] = useGuardado('tareas.pestana', 'hoy');
  // Al tocar un aviso se abre «Hoy» (nueva ventana con ?hoy, o mensaje del service worker si ya estaba abierta)
  useEffect(() => {
    if (location.search.includes('hoy')) { setTab('hoy'); history.replaceState(null, '', '/'); }
    const alMensaje = (ev) => { if (ev.data && ev.data.ir === 'hoy') { setHoja(null); setTab('hoy'); scrollTo(0, 0); } };
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', alMensaje);
    return () => { if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', alMensaje); };
  }, []);
  const [lunes, setLunes] = useGuardado('tareas.semana', lunesHoy());
  const [hoja, setHoja] = useState(null); // { tipo, ... }
  const sv = s.servidor;
  const aviso = s.aviso && html`<div class=${'aviso ' + s.aviso.tipo} role="status">${s.aviso.texto}
    ${s.aviso.accion && html`<button onClick=${s.aviso.accion.fn}>${s.aviso.accion.texto}</button>`}
    <button class="icono" aria-label="Cerrar aviso" onClick=${cerrarAviso}>✕</button></div>`;

  if (!sv) return html`<main class="centro"><h1>Tareas de casa</h1><p>${s.conectado ? 'Cargando…' : 'Sin conexión con el portátil de casa. Comprueba que Tailscale está activo.'}</p></main>`;
  if (sv.modo === 'sin-identidad') return html`<main class="centro"><h1>Tareas de casa</h1><p>Abre la app a través de Tailscale, con tu cuenta, para ver vuestras tareas.</p></main>`;
  if (sv.modo === 'completo') return html`<main class="centro"><h1>Ya sois dos</h1><p>Esta app es para dos personas y ya están registradas.</p></main>`;
  if (sv.modo === 'alta') return html`${h(Alta, { personas: sv.personas })}${aviso}`;
  const e = s.estado, yo = sv.yo;
  if (!e) return html`<main class="centro"><p>Cargando…</p></main>`;
  ponerNumeroIcono(N.aparicionesSemana(e, N.lunesDe(dia)).filter((a) => N.leToca(a, yo) && a.fecha <= dia && ['pendiente', 'atrasada'].includes(N.estadoAp(a, dia))).length);
  const abrir = (a) => setHoja({ tipo: 'aparicion', clave: a.clave });
  const lunesVista = tab === 'semana' ? lunes : N.lunesDe(dia);
  const nueva = (f) => setHoja({ tipo: 'tarea', lunesVista: N.lunesDe(f), fechaInicial: f });
  const fechaNueva = lunesVista === N.lunesDe(dia) ? dia : lunesVista;
  const pendientes = s.cola.length;

  return html`<div class="app">
    <header class="cab">
      <h1>Tareas de casa</h1>
      <span class=${'sinc' + (s.conectado ? '' : ' fuera')} title=${s.conectado ? 'Conectado' : 'Sin conexión'}>${s.conectado ? (pendientes ? `↑ ${pendientes}` : '') : `sin conexión${pendientes ? ' · ' + pendientes + ' por enviar' : ''}`}</span>
      <button class="yo" onClick=${() => setHoja({ tipo: 'ajustes' })} aria-label="Ajustes"><${Av} e=${e} q=${yo} /> ${N.nombre(e, yo)}</button>
    </header>
    <main>
      ${tab === 'hoy' && h(Hoy, { e, yo, dia, abrir })}
      ${tab === 'semana' && h(Semana, { e, yo, dia, lunes, setLunes, abrir, nueva })}
      ${tab === 'tareas' && h(Catalogo, { e, yo, dia, editar: (t) => setHoja({ tipo: 'tarea', tarea: t, lunesVista: N.lunesDe(dia), fechaInicial: dia }) })}
    </main>
    ${N.semanaAbierta(lunesVista, dia) && html`<button class="mas" aria-label="Nueva tarea" onClick=${() => nueva(fechaNueva)}>＋</button>`}
    <nav class="pestanas">${PESTANAS.map(([id, ico, nom]) => html`<button key=${id} class=${tab === id ? 'activa' : ''} aria-current=${tab === id ? 'page' : null}
      onClick=${() => { setTab(id); scrollTo(0, 0); }}><span aria-hidden="true">${ico}</span>${nom}</button>`)}</nav>
    ${hoja && hoja.tipo === 'aparicion' && h(HojaAparicion, { key: hoja.clave, e, yo, dia, clave: hoja.clave, cerrar: () => setHoja(null),
      editar: (t, l) => setHoja({ tipo: 'tarea', tarea: t, lunesVista: l, fechaInicial: l }) })}
    ${hoja && hoja.tipo === 'tarea' && h(HojaTarea, { e, yo, dia, tarea: hoja.tarea ? e.tareas[hoja.tarea.id] : null, lunesVista: hoja.lunesVista, fechaInicial: hoja.fechaInicial, cerrar: () => setHoja(null) })}
    ${hoja && hoja.tipo === 'ajustes' && h(Ajustes, { e, yo, cerrar: () => setHoja(null) })}
    ${aviso}
  </div>`;
}

render(h(App), document.getElementById('app'));
iniciar();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
