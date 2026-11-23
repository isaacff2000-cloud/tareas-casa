// Base de datos: SQLite con la lista de operaciones. El estado se rehace al arrancar aplicándolas
// en orden (con las mismas reglas que el móvil) y se mantiene en memoria.
import { DatabaseSync } from 'node:sqlite';
import { EventEmitter } from 'node:events';
import { mkdirSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { estadoVacio, validarOp, aplicarOp, ErrorOp, hoy } from './nucleo.js';

export const VERSION_OPS = 1;
const MAX_OP = 16_000; // bytes de una operación

const VERSIONES = [
  `CREATE TABLE op (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     id TEXT NOT NULL UNIQUE,         -- puesto por el móvil: si llega dos veces, se aplica una
     ts TEXT NOT NULL,
     por TEXT,                        -- a | b | sistema
     tipo TEXT NOT NULL,
     datos TEXT NOT NULL              -- JSON con el resto de la operación
   );`,
  // Avisos push. Las suscripciones son de cada aparato: no forman parte del historial compartido.
  `CREATE TABLE suscripcion (
     endpoint TEXT PRIMARY KEY,       -- dirección del servicio de avisos del móvil (Apple o Google)
     persona TEXT NOT NULL,           -- a | b
     p256dh TEXT NOT NULL,
     auth TEXT NOT NULL,
     dispositivo TEXT,
     creado TEXT NOT NULL,
     fallos INTEGER NOT NULL DEFAULT 0
   );
   CREATE TABLE aviso (
     clave TEXT PRIMARY KEY,          -- p. ej. hoy|a|2026-11-25: así nunca se repite, ni tras un reinicio
     persona TEXT NOT NULL,
     tipo TEXT NOT NULL,              -- hoy | hora | puntos | manana | devuelta
     titulo TEXT NOT NULL,
     cuerpo TEXT NOT NULL,
     aparicion TEXT,                  -- para comprobar justo antes de enviar que sigue haciendo falta
     desde TEXT NOT NULL,             -- no antes de (las devoluciones de noche esperan a las 08:00)
     caduca TEXT,                     -- si no se pudo enviar antes, ya no se manda
     creado TEXT NOT NULL,
     enviado TEXT,
     resultado TEXT
   );
   CREATE INDEX aviso_pendiente ON aviso (enviado, desde);`,
];

export const ahora = () => new Date().toISOString();

export class Base {
  /** reloj: () => { dia: 'AAAA-MM-DD' } con el día de hoy (las pruebas lo fijan). */
  constructor(ruta, { reloj = () => ({ dia: hoy() }) } = {}) {
    this.reloj = reloj;
    if (ruta !== ':memory:') mkdirSync(dirname(ruta), { recursive: true, mode: 0o700 });
    this.ruta = ruta;
    this.db = new DatabaseSync(ruta);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    this.avisos = new EventEmitter();
    this.avisos.setMaxListeners(100);
    this.migrar();
    this.recargar();
  }

  migrar() {
    this.db.exec('CREATE TABLE IF NOT EXISTS meta (clave TEXT PRIMARY KEY, valor TEXT)');
    const v = Number(this.meta('version') || 0);
    for (let i = v; i < VERSIONES.length; i++) {
      this.transaccion(() => { this.db.exec(VERSIONES[i]); this.ponerMeta('version', String(i + 1)); });
    }
  }

  meta(clave) { const f = this.db.prepare('SELECT valor FROM meta WHERE clave = ?').get(clave); return f ? f.valor : null; }
  ponerMeta(clave, valor) {
    if (valor == null) this.db.prepare('DELETE FROM meta WHERE clave = ?').run(clave);
    else this.db.prepare('INSERT INTO meta (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(clave, String(valor));
  }

  transaccion(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const r = fn(); this.db.exec('COMMIT'); return r; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }

  /** Rehace el estado desde el principio. */
  recargar() {
    const e = estadoVacio();
    let seq = 0;
    for (const f of this.db.prepare('SELECT * FROM op ORDER BY seq').iterate()) {
      try { aplicarOp(e, { ...JSON.parse(f.datos), id: f.id, tipo: f.tipo, por: f.por, ts: f.ts }); } catch { /* una operación antigua que ya no aplica: se salta */ }
      seq = f.seq;
    }
    this.e = e;
    this.seq = seq;
  }

  get vacia() { return this.seq === 0; }

  /**
   * Aplica operaciones de un móvil (o del sistema). Devuelve por cada una { id, ok, repetida?, error? }.
   * por: 'a' | 'b' | 'sistema' | null · login: cuenta de Tailscale (solo para persona.reclamar)
   */
  aplicar(ops, { por = null, login = null } = {}) {
    const res = [];
    const existe = this.db.prepare('SELECT 1 FROM op WHERE id = ?');
    const insertar = this.db.prepare('INSERT INTO op (id, ts, por, tipo, datos) VALUES (?, ?, ?, ?, ?)');
    for (const crudo of ops) {
      const id = typeof crudo?.id === 'string' && crudo.id.length <= 80 ? crudo.id : randomUUID();
      if (existe.get(id)) { res.push({ id, ok: true, repetida: true }); continue; }
      const { id: _i, por: _p, ts: _t, login: _l, ...datos } = crudo || {};
      const op = { ...datos, v: VERSION_OPS, id, por, ts: ahora() };
      if (op.tipo === 'persona.reclamar') op.login = login;
      try {
        const texto = JSON.stringify({ ...datos, v: VERSION_OPS, ...(op.login ? { login: op.login } : {}) });
        if (texto.length > MAX_OP) throw new ErrorOp('Operación demasiado grande');
        validarOp(this.e, op, this.reloj());
        const seq = this.transaccion(() => Number(insertar.run(id, op.ts, por, op.tipo, texto).lastInsertRowid));
        try { aplicarOp(this.e, op); } catch (err) { this.recargar(); throw err; }
        this.seq = seq;
        res.push({ id, ok: true });
        setImmediate(() => this.avisos.emit('cambio', { seq, tipo: op.tipo, por, op }));
      } catch (err) {
        res.push({ id, ok: false, error: err instanceof ErrorOp ? err.message : 'Error interno: ' + err.message });
      }
    }
    return res;
  }

  /* ---------- Avisos push ---------- */
  suscripciones(persona = null) {
    return persona ? this.db.prepare('SELECT * FROM suscripcion WHERE persona = ?').all(persona) : this.db.prepare('SELECT * FROM suscripcion').all();
  }
  guardarSuscripcion({ endpoint, persona, p256dh, auth, dispositivo = null }) {
    this.db.prepare(`INSERT INTO suscripcion (endpoint, persona, p256dh, auth, dispositivo, creado) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET persona = excluded.persona, p256dh = excluded.p256dh, auth = excluded.auth, dispositivo = excluded.dispositivo, fallos = 0`)
      .run(endpoint, persona, p256dh, auth, dispositivo, ahora());
  }
  borrarSuscripcion(endpoint, persona = null) {
    return persona ? this.db.prepare('DELETE FROM suscripcion WHERE endpoint = ? AND persona = ?').run(endpoint, persona).changes
      : this.db.prepare('DELETE FROM suscripcion WHERE endpoint = ?').run(endpoint).changes;
  }
  falloSuscripcion(endpoint) { this.db.prepare('UPDATE suscripcion SET fallos = fallos + 1 WHERE endpoint = ?').run(endpoint); }
  okSuscripcion(endpoint) { this.db.prepare('UPDATE suscripcion SET fallos = 0 WHERE endpoint = ?').run(endpoint); }
  /** Apunta un aviso; si ya existía esa clave (ya se mandó o está esperando), no hace nada. */
  encolarAviso({ clave, persona, tipo, titulo, cuerpo, aparicion = null, desde, caduca = null }) {
    return this.db.prepare('INSERT OR IGNORE INTO aviso (clave, persona, tipo, titulo, cuerpo, aparicion, desde, caduca, creado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(clave, persona, tipo, titulo, cuerpo, aparicion, desde, caduca, ahora()).changes > 0;
  }
  avisosPorEnviar(cuando) { return this.db.prepare('SELECT * FROM aviso WHERE enviado IS NULL AND desde <= ? ORDER BY desde, clave').all(cuando); }
  marcarAviso(clave, resultado, cuando = ahora()) { this.db.prepare('UPDATE aviso SET enviado = ?, resultado = ? WHERE clave = ?').run(cuando, resultado, clave); }
  ultimosAvisos(limite = 50) { return this.db.prepare('SELECT * FROM aviso ORDER BY creado DESC LIMIT ?').all(limite); }
  podarAvisos(antesDe) { this.db.prepare('DELETE FROM aviso WHERE creado < ?').run(antesDe); }

  /** Copia consistente de la base en `destino` (VACUUM INTO). */
  copia(destino) {
    mkdirSync(dirname(destino), { recursive: true, mode: 0o700 });
    try { unlinkSync(destino); } catch { /* no existía */ }
    this.db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
    return destino;
  }

  cerrar() { this.db.close(); }
}
