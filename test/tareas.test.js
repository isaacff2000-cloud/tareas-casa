import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import * as N from '../src/nucleo.js';
import { Base } from '../src/db.js';
import { crearServidor } from '../src/servidor.js';
import { hacerCopias, programar } from '../src/copias.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const SIS = { por: 'sistema' };
const tmp = () => mkdtempSync(join(tmpdir(), 'tareas-'));
const L = '2026-11-23'; // un lunes
const sem = (rep = {}) => ({ tipo: 'semanal', dias: [1], cada: 1, ancla: L, ...rep });
const ver = (x = {}) => ({ puntos: 2, quien: 'a', hora: null, rep: sem(), ...x });

/** Base con dos personas ligadas y el reloj fijado en `dia`. */
function baseLista(dia = '2026-11-25') {
  const reloj = { dia };
  const b = new Base(':memory:', { reloj: () => ({ dia: reloj.dia }) });
  b.reloj.fijar = (d) => { reloj.dia = d; };
  b.aplicar([{ tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }], { login: 'uno@x' });
  b.aplicar([{ tipo: 'persona.reclamar', persona: 'b', nombre: 'Dos' }], { login: 'dos@x' });
  return b;
}
function hacer(b, ops, por = 'a') {
  const r = b.aplicar(Array.isArray(ops) ? ops : [ops], { por });
  return r.length === 1 ? r[0] : r;
}
function ok(b, ops, por = 'a') {
  const r = [].concat(hacer(b, ops, por));
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
}
const crear = (id, version, { nombre = id, inicio = L } = {}) => ({ tipo: 'tarea.crear', tarea: { id, nombre, emoji: '🧹' }, inicio, version });
const fechas = (e, lunes, tarea) => N.aparicionesSemana(e, lunes).filter((a) => !tarea || a.tarea === tarea).map((a) => a.fecha);

test('fechas: lunes, días de la semana, etiquetas y cambio de hora', () => {
  assert.equal(N.diaSemana('2026-11-23'), 1);
  assert.equal(N.diaSemana('2026-11-29'), 7);
  assert.equal(N.lunesDe('2026-11-29'), '2026-11-23');
  assert.equal(N.lunesDe('2026-11-23'), '2026-11-23');
  assert.equal(N.lunesDe('2027-01-01'), '2026-12-28');
  assert.equal(N.etiquetaSemana('2026-11-23'), '23–29 nov');
  assert.equal(N.etiquetaSemana('2026-11-30'), '30 nov – 6 dic');
  assert.equal(N.etiquetaDia('2026-11-25'), 'miércoles 25');
  // Semanas con cambio de hora (29 mar y 25 oct de 2026): siguen teniendo 7 días
  assert.deepEqual(N.diasDeSemana('2026-03-23').at(-1), '2026-03-29');
  assert.equal(N.sumarDias('2026-03-29', 1), '2026-03-30');
  assert.equal(N.semanasEntre('2026-03-23', '2026-11-02'), 32);
  assert.equal(N.lunesDe('2026-10-25'), '2026-10-19');
  assert.ok(N.fechaValida('2028-02-29') && !N.fechaValida('2026-02-29') && !N.fechaValida('2026-13-01'));
  // Abierta hasta el martes siguiente; terminada desde el lunes siguiente
  assert.ok(N.semanaAbierta(L, '2026-12-01') && !N.semanaAbierta(L, '2026-12-02'));
  assert.ok(!N.semanaTerminada(L, '2026-11-29') && N.semanaTerminada(L, '2026-11-30'));
});

test('repeticiones: días de la semana, cada N semanas y mensuales', () => {
  const t = (rep, f, lunes = N.lunesDe(f)) => N.tocaDia(rep, f, lunes);
  const lxv = sem({ dias: [1, 3, 5] });
  assert.deepEqual(N.diasDeSemana(L).filter((f) => t(lxv, f)), ['2026-11-23', '2026-11-25', '2026-11-27']);
  const cada2 = sem({ dias: [6], cada: 2 });
  assert.ok(t(cada2, '2026-11-28') && !t(cada2, '2026-12-05') && t(cada2, '2026-12-12') && t(cada2, '2026-11-14'));
  // El 31 en un mes de 30 días: el último; «el último»
  assert.ok(t({ tipo: 'mensual', dia: 31 }, '2026-11-30') && t({ tipo: 'mensual', dia: 31 }, '2026-12-31') && !t({ tipo: 'mensual', dia: 31 }, '2026-12-30'));
  assert.ok(t({ tipo: 'mensual', dia: 'ultimo' }, '2026-02-28') && !t({ tipo: 'mensual', dia: 'ultimo' }, '2026-02-27'));
  // Primer sábado y último domingo
  const primerSab = { tipo: 'mensual', orden: 1, diaSemana: 6 }, ultDom = { tipo: 'mensual', orden: 'ultimo', diaSemana: 7 };
  assert.ok(t(primerSab, '2026-12-05') && !t(primerSab, '2026-12-12') && t(primerSab, '2026-11-07'));
  assert.ok(t(ultDom, '2026-11-29') && !t(ultDom, '2026-11-22') && t(ultDom, '2026-03-29'));
  assert.equal(N.textoRep(lxv), 'lunes, miércoles y viernes');
  assert.equal(N.textoRep(sem({ dias: [1, 2, 3, 4, 5] })), 'de lunes a viernes');
  assert.equal(N.textoRep(cada2), 'cada 2 semanas: sábado');
  assert.equal(N.textoRep(primerSab), 'el primer sábado de cada mes');
  assert.equal(N.textoRep({ tipo: 'mensual', dia: 1 }), 'el día 1 de cada mes');
});

