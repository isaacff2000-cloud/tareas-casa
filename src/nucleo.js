// Reglas de la app, sin dependencias: las usan el servidor y el móvil (este mismo archivo).
// El estado es el resultado de aplicar en orden la lista de operaciones guardadas.
// Las tareas que se repiten no se guardan día a día: se guarda su regla y las apariciones de cada
// semana se calculan; solo se guarda lo que le pasa a una aparición concreta (hecha, movida, saltada…).

/* ---------- Fechas: días "AAAA-MM-DD"; una semana se nombra por su lunes ---------- */
export const RE_FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
const pad = (n) => String(n).padStart(2, '0');
export const clave = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const hoy = (d = new Date()) => clave(d);
/** Mediodía del día: así el cambio de hora de marzo y octubre no mueve la fecha. */
export function aFecha(k) { const [a, m, d] = k.split('-').map(Number); return new Date(a, m - 1, d, 12); }
export function sumarDias(k, n) { const d = aFecha(k); d.setDate(d.getDate() + n); return clave(d); }
export const diaSemana = (k) => ((aFecha(k).getDay() + 6) % 7) + 1; // 1 = lunes … 7 = domingo
export const lunesDe = (k) => sumarDias(k, 1 - diaSemana(k));
export const domingoDe = (k) => sumarDias(lunesDe(k), 6);
export const diasEntre = (a, b) => Math.round((aFecha(b) - aFecha(a)) / 864e5);
export const semanasEntre = (a, b) => Math.round(diasEntre(a, b) / 7);
export const diasDelMes = (k) => { const [a, m] = k.split('-').map(Number); return new Date(a, m, 0).getDate(); };
export const diasDeSemana = (lunes) => Array.from({ length: 7 }, (_, i) => sumarDias(lunes, i));
export function fechaValida(f) {
  return typeof f === 'string' && RE_FECHA.test(f) && Number(f.slice(8, 10)) <= diasDelMes(f);
}
export const esLunes = (k) => fechaValida(k) && diaSemana(k) === 1;

export const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
export const DIAS_CORTOS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "23–29 nov" · "30 nov – 6 dic" */
export function etiquetaSemana(lunes) {
  const a = aFecha(lunes), b = aFecha(sumarDias(lunes, 6));
  if (a.getMonth() === b.getMonth()) return `${a.getDate()}–${b.getDate()} ${MESES[b.getMonth()]}`;
  return `${a.getDate()} ${MESES[a.getMonth()]} – ${b.getDate()} ${MESES[b.getMonth()]}`;
}
/** "lunes 23" */
export const etiquetaDia = (k) => `${DIAS[diaSemana(k) - 1]} ${aFecha(k).getDate()}`;
export const etiquetaDiaLarga = (k) => `${etiquetaDia(k)} de ${aFecha(k).toLocaleDateString('es-ES', { month: 'long' })}`;

/**
 * Una semana se puede corregir (marcar, devolver, cambiar) hasta el martes siguiente a las 23:59:
 * así no se pierde lo que un móvil sin cobertura apuntó el domingo por la noche.
 */
export const semanaAbierta = (lunes, dia) => dia <= sumarDias(lunes, 8);
export const semanaTerminada = (lunes, dia) => dia > sumarDias(lunes, 6);

/* ---------- Estado ---------- */
export const PERSONAS = ['a', 'b'];
export const QUIEN = ['a', 'b', 'cualquiera', 'ambos'];
export const PREMIOS = [
  { id: 'domicilio', nombre: 'Pedir a domicilio', emoji: '🛵' },
  { id: 'salir', nombre: 'Salir', emoji: '🍻' },
];
export const METAS_INICIALES = { domicilio: 20, salir: 30, minimo: 8 };
export const PUNTOS_SUGERIDOS = [1, 2, 3, 5, 8];
export const MAX_PUNTOS = 20;
export const MAX_META = 500;

