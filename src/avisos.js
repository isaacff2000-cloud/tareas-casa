// Avisos push: qué toca avisar, a quién y cuándo (funciones puras, se prueban con el reloj fijado),
// y el cartero que los apunta en la base y los envía. Cada minuto se mira qué toca; cada aviso tiene una
// clave única, así que nunca se repite (tampoco tras un reinicio). Si el portátil estaba apagado a la hora,
// un recordatorio ya pasado (más de 30 min) no se manda tarde. De 23:00 a 08:00 hay silencio: lo que llegue
// de noche (una devolución) espera a las 08:00.
import { aparicionesSemana, estadoAp, leToca, lunesDe, sumarDias, diaSemana, resumenSemana, nombre, prefsAvisos, guardada, partirClave } from './nucleo.js';
import { horaLocal } from './copias.js';
import { enviar } from './webpush.js';

export const SILENCIO = { desde: 23 * 60, hasta: 8 * 60 };
export const VENTANA = 30; // minutos durante los que un recordatorio aún se manda
const PUNTOS_A = { 5: 18 * 60, 7: 12 * 60 }; // viernes 18:00 y domingo 12:00
const MIN = 60_000;

const minutos = (h) => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
export const enSilencio = (m) => m >= SILENCIO.desde || m < SILENCIO.hasta;
const enVentana = (m, desde) => m >= desde && m < desde + VENTANA && !enSilencio(desde);
const PERSONAS = ['a', 'b'];

/** Lo que le queda hoy a p: lo de hoy y lo atrasado de la semana, sin hacer ni saltar. */
export function quedanHoy(e, p, dia) {
  return aparicionesSemana(e, lunesDe(dia)).filter((a) => leToca(a, p) && a.fecha <= dia && ['pendiente', 'atrasada'].includes(estadoAp(a, dia)));
}

function lista(aps, { conHora = false } = {}) {
  const txt = aps.map((a) => `${a.emoji} ${a.nombre}${conHora && a.hora ? ` (${a.hora})` : ''}`);
  return txt.length > 4 ? `${txt.slice(0, 3).join(', ')} y ${txt.length - 3} más` : txt.join(', ');
}
const tareas = (n) => `${n} ${n === 1 ? 'tarea' : 'tareas'}`;

/** Texto de «faltan puntos» para p, o null si están todos los premios desbloqueados. */
export function textoPuntos(e, p, r) {
  if (r.premios.every((x) => x.desbloqueado)) return null;
  const partes = [];
  const faltan = r.premios.filter((x) => x.faltan > 0).map((x) => `${x.faltan} para ${x.emoji} ${x.nombre.toLowerCase()}`);
  if (faltan.length) partes.push(`Os faltan ${faltan.join(' y ')}`);
  for (const q of PERSONAS) {
    const n = r.faltaMin[q];
    if (n > 0) partes.push(q === p ? `a ti, ${n} para tu mínimo` : `a ${nombre(e, q)}, ${n} para su mínimo`);
  }
  const t = partes.join('; ');
  return t.charAt(0).toUpperCase() + t.slice(1) + '.';
}

/**
 * Recordatorios que tocan en el minuto `t` ({ fecha, minutos } en hora de Madrid).
 * Devuelve [{ clave, persona, tipo, titulo, cuerpo, aparicion? }]. Mismo estado y misma hora → mismos avisos.
 */