test('tareas: apariciones por semana, inicio a mitad de semana y tareas de un día', () => {
  const b = baseLista();
  ok(b, [
    crear('fregar', ver({ rep: sem({ dias: [1, 3, 5] }) }), { inicio: '2026-11-25' }),
    crear('banyo', ver({ puntos: 5, quien: 'ambos', rep: sem({ dias: [6], cada: 2 }) })),
    crear('nevera', ver({ quien: 'cualquiera', rep: { tipo: 'mensual', orden: 1, diaSemana: 6 } })),
    crear('medico', ver({ hora: '17:30', rep: { tipo: 'una', fecha: '2026-11-26' } })),
  ]);
  assert.deepEqual(fechas(b.e, L, 'fregar'), ['2026-11-25', '2026-11-27']); // creada el miércoles: el lunes no cuenta
  assert.deepEqual(fechas(b.e, '2026-11-30', 'fregar'), ['2026-11-30', '2026-12-02', '2026-12-04']);
  assert.deepEqual(fechas(b.e, '2026-11-16'), []); // antes de existir
  assert.deepEqual(fechas(b.e, L, 'banyo'), ['2026-11-28']);
  assert.deepEqual(fechas(b.e, '2026-11-30', 'banyo'), []);
  assert.deepEqual(fechas(b.e, '2026-11-30', 'nevera'), ['2026-12-05']);
  assert.deepEqual(fechas(b.e, L, 'medico'), ['2026-11-26']);
  assert.deepEqual(fechas(b.e, '2026-11-30', 'medico'), []);
  // Orden: por día, con hora antes que sin hora
  const jueves = N.aparicionesSemana(b.e, L).filter((a) => a.fecha === '2026-11-26');
  assert.equal(jueves[0].tarea, 'medico');
  // Errores claros
  assert.match(hacer(b, crear('x', ver({ puntos: 0 }))).error, /puntos van de 1 a 20/);
  assert.match(hacer(b, crear('x', ver({ rep: sem({ dias: [] }) }))).error, /al menos un día/);
  assert.match(hacer(b, crear('x', ver({ quien: 'otro' }))).error, /a quién le toca/);
  assert.match(hacer(b, crear('x', ver({ hora: '25:00' }))).error, /Hora no válida/);
  assert.match(hacer(b, crear('fregar', ver())).error, /ya existe/);
  assert.match(hacer(b, crear('x', ver({ rep: { tipo: 'una', fecha: '2026-11-10' } }))).error, /cerrada/);
  assert.match(b.aplicar([crear('x', ver())], { por: null })[0].error, /di quién eres/);
});