export function estadoVacio() {
  return {
    personas: { a: { nombre: null, ligada: false }, b: { nombre: null, ligada: false } },
    logins: { a: null, b: null },  // solo en el servidor (publico() lo quita)
    metas: {},                      // '<lunes>' → { domicilio, salir, minimo }: vale desde esa semana
    tareas: {},                     // id → { id, nombre, emoji, inicio, hasta, versiones: { '<lunes>': version } }
    apariciones: {},                // '<lunes>' → { '<tarea>|<fecha original>': { fecha?, hora?, quien?, saltada?, hecha?, devuelta? } }
  };
}
/**
 * Lo que puede ver el móvil: todo menos las cuentas de Tailscale. Con `desde` (un lunes), solo las apariciones
 * de esa semana en adelante, para que la copia del móvil no crezca sin fin con los años.
 */
export function publico(e, desde = null) {
  const { logins: _l, apariciones, ...resto } = e;
  const r = structuredClone(resto);
  r.apariciones = {};
  for (const l in apariciones) if (!desde || l >= desde) r.apariciones[l] = structuredClone(apariciones[l]);
  return r;
}

/* ---------- Operaciones ---------- */
export class ErrorOp extends Error {}
const exigir = (cond, msg) => { if (!cond) throw new ErrorOp(msg); };
const RE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const textoOk = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= max;
const emojiOk = (s) => s == null || (typeof s === 'string' && s.length <= 16);
const esPersona = (p) => p === 'a' || p === 'b';
const deUno = (o) => exigir(esPersona(o.por) || o.por === 'sistema', 'Antes de cambiar nada, di quién eres');
const enteroEntre = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

export const claveAparicion = (tarea, fecha) => `${tarea}|${fecha}`;
export function partirClave(k) {
  const i = String(k).lastIndexOf('|');
  return i < 0 ? { tarea: null, fecha: null } : { tarea: k.slice(0, i), fecha: k.slice(i + 1) };
}

/** Comprueba la regla de repetición; devuelve una copia limpia. */
function limpiarRep(r) {
  exigir(r && typeof r === 'object', 'Falta cuándo se hace');
  if (r.tipo === 'una') {
    exigir(fechaValida(r.fecha), 'Fecha no válida');
    return { tipo: 'una', fecha: r.fecha };
  }
  if (r.tipo === 'semanal') {
    exigir(Array.isArray(r.dias) && r.dias.length >= 1 && r.dias.length <= 7 && r.dias.every((d) => enteroEntre(d, 1, 7)) && new Set(r.dias).size === r.dias.length, 'Elige al menos un día de la semana');
    exigir(enteroEntre(r.cada ?? 1, 1, 12), 'Cada cuántas semanas: de 1 a 12');
    exigir(esLunes(r.ancla), 'Falta la semana de referencia');
    return { tipo: 'semanal', dias: [...r.dias].sort((x, y) => x - y), cada: r.cada ?? 1, ancla: r.ancla };
  }
  if (r.tipo === 'mensual') {
    if (r.diaSemana != null) {
      exigir(enteroEntre(r.diaSemana, 1, 7) && (r.orden === 'ultimo' || enteroEntre(r.orden, 1, 4)), 'Elige qué día del mes');
      return { tipo: 'mensual', orden: r.orden, diaSemana: r.diaSemana };
    }
    exigir(r.dia === 'ultimo' || enteroEntre(r.dia, 1, 31), 'Elige qué día del mes');
    return { tipo: 'mensual', dia: r.dia };
  }
  throw new ErrorOp('Repetición no válida');
}
function limpiarVersion(v) {
  exigir(v && typeof v === 'object', 'Faltan los datos de la tarea');
  exigir(enteroEntre(v.puntos, 1, MAX_PUNTOS), `Los puntos van de 1 a ${MAX_PUNTOS}`);
  exigir(QUIEN.includes(v.quien), 'Falta a quién le toca');
  exigir(v.hora == null || RE_HORA.test(v.hora), 'Hora no válida');
  return { puntos: v.puntos, quien: v.quien, hora: v.hora || null, rep: limpiarRep(v.rep) };
}
/** Contexto de tiempo de validar(): { dia: 'AAAA-MM-DD' } (por defecto, hoy en este aparato). */
const diaDe = (t) => (t && t.dia) || hoy();
function abierta(lunes, t) { exigir(semanaAbierta(lunes, diaDe(t)), 'Esa semana ya está cerrada'); }

