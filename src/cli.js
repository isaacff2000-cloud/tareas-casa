#!/usr/bin/env node
// Uso: node src/cli.js <orden>
//   servir                     arranca la app (puerto 8789)
//   copia                      hace ahora la copia de seguridad
//   restaurar <copia.db>       sustituye los datos por una copia (con el servicio parado)
//   desligar <a|b>             olvida la cuenta de Tailscale de esa persona (para volver a elegir)
//   nombrar <a|b> <nombre>     pone el nombre que se propone al elegir «Soy …»
//   resumen                    cuenta lo que hay y cómo va la semana
import { readFileSync, copyFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Base } from './db.js';
import { crearServidor } from './servidor.js';
import { programar, hacerCopias } from './copias.js';
import { Cartero } from './avisos.js';
import { clavesVapid } from './webpush.js';
import { hoy, lunesDe, resumenSemana, nombre } from './nucleo.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATOS = process.env.TAREAS_DATOS || join(RAIZ, 'datos');
const RUTA_DB = join(DATOS, 'tareas.db');
const COPIAS = join(DATOS, 'copias');
const VERSION = process.env.TAREAS_VERSION || JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version;
// Quién envía los avisos (lo pide el estándar VAPID; Apple exige una dirección https o mailto)
const SUJETO = process.env.TAREAS_SUJETO || 'https://github.com/isaacff2000-cloud/tareas-casa';
const log = (...a) => console.log(new Date().toISOString(), ...a);

const args = process.argv.slice(2);
const orden = args[0];

const ordenes = {
  async servir() {
    const pruebas = process.env.TAREAS_PRUEBAS === '1';
    // Solo en pruebas: el día de hoy fijo (para recorrer una semana sin esperar)
    const fijo = pruebas && /^\d{4}-\d{2}-\d{2}$/.test(process.env.TAREAS_HOY || '') ? process.env.TAREAS_HOY : null;
    const base = new Base(RUTA_DB, fijo ? { reloj: () => ({ dia: fijo }) } : {});
    const puerto = Number(process.env.PUERTO || 8789);
    const host = process.env.HOST || '127.0.0.1';
    // Avisos push: claves propias del portátil, guardadas junto a los datos (nunca en el repositorio)
    let cartero = null;
    try {
      cartero = new Cartero({ base, claves: clavesVapid(join(DATOS, 'vapid.json')), sujeto: SUJETO, log });
      if (!fijo) cartero.iniciar(); // con el día fijado (pruebas) no se programan recordatorios
    } catch (e) { log('Los avisos push no están disponibles: ' + e.message); }
    const s = crearServidor({ base, carpetaWeb: join(RAIZ, 'web'), carpetaTmp: join(DATOS, 'tmp'), version: VERSION, log, pruebas, cartero });
    if (pruebas) log(`AVISO: modo de pruebas (acepta la cabecera x-quien${fijo ? ', hoy = ' + fijo : ''}). No usar en el servicio.`);
    programar({ base, carpetaCopias: COPIAS, log });
    s.listen(puerto, host, () => log(`Tareas de casa ${VERSION} en http://${host}:${puerto}`));
    const salir = () => { log('Parando…'); s.close(); base.cerrar(); process.exit(0); };
    process.on('SIGTERM', salir);
    process.on('SIGINT', salir);
  },
  async copia() {
    const base = new Base(RUTA_DB);
    try { log('Copia:', hacerCopias(base, COPIAS).join(', ')); } finally { base.cerrar(); }
  },
  async restaurar() {
    const origen = args[1];
    if (!origen || !existsSync(origen)) throw new Error('Indica la copia a restaurar (archivo .db)');
    const prueba = new DatabaseSync(origen, { readOnly: true });
    const n = prueba.prepare('SELECT COUNT(*) AS n FROM op').get().n;
    prueba.close();
    if (existsSync(RUTA_DB)) {
      const aparte = `${RUTA_DB}.antes-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      renameSync(RUTA_DB, aparte);
      for (const x of ['-wal', '-shm']) rmSync(RUTA_DB + x, { force: true });
      log('Los datos que había se guardan en', aparte);
    }
    copyFileSync(origen, RUTA_DB);
    log(`Restaurada la copia (${n} operaciones). Arranca de nuevo el servicio.`);
  },
  async desligar() {
    const p = args[1];
    if (p !== 'a' && p !== 'b') throw new Error('Indica a o b');
    const base = new Base(RUTA_DB);
    try {
      const [r] = base.aplicar([{ tipo: 'persona.desligar', persona: p }], { por: 'sistema' });
      if (!r.ok) throw new Error(r.error);
      // Sus móviles dejan de recibir los avisos de ese hueco (quien lo elija los activará en los suyos)
      for (const s of base.suscripciones(p)) base.borrarSuscripcion(s.endpoint);
      log(`Hecho: ${p} puede volver a elegir quién es desde su móvil. Reinicia el servicio si está en marcha.`);
    } finally { base.cerrar(); }
  },
  async nombrar() {
    const [p, ...resto] = args.slice(1);
    if (p !== 'a' && p !== 'b') throw new Error('Indica a o b y el nombre');
    const base = new Base(RUTA_DB);
    try {
      const [r] = base.aplicar([{ tipo: 'persona.nombrar', persona: p, nombre: resto.join(' ') }], { por: 'sistema' });
      if (!r.ok) throw new Error(r.error);
      log('Hecho.');
    } finally { base.cerrar(); }
  },
  async resumen() {
    const base = new Base(RUTA_DB);
    const e = base.e;
    log('operaciones', base.seq);
    log('personas', JSON.stringify(Object.fromEntries(Object.entries(e.personas).map(([k, v]) => [k, `${v.nombre || '-'}${v.ligada ? ' (ligada)' : ''}`]))));
    log('tareas', Object.keys(e.tareas).length);
    const r = resumenSemana(e, lunesDe(hoy()));
    log(`semana ${r.lunes}: ${r.puntos.total} puntos (${nombre(e, 'a')} ${r.puntos.a}, ${nombre(e, 'b')} ${r.puntos.b}) de ${r.planificados} planificados ·`,
      r.premios.map((p) => `${p.id} ${p.desbloqueado ? 'sí' : 'no'}`).join(' · '));
    base.cerrar();
  },
};

const fn = ordenes[orden];
if (!fn) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 8).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(orden ? 1 : 0); }
fn().catch((e) => { console.error('Error:', e.message); process.exit(1); });