export function recordatorios(e, t) {
  const out = [];
  const { fecha, minutos: m } = t;
  const lunes = lunesDe(fecha);
  const semana = aparicionesSemana(e, lunes);
  for (const p of PERSONAS) {
    if (!e.personas[p] || !e.personas[p].ligada) continue;
    const pr = prefsAvisos(e, p);
    if (pr.hoy && enVentana(m, minutos(pr.horaHoy))) {
      const q = quedanHoy(e, p, fecha);
      if (q.length) out.push({ clave: `hoy|${p}|${fecha}`, persona: p, tipo: 'hoy', titulo: `Te ${q.length === 1 ? 'queda' : 'quedan'} ${tareas(q.length)} de hoy`, cuerpo: lista(q) });
    }
    if (pr.conHora) {
      for (const a of semana) {
        if (a.fecha !== fecha || !a.hora || !leToca(a, p) || estadoAp(a, fecha) !== 'pendiente') continue;
        if (!enVentana(m, minutos(a.hora) + pr.retraso)) continue;
        out.push({ clave: `hora|${p}|${a.clave}`, persona: p, tipo: 'hora', aparicion: a.clave, titulo: `${a.emoji} ${a.nombre}`,
          cuerpo: pr.retraso ? `Era a las ${a.hora} y sigue sin hacer.` : `Toca ahora (${a.hora}).` });
      }
    }
    const hp = PUNTOS_A[diaSemana(fecha)];
    if (pr.puntos && hp != null && enVentana(m, hp)) {
      const txt = textoPuntos(e, p, resumenSemana(e, lunes, fecha));
      if (txt) out.push({ clave: `puntos|${p}|${fecha}`, persona: p, tipo: 'puntos', titulo: 'Puntos de la semana', cuerpo: txt });
    }
    if (pr.manana && enVentana(m, minutos(pr.horaManana))) {
      const f = sumarDias(fecha, 1);
      const q = aparicionesSemana(e, lunesDe(f)).filter((a) => a.fecha === f && leToca(a, p) && !a.hecha && !a.saltada);
      if (q.length) out.push({ clave: `manana|${p}|${f}`, persona: p, tipo: 'manana', titulo: `Mañana: ${tareas(q.length)}`, cuerpo: lista(q, { conHora: true }) });
    }
  }
  return out;
}

/** Avisos por una devolución recién hecha (a quien la hizo, menos a quien la devuelve). */
export function avisosDevolucion(e, op) {
  const x = guardada(e, op.aparicion);
  if (!x || !x.devuelta || x.hecha) return [];
  const t = e.tareas[partirClave(op.aparicion).tarea];
  if (!t) return [];
  return x.devuelta.a.filter((q) => q !== op.por && prefsAvisos(e, q).devuelta).map((q) => ({
    clave: `devuelta|${q}|${op.id}`, persona: q, tipo: 'devuelta', aparicion: op.aparicion,
    titulo: `↩ ${nombre(e, op.por)} te ha devuelto «${t.nombre}»`,
    cuerpo: x.devuelta.nota ? `«${x.devuelta.nota}»` : 'Vuelve a estar pendiente.',
  }));
}

/** ¿Sigue haciendo falta este aviso justo antes de enviarlo? */
export function sigueHaciendoFalta(e, aviso, dia) {
  const pr = prefsAvisos(e, aviso.persona);
  const activo = { hoy: pr.hoy, hora: pr.conHora, puntos: pr.puntos, manana: pr.manana, devuelta: pr.devuelta }[aviso.tipo];
  if (!activo) return false;
  if (aviso.tipo === 'devuelta') { const x = guardada(e, aviso.aparicion); return !!(x && x.devuelta && !x.hecha); }
  if (aviso.tipo === 'hora') {
    const a = aparicionesSemana(e, lunesDe(partirClave(aviso.aparicion).fecha)).find((z) => z.clave === aviso.aparicion);
    return !!a && estadoAp(a, dia) === 'pendiente';
  }
  if (aviso.tipo === 'hoy') return quedanHoy(e, aviso.persona, dia).length > 0;
  return true;
}

/** Cuándo puede salir un aviso que nace ahora: ya, o a las 08:00 si es de noche. */
export function cuandoEnviar(ahora) {
  const m = horaLocal(ahora).minutos;
  if (!enSilencio(m)) return ahora;
  return new Date(ahora.getTime() + (((SILENCIO.hasta - m) + 1440) % 1440) * MIN - (ahora.getTime() % MIN));
}