/** La aparición existe esa semana (o ya estaba hecha) y su semana sigue abierta. */
function aparicionOk(e, k, t) {
  exigir(typeof k === 'string' && k.length <= 80, 'Tarea no válida');
  const { tarea, fecha } = partirClave(k);
  exigir(e.tareas[tarea] && fechaValida(fecha), 'Esa tarea no existe');
  const lunes = lunesDe(fecha);
  abierta(lunes, t);
  const a = aparicionesSemana(e, lunes).find((x) => x.clave === k);
  exigir(a, 'Esa tarea no toca esa semana');
  return a;
}
const lunesDeClave = (k) => lunesDe(partirClave(k).fecha);
/** Lo guardado de una aparición (o undefined). */
export const guardada = (e, k) => { const s = e.apariciones[lunesDeClave(k)]; return s ? s[k] : undefined; };
function ap(e, k) {
  const l = lunesDeClave(k);
  const s = e.apariciones[l] || (e.apariciones[l] = {});
  return s[k] || (s[k] = {});
}

const OPS = {
  'persona.reclamar': {
    validar(e, o) {
      exigir(esPersona(o.persona), 'Persona no válida');
      exigir(!o.por, 'Ya estás dado de alta');
      exigir(!e.personas[o.persona].ligada, 'Ese hueco ya lo ha elegido otra persona');
      exigir(textoOk(o.nombre, 24), 'Escribe tu nombre (máximo 24 letras)');
    },
    aplicar(e, o) {
      e.personas[o.persona] = { nombre: o.nombre.trim(), ligada: true };
      if (o.login) e.logins[o.persona] = String(o.login).toLowerCase();
    },
  },
  'persona.renombrar': {
    validar(e, o) { exigir(esPersona(o.por), 'Antes de cambiar nada, di quién eres'); exigir(textoOk(o.nombre, 24), 'Escribe tu nombre (máximo 24 letras)'); },
    aplicar(e, o) { if (e.personas[o.por]) e.personas[o.por].nombre = o.nombre.trim(); },
  },
  // Solo desde el portátil (cli.js): nombre inicial y deshacer la unión con una cuenta.
  'persona.nombrar': {
    validar(e, o) { exigir(o.por === 'sistema', 'Solo desde el servidor'); exigir(esPersona(o.persona) && textoOk(o.nombre, 24), 'Nombre no válido'); },
    aplicar(e, o) { e.personas[o.persona].nombre = o.nombre.trim(); },
  },
  'persona.desligar': {
    validar(e, o) { exigir(o.por === 'sistema', 'Solo desde el servidor'); exigir(esPersona(o.persona), 'Persona no válida'); },
    aplicar(e, o) { e.personas[o.persona].ligada = false; e.logins[o.persona] = null; },
  },

  'tarea.crear': {
    validar(e, o, t) {
      deUno(o);
      const x = o.tarea || {};
      exigir(RE_ID.test(x.id || ''), 'Identificador de tarea no válido');
      exigir(!e.tareas[x.id], 'Esa tarea ya existe');
      exigir(textoOk(x.nombre, 40), 'La tarea necesita un nombre (máximo 40 letras)');
      exigir(emojiOk(x.emoji), 'Emoji no válido');
      const v = limpiarVersion(o.version);
      exigir(fechaValida(o.inicio), 'Falta desde qué día existe');
      if (v.rep.tipo === 'una') abierta(lunesDe(v.rep.fecha), t);
      else abierta(lunesDe(o.inicio), t);
    },
    aplicar(e, o) {
      const v = limpiarVersion(o.version), x = o.tarea;
      const desde = v.rep.tipo === 'una' ? lunesDe(v.rep.fecha) : lunesDe(o.inicio);
      e.tareas[x.id] = { id: x.id, nombre: x.nombre.trim(), emoji: (x.emoji || '').trim() || '🧹', inicio: v.rep.tipo === 'una' ? null : o.inicio, hasta: null, versiones: { [desde]: v } };
    },
  },
  'tarea.renombrar': {
    validar(e, o) {
      deUno(o);
      exigir(e.tareas[o.tarea], 'Esa tarea no existe');
      exigir(textoOk(o.nombre, 40), 'La tarea necesita un nombre (máximo 40 letras)');
      exigir(emojiOk(o.emoji), 'Emoji no válido');
    },
    aplicar(e, o) { const x = e.tareas[o.tarea]; if (x) { x.nombre = o.nombre.trim(); if (o.emoji != null) x.emoji = o.emoji.trim() || x.emoji; } },
  },
  // Nueva forma de la tarea (días, persona, hora, puntos, frecuencia) desde una semana en adelante.
  'tarea.cambiar': {
    validar(e, o, t) {
      deUno(o);
      const x = e.tareas[o.tarea];
      exigir(x, 'Esa tarea no existe');
      const v = limpiarVersion(o.version);
      const antes = versionVigente(x, o.desde);
      if (v.rep.tipo === 'una' || (antes && antes.rep.tipo === 'una')) {
        exigir(v.rep.tipo === 'una' && antes && antes.rep.tipo === 'una', 'Una tarea de un solo día no se puede convertir en repetida (crea otra)');
        const vieja = guardada(e, claveAparicion(x.id, antes.rep.fecha));
        exigir(!(vieja && vieja.hecha) || vieja && antes.rep.fecha === v.rep.fecha, 'Ya está hecha: desmárcala antes de cambiarle el día');
        abierta(lunesDe(antes.rep.fecha), t);
        abierta(lunesDe(v.rep.fecha), t);
      } else {
        exigir(esLunes(o.desde), 'Semana no válida');
        abierta(o.desde, t);
        exigir(!x.hasta || o.desde < x.hasta, 'Esa tarea está quitada desde antes');
      }
    },
    aplicar(e, o) {
      const x = e.tareas[o.tarea];
      if (!x) return;
      const v = limpiarVersion(o.version);
      if (v.rep.tipo === 'una') {
        const antes = Object.values(x.versiones)[0];
        if (antes && antes.rep.fecha !== v.rep.fecha) {
          const k = claveAparicion(x.id, antes.rep.fecha), a = guardada(e, k);
          if (a && !a.hecha) delete e.apariciones[lunesDeClave(k)][k];
        }
        x.versiones = { [lunesDe(v.rep.fecha)]: v };
        return;
      }
      // «Desde esta semana en adelante»: lo que hubiera planeado para más tarde se sustituye
      for (const k of Object.keys(x.versiones)) if (k > o.desde) delete x.versiones[k];
      x.versiones[o.desde] = v;
    },
  },
  'tarea.archivar': {
    validar(e, o, t) { deUno(o); exigir(e.tareas[o.tarea], 'Esa tarea no existe'); exigir(esLunes(o.desde), 'Semana no válida'); abierta(o.desde, t); },
    aplicar(e, o) { if (e.tareas[o.tarea]) e.tareas[o.tarea].hasta = o.desde; },
  },
  'tarea.recuperar': {
    validar(e, o) { deUno(o); exigir(e.tareas[o.tarea], 'Esa tarea no existe'); },
    aplicar(e, o) { if (e.tareas[o.tarea]) e.tareas[o.tarea].hasta = null; },
  },

  'aparicion.hecha': {
    validar(e, o, t) {
      deUno(o);
      const a = aparicionOk(e, o.aparicion, t);
      exigir(!a.saltada, 'Esa tarea está saltada esta semana');
      exigir(Array.isArray(o.hechaPor) && o.hechaPor.length >= 1 && o.hechaPor.length <= 2 && o.hechaPor.every(esPersona) && new Set(o.hechaPor).size === o.hechaPor.length, 'Falta quién la ha hecho');
      // Solo con fecha de su semana (también por adelantado), nunca después del domingo
      exigir(fechaValida(o.dia) && lunesDe(o.dia) === a.lunes, 'Solo se puede marcar dentro de su semana');
      exigir(o.dia <= sumarDias(diaDe(t), 1), 'Fecha del móvil adelantada');
    },
    aplicar(e, o) {
      const x = guardada(e, o.aparicion);
      if (x && x.hecha) return; // si los dos la marcan a la vez, vale la primera
      const a = aparicionesSemana(e, lunesDe(partirClave(o.aparicion).fecha)).find((z) => z.clave === o.aparicion);
      if (!a) return;
      ap(e, o.aparicion).hecha = { por: [...o.hechaPor].sort(), puntos: a.puntos, dia: o.dia, marco: o.por, ts: o.ts || null };
    },
  },
  // Quien la marcó se equivocó: vuelve a pendiente sin dejar rastro.
  'aparicion.deshacer': {
    validar(e, o, t) {
      deUno(o);
      aparicionOk(e, o.aparicion, t);
      const x = guardada(e, o.aparicion);
      exigir(x && x.hecha, 'Esa tarea no está hecha');
    },
    aplicar(e, o) { const x = guardada(e, o.aparicion); if (x) delete x.hecha; },
  },
  // El otro no la da por buena: vuelve a pendiente con una nota y se quitan los puntos.
  'aparicion.devolver': {
    validar(e, o, t) {
      deUno(o);
      aparicionOk(e, o.aparicion, t);
      const x = guardada(e, o.aparicion);
      exigir(x && x.hecha, 'Esa tarea no está hecha');
      exigir(o.nota == null || (typeof o.nota === 'string' && o.nota.length <= 120), 'La nota es demasiado larga (máximo 120)');
    },
    aplicar(e, o) {
      const x = guardada(e, o.aparicion);
      if (!x || !x.hecha) return;
      x.devuelta = { por: o.por, a: x.hecha.por, nota: (o.nota || '').trim(), ts: o.ts || null };
      delete x.hecha;
    },
  },
  // Solo esta vez: otro día (de la misma semana), otra hora u otra persona.
  'aparicion.cambiar': {
    validar(e, o, t) {
      deUno(o);
      const a = aparicionOk(e, o.aparicion, t);
      exigir(o.fecha !== undefined || o.hora !== undefined || o.quien !== undefined, 'No hay nada que cambiar');
      if (o.fecha !== undefined) exigir(fechaValida(o.fecha) && lunesDe(o.fecha) === a.lunes, 'Solo se puede mover a otro día de la misma semana');
      if (o.hora !== undefined) exigir(o.hora === null || RE_HORA.test(o.hora), 'Hora no válida');
      if (o.quien !== undefined) exigir(QUIEN.includes(o.quien), 'Persona no válida');
    },
    aplicar(e, o) {
      const x = ap(e, o.aparicion);
      for (const c of ['fecha', 'hora', 'quien']) if (o[c] !== undefined) x[c] = o[c];
    },
  },
  'aparicion.saltar': {
    validar(e, o, t) {
      deUno(o);
      aparicionOk(e, o.aparicion, t);
      const x = guardada(e, o.aparicion);
      exigir(!(x && x.hecha), 'Ya está hecha: desmárcala antes de saltarla');
    },
    aplicar(e, o) { const x = ap(e, o.aparicion); if (!x.hecha) x.saltada = true; },
  },
  'aparicion.restaurar': {
    validar(e, o, t) { deUno(o); aparicionOk(e, o.aparicion, t); },
    aplicar(e, o) {
      const x = guardada(e, o.aparicion);
      if (!x) return;
      for (const c of ['fecha', 'hora', 'quien', 'saltada']) delete x[c];
    },
  },

  'metas.desde': {
    validar(e, o, t) {
      deUno(o);
      exigir(esLunes(o.desde), 'Semana no válida');
      abierta(o.desde, t);
      for (const k of ['domicilio', 'salir']) exigir(enteroEntre(o[k], 0, MAX_META), `Las metas van de 0 a ${MAX_META}`);
      exigir(enteroEntre(o.minimo, 0, MAX_META), `El mínimo va de 0 a ${MAX_META}`);
    },
    aplicar(e, o) {
      for (const k of Object.keys(e.metas)) if (k > o.desde) delete e.metas[k];
      e.metas[o.desde] = { domicilio: o.domicilio, salir: o.salir, minimo: o.minimo };
    },
  },
};
export const TIPOS = Object.keys(OPS);