test('puntos: meta conjunta, mínimo de cada uno, «los dos» y quien la hace', () => {
  const b = baseLista('2026-11-28');
  ok(b, [
    crear('t5', ver({ puntos: 5, rep: sem({ dias: [1, 2, 3, 4] }) })),           // 4 × 5 = 20, de Uno
    crear('t3', ver({ puntos: 3, quien: 'ambos', rep: sem({ dias: [6] }) })),
    crear('t8', ver({ puntos: 8, quien: 'cualquiera', rep: sem({ dias: [7] }) })),
  ]);
  let r = N.resumenSemana(b.e, L, '2026-11-28');
  assert.equal(r.planificados, 31);
  assert.deepEqual(r.metas, N.METAS_INICIALES);
  assert.deepEqual(r.premios.map((p) => [p.id, p.alcanzable]), [['domicilio', true], ['salir', true]]);
  const hecha = (k, hechaPor, dia = '2026-11-28', por = 'a') => ok(b, { tipo: 'aparicion.hecha', aparicion: k, hechaPor, dia }, por);
  for (const d of ['23', '24', '25', '26']) hecha(`t5|2026-11-${d}`, ['a']);
  r = N.resumenSemana(b.e, L, '2026-11-28');
  assert.deepEqual(r.puntos, { total: 20, a: 20, b: 0 });
  const dom = r.premios[0];
  assert.equal(dom.faltan, 0);
  assert.equal(dom.desbloqueado, false); // a Dos le falta su mínimo
  assert.deepEqual(r.faltaMin, { a: 0, b: 8 });
  // La de los dos: suma una vez al total y a cada uno
  hecha('t3|2026-11-28', ['a', 'b'], '2026-11-28', 'b');
  r = N.resumenSemana(b.e, L, '2026-11-28');
  assert.deepEqual(r.puntos, { total: 23, a: 23, b: 3 });
  assert.equal(r.premios[0].desbloqueado, false);
  // La de cualquiera, hecha por Dos aunque la marque Uno, por adelantado (el domingo, marcada el sábado)
  hecha('t8|2026-11-29', ['b'], '2026-11-28', 'a');
  r = N.resumenSemana(b.e, L, '2026-11-28');
  assert.deepEqual(r.puntos, { total: 31, a: 23, b: 11 });
  assert.deepEqual(r.premios.map((p) => [p.id, p.desbloqueado, p.faltan]), [['domicilio', true, 0], ['salir', true, 0]]);
  assert.equal(b.e.apariciones[L]['t8|2026-11-29'].hecha.marco, 'a');
  // Dos marca la misma a la vez: vale la primera
  ok(b, { tipo: 'aparicion.hecha', aparicion: 't8|2026-11-29', hechaPor: ['a'], dia: '2026-11-28' }, 'b');
  assert.deepEqual(b.e.apariciones[L]['t8|2026-11-29'].hecha.por, ['b']);
  // Dos devuelve una de Uno: se quitan los puntos y se vuelve a bloquear
  ok(b, { tipo: 'aparicion.devolver', aparicion: 't5|2026-11-23', nota: 'falta la encimera' }, 'b');
  r = N.resumenSemana(b.e, L, '2026-11-28');
  assert.equal(r.puntos.total, 26);
  assert.deepEqual(r.premios.map((p) => p.desbloqueado), [true, false]);
  const dev = r.aps.find((a) => a.clave === 't5|2026-11-23');
  assert.deepEqual([dev.hecha, dev.devuelta.nota, dev.devuelta.por, N.estadoAp(dev, '2026-11-28')], [null, 'falta la encimera', 'b', 'atrasada']);
  assert.match(hacer(b, { tipo: 'aparicion.devolver', aparicion: 't5|2026-11-23' }, 'b').error, /no está hecha/);
  // Deshacer
  ok(b, { tipo: 'aparicion.deshacer', aparicion: 't5|2026-11-24' });
  assert.equal(N.resumenSemana(b.e, L).puntos.total, 21);
  // Validaciones al marcar
  assert.match(hacer(b, { tipo: 'aparicion.hecha', aparicion: 't5|2026-11-24', hechaPor: [], dia: '2026-11-28' }).error, /quién la ha hecho/);
  assert.match(hacer(b, { tipo: 'aparicion.hecha', aparicion: 't5|2026-11-24', hechaPor: ['c'], dia: '2026-11-28' }).error, /quién la ha hecho/);
  assert.match(hacer(b, { tipo: 'aparicion.hecha', aparicion: 't5|2026-11-27', hechaPor: ['a'], dia: '2026-11-28' }).error, /no toca/);
  assert.match(hacer(b, { tipo: 'aparicion.hecha', aparicion: 'nada|2026-11-27', hechaPor: ['a'], dia: '2026-11-28' }).error, /no existe/);
  assert.match(hacer(b, { tipo: 'aparicion.hecha', aparicion: 't5|2026-11-24', hechaPor: ['a'], dia: '2026-11-30' }).error, /dentro de su semana/);
  b.reloj.fijar('2026-11-24');
  assert.match(hacer(b, { tipo: 'aparicion.hecha', aparicion: 't5|2026-11-24', hechaPor: ['a'], dia: '2026-11-27' }).error, /adelantada/);
});

test('cierre: se marca dentro de su semana y se corrige hasta el martes siguiente', () => {
  const b = baseLista('2026-11-29');
  ok(b, crear('t', ver({ rep: sem({ dias: [7] }) })));
  const k = 't|2026-11-29';
  // Lunes siguiente: llega lo marcado el domingo sin cobertura → vale; marcar con fecha del lunes, no
  b.reloj.fijar('2026-11-30');
  assert.equal(N.estadoAp(N.aparicionesSemana(b.e, L)[0], '2026-11-30'), 'nohecha');
  assert.match(hacer(b, { tipo: 'aparicion.hecha', aparicion: k, hechaPor: ['a'], dia: '2026-11-30' }).error, /dentro de su semana/);
  ok(b, { tipo: 'aparicion.hecha', aparicion: k, hechaPor: ['a'], dia: '2026-11-29' });
  b.reloj.fijar('2026-12-01');
  ok(b, { tipo: 'aparicion.devolver', aparicion: k }, 'b');
  b.reloj.fijar('2026-12-02');
  assert.match(hacer(b, { tipo: 'aparicion.hecha', aparicion: k, hechaPor: ['a'], dia: '2026-11-29' }).error, /cerrada/);
  assert.match(hacer(b, { tipo: 'metas.desde', desde: L, domicilio: 1, salir: 1, minimo: 0 }).error, /cerrada/);
  // Lo no hecho: 0 puntos, sin restar
  assert.equal(N.resumenSemana(b.e, L, '2026-12-02').puntos.total, 0);
  assert.equal(N.resumenSemana(b.e, L, '2026-12-02').abierta, false);
});

