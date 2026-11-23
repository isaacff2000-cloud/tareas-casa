// Servidor HTTP: API, avisos en directo (SSE) y la app web. Escucha solo dentro del portátil;
// Tailscale Serve lo publica con HTTPS para vuestros dispositivos y añade quién hace cada petición.
import { createServer } from 'node:http';
import { readFile, stat, unlink, mkdir } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, normalize, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { publico, hoy, lunesDe, sumarDias } from './nucleo.js';

/** El móvil recibe las apariciones de las últimas 12 semanas (el historial completo se queda aquí). */
const SEMANAS_MOVIL = 12;

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const MAX_CUERPO = 256 * 1024;
const MAX_OPS = 500;
const SEGURIDAD = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; " +
    "manifest-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

class ErrorHttp extends Error { constructor(codigo, msg) { super(msg); this.codigo = codigo; } }

function json(res, codigo, datos, cab = {}) {
  res.writeHead(codigo, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEGURIDAD, ...cab });
  res.end(JSON.stringify(datos));
}
async function leerCuerpo(req) {
  let n = 0;
  const trozos = [];
  for await (const t of req) { n += t.length; if (n > MAX_CUERPO) throw new ErrorHttp(413, 'Petición demasiado grande'); trozos.push(t); }
  try { return JSON.parse(Buffer.concat(trozos).toString('utf8') || '{}'); } catch { throw new ErrorHttp(400, 'JSON no válido'); }
}

/**
 * Crea el servidor.
 * pruebas: acepta la cabecera x-quien como cuenta (solo para las pruebas; nunca en el servicio).
 */