export class Cartero {
  /** pedir: fetch (las pruebas ponen un servicio de avisos falso) · ahora: reloj (las pruebas lo fijan). */
  constructor({ base, claves, sujeto, log = console.log, pedir = fetch, ahora = () => new Date() }) {
    Object.assign(this, { base, claves, sujeto, log, pedir, ahora });
    this.ocupado = false;
    this.alCambio = (ev) => {
      if (ev.op && ev.op.tipo === 'aparicion.devolver') this.devolucion(ev.op).catch((err) => this.log('avisos: ' + err.message));
    };
  }
  get clavePublica() { return this.claves.publica; }

  iniciar(cadaMs = MIN) {
    this.base.avisos.on('cambio', this.alCambio);
    this.reloj = setInterval(() => this.revisar().catch((err) => this.log('avisos: ' + err.message)), cadaMs);
    this.reloj.unref();
    setTimeout(() => this.revisar().catch(() => {}), 10_000).unref();
  }
  parar() { clearInterval(this.reloj); this.base.avisos.off('cambio', this.alCambio); }

  /** Apunta lo que toque ahora y envía lo pendiente. */
  async revisar() {
    if (this.ocupado) return;
    this.ocupado = true;
    try {
      const ahora = this.ahora();
      const t = horaLocal(ahora);
      for (const r of recordatorios(this.base.e, t)) {
        this.base.encolarAviso({ ...r, desde: ahora.toISOString(), caduca: new Date(ahora.getTime() + VENTANA * MIN).toISOString() });
      }
      await this.despachar();
      if (t.minutos === 4 * 60) this.base.podarAvisos(new Date(ahora.getTime() - 90 * 1440 * MIN).toISOString());
    } finally { this.ocupado = false; }
  }

  async devolucion(op) {
    const desde = cuandoEnviar(this.ahora()).toISOString();
    for (const r of avisosDevolucion(this.base.e, op)) this.base.encolarAviso({ ...r, desde });
    if (!this.ocupado) { this.ocupado = true; try { await this.despachar(); } finally { this.ocupado = false; } }
  }

  async despachar() {
    const ahora = this.ahora();
    const dia = horaLocal(ahora).fecha, cuando = ahora.toISOString();
    for (const a of this.base.avisosPorEnviar(cuando)) {
      if (a.caduca && a.caduca < cuando) { this.base.marcarAviso(a.clave, 'caducado', cuando); continue; }
      if (!sigueHaciendoFalta(this.base.e, a, dia)) { this.base.marcarAviso(a.clave, 'ya no hacía falta', cuando); continue; }
      const r = await this.enviarA(a.persona, { titulo: a.titulo, cuerpo: a.cuerpo, tag: a.clave });
      this.base.marcarAviso(a.clave, r.dispositivos ? `${r.enviados} de ${r.dispositivos}` : 'sin aparatos', cuando);
    }
  }

  /** Envía a todos los aparatos de una persona. Devuelve { dispositivos, enviados }. */
  async enviarA(persona, datos) {
    const subs = this.base.suscripciones(persona);
    const pendientes = quedanHoy(this.base.e, persona, horaLocal(this.ahora()).fecha).length;
    let enviados = 0;
    for (const s of subs) {
      try {
        const codigo = await enviar(s, { ...datos, pendientes }, this.claves, { sujeto: this.sujeto, pedir: this.pedir, urgencia: 'normal' });
        if (codigo >= 200 && codigo < 300) { enviados++; this.base.okSuscripcion(s.endpoint); continue; }
        if (codigo === 404 || codigo === 410) { this.base.borrarSuscripcion(s.endpoint); this.log(`avisos: un aparato de ${persona} ya no existe (${codigo}); se olvida`); continue; }
        this.base.falloSuscripcion(s.endpoint);
        this.log(`avisos: el servicio de avisos respondió ${codigo}`);
      } catch (err) {
        this.base.falloSuscripcion(s.endpoint);
        this.log(`avisos: no se pudo enviar (${err.message})`);
      }
      if (s.fallos + 1 >= 20) { this.base.borrarSuscripcion(s.endpoint); this.log(`avisos: un aparato de ${persona} falla siempre; se olvida`); }
    }
    return { dispositivos: subs.length, enviados };
  }
}