test('solo esta vez: mover, otra hora, otra persona, saltar y restaurar', () => {
  const b = baseLista('2026-11-24');
  ok(b, crear('t', ver({ hora: '10:00', rep: sem({ dias: [1, 4] }) })));
  const k = 't|2026-11-26';
  ok(b, { tipo: 'aparicion.cambiar', aparicion: k, fecha: '2026-11-29', hora: null, quien: 'b' });
  let a = N.aparicionesSemana(b.e, L).find((x) => x.clave === k);
  assert.deepEqual([a.fecha, a.hora, a.quien, a.cambiada, a.fechaOriginal], ['2026-11-29', null, 'b', true, '2026-11-26']);
  assert.ok(N.leToca(a, 'b') && !N.leToca(a, 'a'));
  // La semana siguiente sigue igual
  a = N.aparicionesSemana(b.e, '2026-11-30').find((x) => x.fecha === '2026-12-03');
  assert.deepEqual([a.hora, a.quien, a.cambiada], ['10:00', 'a', false]);
  assert.match(hacer(b, { tipo: 'aparicion.cambiar', aparicion: k, fecha: '2026-11-30' }).error, /misma semana/);
  assert.match(hacer(b, { tipo: 'aparicion.cambiar', aparicion: k }).error, /nada que cambiar/);
  ok(b, { tipo: 'aparicion.saltar', aparicion: 't|2026-11-23' });
  let r = N.resumenSemana(b.e, L, '2026-11-24');
  assert.equal(r.planificados, 2);
  assert.equal(N.estadoAp(r.aps.find((x) => x.clave === 't|2026-11-23'), '2026-11-24'), 'saltada');
  assert.match(hacer(b, { tipo: 'aparicion.hecha', aparicion: 't|2026-11-23', hechaPor: ['a'], dia: '2026-11-24' }).error, /saltada/);
  ok(b, [{ tipo: 'aparicion.restaurar', aparicion: 't|2026-11-23' }, { tipo: 'aparicion.restaurar', aparicion: k }]);
  r = N.resumenSemana(b.e, L, '2026-11-24');
  assert.equal(r.planificados, 4);
  assert.deepEqual(r.aps.map((x) => [x.fecha, x.hora, x.cambiada]), [['2026-11-23', '10:00', false], ['2026-11-26', '10:00', false]]);
  ok(b, { tipo: 'aparicion.hecha', aparicion: k, hechaPor: ['a'], dia: '2026-11-24' });
  assert.match(hacer(b, { tipo: 'aparicion.saltar', aparicion: k }).error, /desmárcala/);
});