/** Lanza ErrorOp con un mensaje para la persona si la operación no se puede hacer. t = { dia } (hoy). */
export function validarOp(e, o, t) {
  const d = OPS[o && o.tipo];
  exigir(d, `Operación desconocida: ${o && o.tipo}`);
  d.validar(e, o, t);
}
/** Aplica una operación ya validada. Nunca debe romper al reproducir el historial. */
export function aplicarOp(e, o) {
  const d = OPS[o && o.tipo];
  if (d) d.aplicar(e, o);
}

/* ---------- Consultas ---------- */
export const nombre = (e, p) => (e.personas[p] && e.personas[p].nombre) || (p === 'a' ? 'Persona 1' : 'Persona 2');
export const inicial = (e, p) => nombre(e, p).slice(0, 1).toUpperCase();
export const otro = (p) => (p === 'a' ? 'b' : 'a');
export function nombreQuien(e, q) {
  if (q === 'cualquiera') return 'Cualquiera';
  if (q === 'ambos') return 'Los dos';
  return nombre(e, q);
}
/** Personas a las que les toca: 'a' → ['a'], 'ambos' o 'cualquiera' → ['a', 'b'] */
export const destinatarios = (q) => (esPersona(q) ? [q] : ['a', 'b']);

/** La versión de la tarea vigente en la semana `lunes` (null si aún no existía). */
export function versionVigente(t, lunes) {
  let k = null;
  for (const d in t.versiones) if (d <= lunes && (k === null || d > k)) k = d;
  if (k === null) {
    // Las de un solo día valen para su semana aunque se miren desde otra
    const v = Object.values(t.versiones)[0];
    return v && v.rep.tipo === 'una' ? v : null;
  }
  return t.versiones[k];
}
const versionUnica = (t) => { const v = Object.values(t.versiones)[0]; return v && v.rep.tipo === 'una' ? v : null; };