export function crearServidor({ base, carpetaWeb, carpetaTmp, version = 'dev', log = console.log, pruebas = false, cartero = null }) {
  const clientes = new Set();
  base.avisos.on('cambio', (ev) => {
    const msg = `id: ${ev.seq}\nevent: cambio\ndata: ${JSON.stringify({ seq: ev.seq })}\n\n`;
    for (const c of clientes) c.write(msg);
  });
  const latido = setInterval(() => { for (const c of clientes) c.write(': latido\n\n'); }, 25_000);
  latido.unref();

  /** Quién pide: la cuenta que añade Tailscale Serve y, si ya eligió, si es la persona a o b. */
  function quien(req) {
    let login = req.headers['tailscale-user-login'];
    if (!login && pruebas) login = req.headers['x-quien'];
    login = login ? String(login).trim().toLowerCase().slice(0, 200) : null;
    let p = null;
    if (login) for (const k of ['a', 'b']) if (base.e.logins[k] === login) p = k;
    return { login, p };
  }
  const exigirPersona = (q) => { if (!q.p) throw new ErrorHttp(403, q.login ? 'Primero elige quién eres en la app' : 'Abre la app a través de Tailscale'); };

  /** Contra webs ajenas que intenten escribir usando vuestro navegador. */
  function soloDeLaApp(req) {
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new ErrorHttp(415, 'Se espera JSON');
    const sitio = req.headers['sec-fetch-site'];
    if (sitio && sitio !== 'same-origin' && sitio !== 'none') throw new ErrorHttp(403, 'Petición de otra web');
  }
  const conCartero = () => { if (!cartero) throw new ErrorHttp(503, 'Los avisos no están disponibles'); return cartero; };
  const texto = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

  function modo(q) {
    if (q.p) return 'ok';
    if (!q.login) return 'sin-identidad';
    return base.e.personas.a.ligada && base.e.personas.b.ligada ? 'completo' : 'alta';
  }

  const rutas = {
    'GET /api/salud': () => ({ ok: true, version, seq: base.seq, copia: base.meta('tarea_copia'), copiaError: JSON.parse(base.meta('tarea_copia_error') || 'null') }),

    'GET /api/estado': (req, res) => {
      const q = quien(req), m = modo(q);
      const desde = sumarDias(lunesDe(base.reloj().dia), -7 * SEMANAS_MOVIL);
      const etag = `"${base.seq}-${m}-${q.p || ''}-${desde}"`;
      if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, ...SEGURIDAD }); res.end(); return undefined; }
      const cuerpo = { seq: base.seq, modo: m, yo: q.p, desde };
      if (m === 'ok') cuerpo.datos = publico(base.e, desde);
      else if (m === 'alta') cuerpo.personas = structuredClone(base.e.personas);
      json(res, 200, cuerpo, { ETag: etag });
      return undefined;
    },

    'POST /api/ops': async (req) => {
      soloDeLaApp(req);
      const q = quien(req);
      if (!q.login) throw new ErrorHttp(403, 'Abre la app a través de Tailscale');
      const cuerpo = await leerCuerpo(req);
      const ops = Array.isArray(cuerpo.ops) ? cuerpo.ops : [];
      if (ops.length > MAX_OPS) throw new ErrorHttp(413, 'Demasiadas operaciones');
      const resultados = [];
      for (const o of ops) {
        // Quien aún no ha elegido solo puede elegir; el resto de reglas las aplica validarOp
        if (!q.p && !(o && o.tipo === 'persona.reclamar')) {
          resultados.push({ id: o && o.id, ok: false, error: 'Primero elige quién eres en la app' });
          continue;
        }
        resultados.push(...base.aplicar([o], { por: q.p, login: q.login }));
      }
      return { resultados, seq: base.seq };
    },

    // Avisos push. Las suscripciones son de cada aparato y nunca se mandan a los móviles.
    'GET /api/avisos': (req) => {
      const q = quien(req);
      exigirPersona(q);
      return { clave: cartero ? cartero.clavePublica : null, dispositivos: base.suscripciones(q.p).length };
    },
    'POST /api/avisos/suscribir': async (req) => {
      soloDeLaApp(req);
      const q = quien(req);
      exigirPersona(q);
      conCartero();
      const c = await leerCuerpo(req);
      const sus = c.suscripcion || {};
      let u = null;
      try { u = new URL(String(sus.endpoint || '')); } catch { /* no válida */ }
      const clave = String((sus.keys && sus.keys.p256dh) || ''), auth = String((sus.keys && sus.keys.auth) || '');
      if (!u || u.protocol !== 'https:' || String(sus.endpoint).length > 1000 || !/^[A-Za-z0-9_-]{80,100}$/.test(clave) || !/^[A-Za-z0-9_-]{16,32}$/.test(auth)) {
        throw new ErrorHttp(400, 'Suscripción no válida');
      }
      base.guardarSuscripcion({ endpoint: u.toString(), persona: q.p, p256dh: clave, auth, dispositivo: texto(c.dispositivo, 80) || null });
      return { ok: true, dispositivos: base.suscripciones(q.p).length };
    },
    'POST /api/avisos/quitar': async (req) => {
      soloDeLaApp(req);
      const q = quien(req);
      exigirPersona(q);
      const c = await leerCuerpo(req);
      base.borrarSuscripcion(String(c.endpoint || ''), q.p);
      return { ok: true, dispositivos: base.suscripciones(q.p).length };
    },
    'POST /api/avisos/probar': async (req) => {
      soloDeLaApp(req);
      const q = quien(req);
      exigirPersona(q);
      const r = await conCartero().enviarA(q.p, { titulo: 'Tareas de casa', cuerpo: 'Prueba: si ves esto, los avisos llegan a este móvil.', tag: 'prueba' });
      if (!r.dispositivos) throw new ErrorHttp(409, 'Este móvil aún no tiene los avisos activados');
      return r;
    },

    'GET /api/eventos': (req, res) => {
      if (!quien(req).login) throw new ErrorHttp(403, 'Abre la app a través de Tailscale');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no', ...SEGURIDAD });
      res.write(`retry: 3000\nevent: hola\ndata: ${JSON.stringify({ seq: base.seq })}\n\n`);
      clientes.add(res);
      req.on('close', () => clientes.delete(res));
      return undefined;
    },

    'GET /api/copia': async (req, res) => {
      exigirPersona(quien(req));
      await mkdir(carpetaTmp, { recursive: true, mode: 0o700 });
      const tmp = join(carpetaTmp, `descarga-${randomUUID()}.db`);
      base.copia(tmp);
      const { size } = await stat(tmp);
      res.writeHead(200, { 'Content-Type': 'application/vnd.sqlite3', 'Content-Length': size, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="tareas-copia-${hoy()}.db"`, ...SEGURIDAD });
      const s = createReadStream(tmp);
      s.pipe(res);
      const borrar = () => unlink(tmp).catch(() => {});
      s.on('close', borrar);
      s.on('error', borrar);
      base.ponerMeta('copia_descargada', new Date().toISOString());
      return undefined;
    },
  };

  const COMPARTIDOS = { '/nucleo.js': new URL('./nucleo.js', import.meta.url) };
  async function estatico(req, res, ruta) {
    let fichero;
    if (COMPARTIDOS[ruta]) fichero = COMPARTIDOS[ruta];
    else {
      let rel;
      try { rel = decodeURIComponent(ruta); } catch { res.writeHead(400, SEGURIDAD); res.end(); return; }
      if (rel.endsWith('/')) rel += 'index.html';
      const f = normalize(join(carpetaWeb, rel));
      if (!f.startsWith(normalize(carpetaWeb))) { res.writeHead(403, SEGURIDAD); res.end(); return; }
      fichero = f;
      try { if (!(await stat(f)).isFile()) throw new Error(); } catch { fichero = join(carpetaWeb, extname(rel) ? '__no__' : 'index.html'); }
    }
    try {
      const datos = await readFile(fichero);
      const nombre = String(fichero.pathname || fichero);
      const sinCache = /(\.html|\.js|\.css|\.webmanifest)$/.test(nombre);
      res.writeHead(200, { 'Content-Type': TIPOS[extname(nombre)] || 'application/octet-stream', 'Cache-Control': sinCache ? 'no-cache' : 'public, max-age=3600', ...SEGURIDAD });
      res.end(req.method === 'HEAD' ? undefined : datos);
    } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SEGURIDAD }); res.end('No encontrado'); }
  }

  const servidor = createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); res.end(); return; }
    const ruta = rutas[`${req.method} ${url.pathname}`];
    try {
      if (ruta) {
        const r = await ruta(req, res, url);
        if (r !== undefined) json(res, 200, r);
      } else if (url.pathname.startsWith('/api/')) json(res, 404, { error: 'No existe' });
      else if (req.method === 'GET' || req.method === 'HEAD') await estatico(req, res, url.pathname);
      else json(res, 405, { error: 'Método no permitido' });
    } catch (e) {
      if (!(e instanceof ErrorHttp)) log(`Error en ${req.method} ${url.pathname}: ${e.message}`);
      if (!res.headersSent) json(res, e.codigo || 500, { error: e instanceof ErrorHttp ? e.message : 'Error interno' });
      else res.end();
    }
  });
  servidor.on('close', () => { clearInterval(latido); for (const c of clientes) c.end(); });
  return servidor;
}