test('cambiar desde una semana: lo anterior no cambia, los puntos hechos se congelan y lo hecho no desaparece', () => {
  const b = baseLista('2026-11-24');
  ok(b, crear('t', ver({ puntos: 2, rep: sem({ dias: [1, 2] }) }), { inicio: '2026-11-16' }));
  b.reloj.fijar('2026-11-17');
  ok(b, { tipo: 'aparicion.hecha', aparicion: 't|2026-11-17', hechaPor: ['a'], dia: '2026-11-17' });
  b.reloj.fijar('2026-11-24');
  ok(b, { tipo: 'aparicion.hecha', aparicion: 't|2026-11-24', hechaPor: ['b'], dia: '2026-11-24' });
  // Desde esta semana: solo los viernes y a 5 puntos
  ok(b, { tipo: 'tarea.cambiar', tarea: 't', desde: L, version: ver({ puntos: 5, rep: sem({ dias: [5] }) }) });
  assert.deepEqual(fechas(b.e, '2026-11-16'), ['2026-11-16', '2026-11-17']);
  const r = N.resumenSemana(b.e, L, '2026-11-24');
  assert.deepEqual(r.aps.map((a) => [a.fecha, a.puntos, !!a.hecha]), [['2026-11-24', 2, true], ['2026-11-27', 5, false]]); // el martes hecho sigue, con sus 2 puntos
  assert.equal(r.puntos.b, 2);
  // Un cambio planificado para más adelante se sustituye al cambiar desde antes
  ok(b, { tipo: 'tarea.cambiar', tarea: 't', desde: '2026-12-07', version: ver({ puntos: 1 }) });
  ok(b, { tipo: 'tarea.cambiar', tarea: 't', desde: '2026-11-30', version: ver({ puntos: 3 }) });
  assert.deepEqual(Object.keys(b.e.tareas.t.versiones).sort(), ['2026-11-16', L, '2026-11-30']);
  assert.match(hacer(b, { tipo: 'tarea.cambiar', tarea: 't', desde: '2026-11-25', version: ver() }).error, /Semana no válida/);
  assert.match(hacer(b, { tipo: 'tarea.cambiar', tarea: 't', desde: '2026-11-09', version: ver() }).error, /cerrada/);
  assert.match(hacer(b, { tipo: 'tarea.cambiar', tarea: 't', desde: L, version: ver({ rep: { tipo: 'una', fecha: '2026-11-25' } }) }).error, /un solo día/);
  // Renombrar cambia en todas las semanas
  ok(b, { tipo: 'tarea.renombrar', tarea: 't', nombre: 'Fregar', emoji: '🍽️' });
  assert.equal(N.aparicionesSemana(b.e, '2026-11-16')[0].nombre, 'Fregar');
  // Archivar desde la semana que viene y recuperar
  ok(b, { tipo: 'tarea.archivar', tarea: 't', desde: '2026-11-30' });
  assert.deepEqual(fechas(b.e, '2026-11-30'), []);
  assert.equal(fechas(b.e, L).length, 2);
  assert.equal(N.tareasRepetidas(b.e, '2026-11-30').length, 0);
  assert.equal(N.tareasRepetidas(b.e, '2026-11-30', { archivadas: true }).length, 1);
  ok(b, { tipo: 'tarea.recuperar', tarea: 't' });
  assert.deepEqual(fechas(b.e, '2026-11-30'), ['2026-11-30']);
});

test('tareas de un día: cambiar la fecha, y no si ya está hecha', () => {
  const b = baseLista('2026-11-24');
  ok(b, crear('u', ver({ rep: { tipo: 'una', fecha: '2026-11-25' } })));
  ok(b, { tipo: 'aparicion.cambiar', aparicion: 'u|2026-11-25', hora: '09:00' });
  ok(b, { tipo: 'tarea.cambiar', tarea: 'u', version: ver({ rep: { tipo: 'una', fecha: '2026-12-02' } }) });
  assert.deepEqual(fechas(b.e, L), []);
  assert.deepEqual(fechas(b.e, '2026-11-30'), ['2026-12-02']);
  assert.equal(b.e.apariciones[L]['u|2026-11-25'], undefined); // lo de «solo esta vez» de la fecha vieja se va
  b.reloj.fijar('2026-12-02');
  ok(b, { tipo: 'aparicion.hecha', aparicion: 'u|2026-12-02', hechaPor: ['a'], dia: '2026-12-02' });
  assert.match(hacer(b, { tipo: 'tarea.cambiar', tarea: 'u', version: ver({ rep: { tipo: 'una', fecha: '2026-12-03' } }) }).error, /desmárcala/);
  ok(b, { tipo: 'tarea.cambiar', tarea: 'u', version: ver({ puntos: 9, rep: { tipo: 'una', fecha: '2026-12-02' } }) });
  assert.equal(N.resumenSemana(b.e, '2026-11-30').puntos.total, 2); // congelados
  assert.match(hacer(b, { tipo: 'tarea.cambiar', tarea: 'u', version: ver({ rep: sem() }), desde: '2026-11-30' }).error, /un solo día/);
});

test('metas: valen desde una semana y las pasadas conservan las suyas', () => {
  const b = baseLista('2026-11-24');
  ok(b, { tipo: 'metas.desde', desde: L, domicilio: 10, salir: 15, minimo: 3 });
  ok(b, { tipo: 'metas.desde', desde: '2026-12-07', domicilio: 40, salir: 50, minimo: 5 });
  assert.deepEqual(N.metasDe(b.e, '2026-11-16'), N.METAS_INICIALES);
  assert.deepEqual(N.metasDe(b.e, '2026-11-30'), { domicilio: 10, salir: 15, minimo: 3 });
  assert.deepEqual(N.metasDe(b.e, '2027-01-04'), { domicilio: 40, salir: 50, minimo: 5 });
  ok(b, { tipo: 'metas.desde', desde: '2026-11-30', domicilio: 12, salir: 18, minimo: 4 }); // sustituye lo de más adelante
  assert.deepEqual(N.metasDe(b.e, '2027-01-04'), { domicilio: 12, salir: 18, minimo: 4 });
  assert.match(hacer(b, { tipo: 'metas.desde', desde: L, domicilio: -1, salir: 1, minimo: 0 }).error, /0 a 500/);
  const r = N.resumenSemana(b.e, L);
  assert.deepEqual(r.premios.map((p) => [p.meta, p.alcanzable]), [[10, false], [15, false]]);
});