/** ¿Toca la regla `rep` el día `f`? (para las repetidas) */
export function tocaDia(rep, f, lunes) {
  const ds = diaSemana(f);
  if (rep.tipo === 'semanal') {
    if (!rep.dias.includes(ds)) return false;
    const n = semanasEntre(rep.ancla, lunes);
    return ((n % rep.cada) + rep.cada) % rep.cada === 0;
  }
  if (rep.tipo === 'mensual') {
    const dm = Number(f.slice(8, 10)), ult = diasDelMes(f);
    if (rep.diaSemana != null) {
      if (ds !== rep.diaSemana) return false;
      return rep.orden === 'ultimo' ? dm + 7 > ult : Math.ceil(dm / 7) === rep.orden;
    }
    if (rep.dia === 'ultimo') return dm === ult;
    return dm === Math.min(rep.dia, ult); // el 31 en meses de 30 días: el último
  }
  return false;
}

/** Texto de la frecuencia: "L, X y V", "cada 2 semanas: S", "el día 1 de cada mes"… */
export function textoRep(rep) {
  if (!rep) return '';
  if (rep.tipo === 'una') return 'un solo día';
  if (rep.tipo === 'semanal') {
    const d = rep.dias.length === 7 ? 'todos los días' : rep.dias.length === 5 && rep.dias.every((x) => x <= 5) ? 'de lunes a viernes' : lista(rep.dias.map((x) => DIAS[x - 1]));
    return rep.cada === 1 ? d : `cada ${rep.cada} semanas: ${d}`;
  }
  if (rep.diaSemana != null) return `${rep.orden === 'ultimo' ? 'el último' : ['', 'el primer', 'el segundo', 'el tercer', 'el cuarto'][rep.orden]} ${DIAS[rep.diaSemana - 1]} de cada mes`;
  return rep.dia === 'ultimo' ? 'el último día de cada mes' : `el día ${rep.dia} de cada mes`;
}
const lista = (xs) => (xs.length <= 1 ? xs.join('') : xs.slice(0, -1).join(', ') + ' y ' + xs[xs.length - 1]);

