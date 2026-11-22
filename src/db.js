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
        setImmediate(() => this.avisos.emit('cambio', { seq, tipo: op.tipo, por }));
      } catch (err) {
        res.push({ id, ok: false, error: err instanceof ErrorOp ? err.message : 'Error interno: ' + err.message });
      }
    }
    return res;
  }

  /** Copia consistente de la base en `destino` (VACUUM INTO). */
  copia(destino) {
    mkdirSync(dirname(destino), { recursive: true, mode: 0o700 });
    try { unlinkSync(destino); } catch { /* no existía */ }
    this.db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`);
    return destino;
  }

  cerrar() { this.db.close(); }
}