test('operaciones: no se repiten y el historial se rehace igual (al azar)', () => {
  const dir = tmp(), ruta = join(dir, 'tareas.db');
  const reloj = { dia: '2026-11-23' };
  const b = new Base(ruta, { reloj: () => ({ dia: reloj.dia }) });
  b.aplicar([{ tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }], { login: 'uno@x' });
  b.aplicar([{ tipo: 'persona.reclamar', persona: 'b', nombre: 'Dos' }], { login: 'dos@x' });
  let semilla = 7;
  const azar = (n) => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; };
  let aceptadas = 0;
  for (let i = 0; i < 1500; i++) {
    reloj.dia = N.sumarDias('2026-11-23', Math.floor(i / 25));
    const lunes = N.lunesDe(reloj.dia), por = azar(2) ? 'a' : 'b';
    const ids = Object.keys(b.e.tareas);
    const aps = N.aparicionesSemana(b.e, lunes);
    const a = aps[azar(Math.max(1, aps.length))];
    const opciones = [
      () => crear('t' + i, ver({ puntos: 1 + azar(8), quien: N.QUIEN[azar(4)], rep: azar(4) ? sem({ dias: [1 + azar(7), 1 + azar(7)].filter((x, j, xs) => xs.indexOf(x) === j), cada: 1 + azar(3), ancla: lunes }) : { tipo: 'una', fecha: N.sumarDias(lunes, azar(7)) } }), { inicio: reloj.dia }),
      () => a && { tipo: 'aparicion.hecha', aparicion: a.clave, hechaPor: [['a'], ['b'], ['a', 'b']][azar(3)], dia: reloj.dia },
      () => a && { tipo: 'aparicion.hecha', aparicion: a.clave, hechaPor: ['a'], dia: reloj.dia },
      () => a && { tipo: azar(2) ? 'aparicion.devolver' : 'aparicion.deshacer', aparicion: a.clave, nota: 'x' },
      () => a && { tipo: 'aparicion.cambiar', aparicion: a.clave, fecha: N.sumarDias(lunes, azar(7)) },
      () => a && { tipo: azar(2) ? 'aparicion.saltar' : 'aparicion.restaurar', aparicion: a.clave },
      () => ids.length && { tipo: 'tarea.cambiar', tarea: ids[azar(ids.length)], desde: lunes, version: ver({ puntos: 1 + azar(5), rep: sem({ dias: [1 + azar(7)], ancla: lunes }) }) },
      () => ids.length && { tipo: 'tarea.archivar', tarea: ids[azar(ids.length)], desde: N.sumarDias(lunes, 7 * azar(3)) },
      () => ({ tipo: 'metas.desde', desde: lunes, domicilio: azar(30), salir: azar(40), minimo: azar(10) }),
    ];
    const op = opciones[azar(opciones.length)]();
    if (!op) continue;
    op.id = 'op' + i;
    const [r] = b.aplicar([op], { por });
    if (r.ok) aceptadas++;
    else assert.ok(!r.error.startsWith('Error interno'), r.error);
    if (r.ok && azar(10) === 0) assert.ok(b.aplicar([op], { por })[0].repetida); // la misma otra vez
  }
  assert.ok(aceptadas > 600, `aceptadas ${aceptadas}`);
  const antes = structuredClone(b.e);
  const seq = b.seq;
  b.cerrar();
  const otra = new Base(ruta);
  assert.equal(otra.seq, seq);
  assert.deepEqual(otra.e, antes);
  // El móvil, con las mismas reglas, llega al mismo sitio aplicando desde el principio
  otra.cerrar();
});

test('lo que recibe el móvil: sin cuentas de Tailscale y solo las semanas recientes', () => {
  const b = baseLista('2026-11-24');
  ok(b, crear('t', ver({ rep: sem({ dias: [2] }) }), { inicio: '2026-11-17' }));
  b.reloj.fijar('2026-11-17');
  ok(b, { tipo: 'aparicion.hecha', aparicion: 't|2026-11-17', hechaPor: ['a'], dia: '2026-11-17' });
  b.reloj.fijar('2026-11-24');
  ok(b, { tipo: 'aparicion.hecha', aparicion: 't|2026-11-24', hechaPor: ['a'], dia: '2026-11-24' });
  const p = N.publico(b.e, L);
  assert.equal(p.logins, undefined);
  assert.deepEqual(Object.keys(p.apariciones), [L]);
  assert.deepEqual(Object.keys(N.publico(b.e).apariciones).sort(), ['2026-11-16', L]);
  assert.ok(b.e.logins.a); // el original no se toca
});