/**
 * Apariciones de una semana, ya con los cambios de «solo esta vez» y lo hecho.
 * Cada una: { clave, tarea, nombre, emoji, fechaOriginal, fecha, hora, quien, puntos, saltada, hecha, devuelta, lunes, cambiada }
 * Lo hecho nunca desaparece: si después se cambian los días de la tarea, la aparición hecha se sigue mostrando.
 */
export function aparicionesSemana(e, lunes) {
  const out = [];
  const visto = new Set();
  const dias = diasDeSemana(lunes);
  const semana = e.apariciones[lunes];
  const meter = (t, v, f) => {
    const k = claveAparicion(t.id, f);
    if (visto.has(k)) return;
    visto.add(k);
    const x = (semana && semana[k]) || {};
    out.push({
      clave: k, tarea: t.id, nombre: t.nombre, emoji: t.emoji, fechaOriginal: f, lunes,
      fecha: x.fecha || f, hora: x.hora !== undefined ? x.hora : v.hora, quien: x.quien || v.quien,
      puntos: x.hecha ? x.hecha.puntos : v.puntos, saltada: !!x.saltada, hecha: x.hecha || null, devuelta: x.devuelta || null,
      cambiada: x.fecha !== undefined || x.hora !== undefined || x.quien !== undefined, rep: v.rep,
    });
  };
  for (const t of Object.values(e.tareas)) {
    const u = versionUnica(t);
    if (u) {
      if (lunesDe(u.rep.fecha) === lunes && (!t.hasta || lunes < t.hasta)) meter(t, u, u.rep.fecha);
      continue;
    }
    if (t.hasta && lunes >= t.hasta) continue;
    const v = versionVigente(t, lunes);
    if (!v) continue;
    for (const f of dias) if ((!t.inicio || f >= t.inicio) && tocaDia(v.rep, f, lunes)) meter(t, v, f);
  }
  // Lo hecho que ya no sale por la regla (p. ej. se cambiaron los días después)
  for (const k in semana || {}) {
    if (!semana[k].hecha || visto.has(k)) continue;
    const { tarea, fecha } = partirClave(k);
    const t = e.tareas[tarea];
    if (t) meter(t, versionVigente(t, lunes) || Object.values(t.versiones)[0], fecha);
  }
  return out.sort(ordenAp);
}
const ordenAp = (x, y) => x.fecha.localeCompare(y.fecha) || (x.hora || '99').localeCompare(y.hora || '99') || x.nombre.localeCompare(y.nombre, 'es') || x.clave.localeCompare(y.clave);

