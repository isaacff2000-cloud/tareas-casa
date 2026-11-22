// Estado de la app en el móvil: copia local, cola de cambios sin enviar y sincronización en directo.
// Los cambios se aplican al momento con las mismas reglas que el servidor (nucleo.js).
import * as N from './nucleo.js';

const CLAVE_SERVIDOR = 'tareas.servidor', CLAVE_COLA = 'tareas.cola';
const oyentes = new Set();

export const S = {
  servidor: null,      // última respuesta de /api/estado: { seq, modo, yo, datos?, personas? }
  estado: null,        // lo que se pinta: datos del servidor + cambios pendientes
  cola: [],            // operaciones aún no confirmadas
  confirmadas: [],     // confirmadas pero quizá aún no incluidas en la copia del servidor ({ op, seq })
  conectado: navigator.onLine,
  enviando: false,
  aviso: null,         // { texto, tipo, accion?: { texto, fn } }
};

function leer(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }
function guardar(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio: se sigue en memoria */ } }

export function suscribir(fn) { oyentes.add(fn); return () => oyentes.delete(fn); }
function avisar() { for (const fn of oyentes) fn(S); }

function recomponer() {
  const sv = S.servidor;
  if (!sv || sv.modo !== 'ok' || !sv.datos) { S.estado = null; return; }
  const e = structuredClone(sv.datos);
  e.logins = { a: null, b: null };
  S.confirmadas = S.confirmadas.filter((c) => c.seq > sv.seq);
  for (const op of [...S.confirmadas.map((c) => c.op), ...S.cola]) {
    try { N.aplicarOp(e, { ...op, por: sv.yo }); } catch { /* el servidor decidirá */ }
  }
  S.estado = e;
}

/** fetch con tiempo máximo: una petición colgada (red móvil, portátil dormido) no bloquea la app. */
function pedir(url, opciones = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { ...opciones, signal: ctl.signal }).finally(() => clearTimeout(t));
}

let tAviso = null;
export function mensaje(texto, tipo = 'info', accion = null) {
  S.aviso = { texto, tipo, accion };
  avisar();
  clearTimeout(tAviso);
  tAviso = setTimeout(() => { S.aviso = null; avisar(); }, accion ? 7000 : 4000);
}
export function cerrarAviso() { clearTimeout(tAviso); S.aviso = null; avisar(); }

let pidiendo = null, otraVez = false;
export async function recargar() {
  if (pidiendo) { otraVez = true; return pidiendo; }
  pidiendo = (async () => {
    try {
      const sv = S.servidor;
      const cab = sv ? { 'If-None-Match': `"${sv.seq}-${sv.modo}-${sv.yo || ''}-${sv.desde || ''}"` } : {};
      const r = await pedir('/api/estado', { headers: cab, cache: 'no-store' });
      if (r.status === 304) { S.conectado = true; return; }
      if (!r.ok) throw new Error('El servidor respondió ' + r.status);
      S.servidor = await r.json();
      guardar(CLAVE_SERVIDOR, S.servidor);
      S.conectado = true;
      recomponer();
    } catch {
      S.conectado = false;
    } finally {
      pidiendo = null;
      avisar();
      if (otraVez) { otraVez = false; recargar(); }
    }
  })();
  return pidiendo;
}

let reintento = null;
async function vaciarCola() {
  if (S.enviando || !S.cola.length) return;
  S.enviando = true;
  avisar();
  const lote = S.cola.slice(0, 200);
  try {
    const r = await pedir('/api/ops', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ops: lote }) });
    if (r.status >= 500 || r.status === 0) throw new Error('El servidor respondió ' + r.status);
    const cuerpo = await r.json().catch(() => ({}));
    if (!r.ok) {
      // Rechazo del lote entero (p. ej. sin identidad): se descarta para no reintentar sin fin
      S.cola = S.cola.slice(lote.length);
      guardar(CLAVE_COLA, S.cola);
      mensaje(cuerpo.error || 'El servidor no aceptó los cambios', 'error');
    } else {
      const { resultados, seq } = cuerpo;
      const hechos = new Set(resultados.map((x) => x.id));
      const bien = new Set(resultados.filter((x) => x.ok).map((x) => x.id));
      for (const op of lote) if (bien.has(op.id)) S.confirmadas.push({ op, seq });
      S.cola = S.cola.filter((op) => !hechos.has(op.id));
      guardar(CLAVE_COLA, S.cola);
      const fallo = resultados.find((x) => !x.ok);
      if (fallo) mensaje(fallo.error, 'error');
    }
    S.conectado = true;
    await recargar();
  } catch {
    S.conectado = false;
    clearTimeout(reintento);
    reintento = setTimeout(vaciarCola, 5000);
  } finally {
    S.enviando = false;
    recomponer();
    avisar();
    if (S.cola.length && S.conectado) setTimeout(vaciarCola, 0);
  }
}

export const nuevoId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 24);

/**
 * Hace uno o varios cambios: se comprueban con las reglas, se ven al momento y se mandan al servidor
 * (o se guardan hasta que haya conexión). Devuelve false si alguno no es válido.
 * deshacer: { texto, ops } muestra un aviso con el botón «Deshacer».
 */
export function hacer(ops, { deshacer = null } = {}) {
  const lista = Array.isArray(ops) ? ops : [ops];
  const prueba = S.estado ? structuredClone(S.estado) : null;
  try {
    for (const op of lista) {
      const o = { ...op, por: S.servidor && S.servidor.yo };
      if (prueba) { N.validarOp(prueba, o, { dia: N.hoy() }); N.aplicarOp(prueba, o); }
    }
  } catch (e) {
    if (e instanceof N.ErrorOp) { mensaje(e.message, 'error'); return false; }
    throw e;
  }
  for (const op of lista) { op.id = op.id || nuevoId(); S.cola.push(op); }
  guardar(CLAVE_COLA, S.cola);
  recomponer();
  if (deshacer) mensaje(deshacer.texto, 'info', { texto: 'Deshacer', fn: () => { cerrarAviso(); hacer(deshacer.ops); } });
  avisar();
  vaciarCola();
  return true;
}

let fuente = null;
function escuchar() {
  if (fuente) fuente.close();
  fuente = new EventSource('/api/eventos');
  let t = null;
  const pedir = () => { clearTimeout(t); t = setTimeout(recargar, 200); };
  fuente.addEventListener('hola', (ev) => { S.conectado = true; const { seq } = JSON.parse(ev.data); if (!S.servidor || seq !== S.servidor.seq) pedir(); vaciarCola(); avisar(); });
  fuente.addEventListener('cambio', (ev) => { const { seq } = JSON.parse(ev.data); if (!S.servidor || seq > S.servidor.seq) pedir(); });
  fuente.onerror = () => { S.conectado = false; avisar(); };
}

export async function iniciar() {
  S.servidor = leer(CLAVE_SERVIDOR);
  S.cola = leer(CLAVE_COLA) || [];
  recomponer();
  avisar();
  await recargar();
  vaciarCola();
  escuchar();
  addEventListener('online', () => { recargar(); vaciarCola(); escuchar(); });
  addEventListener('offline', () => { S.conectado = false; avisar(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { recargar(); vaciarCola(); } });
}