/* ---------- Servidor ---------- */
function pedir(puerto, metodo, ruta, { cuerpo, cab = {} } = {}) {
  return new Promise((ok2, mal) => {
    const datos = cuerpo === undefined ? null : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    const req = request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta,
      headers: { ...(datos ? { 'Content-Type': 'application/json' } : {}), ...cab } }, (res) => {
      const trozos = [];
      res.on('data', (t) => trozos.push(t));
      res.on('end', () => { const s = Buffer.concat(trozos).toString(); let j = null; try { j = JSON.parse(s); } catch { /* */ } ok2({ codigo: res.statusCode, cab: res.headers, json: j, texto: s }); });
    });
    req.on('error', mal);
    if (datos) req.write(datos);
    req.end();
  });
}
async function arrancar(base, opciones = {}) {
  const dir = tmp();
  const s = crearServidor({ base, carpetaWeb: join(AQUI, '../web'), carpetaTmp: join(dir, 'tmp'), log: () => {}, ...opciones });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  return { s, puerto: s.address().port };
}
const TS = (login) => ({ 'tailscale-user-login': login });

test('servidor: identidad de Tailscale, alta, permisos y ETag', async () => {
  const base = new Base(':memory:', { reloj: () => ({ dia: '2026-11-24' }) });
  base.aplicar([{ tipo: 'persona.nombrar', persona: 'a', nombre: 'Uno' }], SIS);
  const { s, puerto } = await arrancar(base);
  try {
    let r = await pedir(puerto, 'GET', '/api/estado');
    assert.equal(r.json.modo, 'sin-identidad');
    assert.equal(r.json.datos, undefined);
    r = await pedir(puerto, 'GET', '/api/estado', { cab: { 'x-quien': 'uno@x' } }); // x-quien no vale fuera de pruebas
    assert.equal(r.json.modo, 'sin-identidad');
    r = await pedir(puerto, 'GET', '/api/estado', { cab: TS('uno@x') });
    assert.equal(r.json.modo, 'alta');
    assert.equal(r.json.personas.a.nombre, 'Uno');
    assert.equal(r.json.datos, undefined);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: [{ id: 'x1', tipo: 'tarea.recuperar', tarea: 't' }] } });
    assert.match(r.json.resultados[0].error, /elige quién eres/);
    r = await pedir(puerto, 'POST', '/api/ops', { cuerpo: { ops: [{ tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }] } });
    assert.equal(r.codigo, 403);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: [{ id: 'r1', tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }] } });
    assert.ok(r.json.resultados[0].ok);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('dos@x'), cuerpo: { ops: [{ id: 'r2', tipo: 'persona.reclamar', persona: 'a', nombre: 'Intruso' }] } });
    assert.match(r.json.resultados[0].error, /otra persona/);
    await pedir(puerto, 'POST', '/api/ops', { cab: TS('dos@x'), cuerpo: { ops: [{ id: 'r3', tipo: 'persona.reclamar', persona: 'b', nombre: 'Dos' }] } });
    r = await pedir(puerto, 'GET', '/api/estado', { cab: TS('tres@x') });
    assert.equal(r.json.modo, 'completo');
    r = await pedir(puerto, 'GET', '/api/estado', { cab: TS('UNO@X') });
    assert.equal(r.json.modo, 'ok');
    assert.equal(r.json.yo, 'a');
    assert.equal(r.json.desde, '2026-08-31');
    assert.equal(r.json.datos.logins, undefined);
    assert.equal(r.json.datos.personas.b.nombre, 'Dos');
    const etag = r.cab.etag;
    assert.equal((await pedir(puerto, 'GET', '/api/estado', { cab: { ...TS('uno@x'), 'if-none-match': etag } })).codigo, 304);
    assert.equal((await pedir(puerto, 'GET', '/api/estado', { cab: { ...TS('dos@x'), 'if-none-match': etag } })).codigo, 200);
    // Las reglas se comprueban con el día del servidor
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('dos@x'), cuerpo: { ops: [{ id: 'c1', ...crear('t', ver({ rep: { tipo: 'una', fecha: '2026-11-10' } })) }] } });
    assert.match(r.json.resultados[0].error, /cerrada/);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('dos@x'), cuerpo: { ops: [{ id: 'c2', ...crear('t', ver()) }, { id: 'c2', ...crear('t', ver()) }] } });
    assert.ok(r.json.resultados[0].ok && r.json.resultados[1].repetida);
    assert.equal(base.e.tareas.t.nombre, 't');
  } finally { s.close(); }
});