/** Estado de una aparición el día `dia`: hecha · saltada · pendiente · atrasada · nohecha */
export function estadoAp(a, dia) {
  if (a.hecha) return 'hecha';
  if (a.saltada) return 'saltada';
  if (a.fecha >= dia) return 'pendiente';
  return semanaTerminada(a.lunes, dia) ? 'nohecha' : 'atrasada';
}
/** ¿Le toca a la persona p? (las de «cualquiera» y «los dos», a los dos) */
export const leToca = (a, p) => destinatarios(a.quien).includes(p);

export function metasDe(e, lunes) {
  let k = null;
  for (const d in e.metas) if (d <= lunes && (k === null || d > k)) k = d;
  return k === null ? { ...METAS_INICIALES } : { ...e.metas[k] };
}

/**
 * Resumen de la semana: puntos hechos (total y de cada uno), planificados, metas de esa semana y, por premio,
 * si está desbloqueado y qué falta. Una tarea hecha por los dos suma una vez al total y a cada uno su mínimo.
 */
export function resumenSemana(e, lunes, dia = hoy()) {
  const aps = aparicionesSemana(e, lunes);
  const metas = metasDe(e, lunes);
  const puntos = { total: 0, a: 0, b: 0 };
  let planificados = 0;
  for (const a of aps) {
    if (!a.saltada) planificados += a.puntos;
    if (a.hecha) {
      puntos.total += a.hecha.puntos;
      for (const p of a.hecha.por) puntos[p] += a.hecha.puntos;
    }
  }
  const faltaMin = { a: Math.max(0, metas.minimo - puntos.a), b: Math.max(0, metas.minimo - puntos.b) };
  const premios = PREMIOS.map((p) => {
    const meta = metas[p.id];
    const faltan = Math.max(0, meta - puntos.total);
    return { ...p, meta, faltan, desbloqueado: faltan === 0 && faltaMin.a === 0 && faltaMin.b === 0, alcanzable: planificados >= meta };
  });
  return { lunes, aps, metas, puntos, planificados, faltaMin, premios, terminada: semanaTerminada(lunes, dia), abierta: semanaAbierta(lunes, dia) };
}

/** Tareas que se repiten, para el catálogo: con su versión vigente en `lunes`. */
export function tareasRepetidas(e, lunes, { archivadas = false } = {}) {
  return Object.values(e.tareas)
    .filter((t) => !versionUnica(t) && (archivadas ? t.hasta && t.hasta <= lunes : !t.hasta || t.hasta > lunes))
    .map((t) => ({ ...t, v: versionVigente(t, lunes) || Object.values(t.versiones).sort()[0] }))
    .sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
}

/** Tareas típicas para empezar (puntos y frecuencia sugeridos). */
export const TIPICAS = [
  { nombre: 'Fregar los platos', emoji: '🍽️', puntos: 1, dias: [1, 2, 3, 4, 5, 6, 7] },
  { nombre: 'Hacer la cena', emoji: '🍳', puntos: 2, dias: [1, 2, 3, 4, 5] },
  { nombre: 'Sacar la basura', emoji: '🗑️', puntos: 1, dias: [1, 3, 5] },
  { nombre: 'Poner una lavadora', emoji: '🧺', puntos: 1, dias: [2, 6] },
  { nombre: 'Tender y recoger la ropa', emoji: '👕', puntos: 2, dias: [2, 6] },
  { nombre: 'Aspirar', emoji: '🧹', puntos: 3, dias: [6] },
  { nombre: 'Fregar el suelo', emoji: '🪣', puntos: 3, dias: [6] },
  { nombre: 'Limpiar el baño', emoji: '🚿', puntos: 5, dias: [6] },
  { nombre: 'Limpiar la cocina a fondo', emoji: '🧽', puntos: 5, dias: [7] },
  { nombre: 'Cambiar las sábanas', emoji: '🛏️', puntos: 3, dias: [7], cada: 2 },
  { nombre: 'Regar las plantas', emoji: '🪴', puntos: 1, dias: [3, 7] },
  { nombre: 'Planchar', emoji: '👔', puntos: 3, dias: [7] },
  { nombre: 'Limpiar la nevera', emoji: '🧊', puntos: 5, mensual: { orden: 1, diaSemana: 6 } },
];

/**
 * Próxima vez que toca cada tarea a partir de `dia` (sin contar lo ya hecho o saltado), mirando `semanas`
 * semanas hacia delante: { idTarea: fecha }.
 */
export function proximas(e, dia, semanas = 14) {
  const r = {};
  let lunes = lunesDe(dia);
  for (let i = 0; i < semanas; i++, lunes = sumarDias(lunes, 7)) {
    for (const a of aparicionesSemana(e, lunes)) {
      if (r[a.tarea] || a.hecha || a.saltada || a.fecha < dia) continue;
      r[a.tarea] = a.fecha;
    }
  }
  return r;
}

/** Puntos planificados de media en las próximas `semanas` semanas que tengan alguna tarea. */
export function mediaSemanal(e, dia, semanas = 4) {
  let lunes = lunesDe(dia), suma = 0, n = 0;
  for (let i = 0; i < semanas + 4 && n < semanas; i++, lunes = sumarDias(lunes, 7)) {
    const aps = aparicionesSemana(e, lunes).filter((a) => !a.saltada);
    if (!aps.length) continue;
    suma += aps.reduce((s, a) => s + a.puntos, 0);
    n++;
  }
  return n ? Math.round(suma / n) : 0;
}

/** Grupo del catálogo de una regla: 'semanal' (todas las semanas) · 'nsemanas' · 'mensual' · 'una' */
export const grupoRep = (rep) => (rep.tipo === 'semanal' ? (rep.cada === 1 ? 'semanal' : 'nsemanas') : rep.tipo);