test('servidor: protección contra otras webs, límites y cabeceras', async () => {
  const base = baseLista('2026-11-24');
  const { s, puerto } = await arrancar(base);
  try {
    const op = { ops: [{ id: 'z1', ...crear('t', ver()) }] };
    let r = await pedir(puerto, 'POST', '/api/ops', { cab: { ...TS('uno@x'), 'Content-Type': 'text/plain' }, cuerpo: JSON.stringify(op) });
    assert.equal(r.codigo, 415);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: { ...TS('uno@x'), 'sec-fetch-site': 'cross-site' }, cuerpo: op });
    assert.equal(r.codigo, 403);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: { ...TS('uno@x'), 'sec-fetch-site': 'same-site' }, cuerpo: op }); // el menú o gastos, desde otro puerto
    assert.equal(r.codigo, 403);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: { ...TS('uno@x'), 'sec-fetch-site': 'same-origin' }, cuerpo: op });
    assert.ok(r.json.resultados[0].ok);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: 'x'.repeat(300 * 1024) });
    assert.equal(r.codigo, 413);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: Array.from({ length: 501 }, () => ({})) } });
    assert.equal(r.codigo, 413);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: '{roto' });
    assert.equal(r.codigo, 400);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: [{ tipo: 'tarea.crear', tarea: { id: 'g', nombre: 'x'.repeat(20000) } }] } });
    assert.match(r.json.resultados[0].error, /demasiado grande/);
    r = await pedir(puerto, 'GET', '/');
    assert.match(r.cab['content-security-policy'], /script-src 'self'/);
    assert.match(r.cab['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(r.cab['x-content-type-options'], 'nosniff');
    assert.match(r.texto, /Tareas de casa/);
    assert.match((await pedir(puerto, 'GET', '/nucleo.js')).texto, /export function resumenSemana/);
    assert.equal((await pedir(puerto, 'GET', '/no-existe.js')).codigo, 404);
    assert.equal((await pedir(puerto, 'GET', '/../src/db.js')).codigo, 404);
    assert.ok([403, 404].includes((await pedir(puerto, 'GET', '/%2e%2e/src/db.js')).codigo));
    assert.ok([403, 404].includes((await pedir(puerto, 'GET', '/..%2fsrc%2fdb.js')).codigo));
    assert.equal((await pedir(puerto, 'GET', '/api/nada')).codigo, 404);
    assert.equal((await pedir(puerto, 'GET', '/api/copia')).codigo, 403);
    r = await pedir(puerto, 'GET', '/api/copia', { cab: TS('dos@x') });
    assert.equal(r.codigo, 200);
    assert.equal(r.texto.slice(0, 15), 'SQLite format 3');
  } finally { s.close(); }
});

test('servidor: avisos en directo y modo de pruebas', async () => {
  const base = baseLista();
  const { s, puerto } = await arrancar(base, { pruebas: true });
  try {
    assert.equal((await pedir(puerto, 'GET', '/api/estado', { cab: { 'x-quien': 'uno@x' } })).json.yo, 'a');
    assert.equal((await pedir(puerto, 'GET', '/api/eventos')).codigo, 403);
    const eventos = [];
    const req = request({ host: '127.0.0.1', port: puerto, path: '/api/eventos', headers: TS('dos@x') }, (res) => res.on('data', (t) => eventos.push(t.toString())));
    req.end();
    await new Promise((r) => setTimeout(r, 100));
    await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: [crear('t', ver())] } });
    await new Promise((r) => setTimeout(r, 100));
    req.destroy();
    const todo = eventos.join('');
    assert.match(todo, /event: hola/);
    assert.match(todo, new RegExp(`event: cambio\\ndata: {"seq":${base.seq}}`));
  } finally { s.close(); }
});

test('copias: diaria con rotación y mensual que no se borra', () => {
  const base = baseLista(), dir = tmp();
  ok(base, crear('t', ver()));
  for (let d = 1; d <= 33; d++) hacerCopias(base, dir, { ahora: { fecha: `2026-01-${String(d).padStart(2, '0')}`, mes: '2026-01' } });
  hacerCopias(base, dir, { ahora: { fecha: '2026-02-01', mes: '2026-02' } });
  const diarias = readdirSync(dir).filter((f) => f.endsWith('.db'));
  assert.equal(diarias.length, 30);
  assert.ok(!diarias.includes('tareas-2026-01-01.db'));
  assert.deepEqual(readdirSync(join(dir, 'mensual')).sort(), ['tareas-2026-01.db', 'tareas-2026-02.db']);
  const copia = new Base(join(dir, 'tareas-2026-02-01.db'));
  assert.deepEqual(copia.e, base.e);
  copia.cerrar();
});

test('copias: la mensual se hace al arrancar aunque no sea la hora', () => {
  const base = baseLista(), dir = tmp();
  const t = programar({ base, carpetaCopias: dir, log: () => {}, hora: 24 * 60 + 1 });
  t.revisar();
  t.parar();
  assert.equal(readdirSync(join(dir, 'mensual')).length, 1);
  assert.equal(base.meta('tarea_copia'), null);
  assert.ok(existsSync(dir));
});
