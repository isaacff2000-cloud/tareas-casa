// Avisos push: cifrado (RFC 8291), firma VAPID (RFC 8292) y qué se avisa, a quién y cuándo, con un servicio
// de avisos falso que recibe cada envío y lo descifra como haría el móvil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify } from 'node:crypto';
import * as N from '../src/nucleo.js';
import { Base } from '../src/db.js';
import { crearServidor } from '../src/servidor.js';
import { cifrar, clavesVapid, cabeceraVapid, b64u, deB64u } from '../src/webpush.js';
import { Cartero, recordatorios, cuandoEnviar, enSilencio } from '../src/avisos.js';
import { horaLocal } from '../src/copias.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const L = '2026-11-23'; // lunes
const tmp = () => mkdtempSync(join(tmpdir(), 'tareas-avisos-'));
/** Hora de Madrid (noviembre: UTC+1) → Date */
const madrid = (fecha, hm) => new Date(`${fecha}T${hm}:00+01:00`);

function baseLista(dia = '2026-11-25') {
  const reloj = { dia };
  const b = new Base(':memory:', { reloj: () => ({ dia: reloj.dia }) });
  b.reloj.fijar = (d) => { reloj.dia = d; };
  b.aplicar([{ tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }], { login: 'uno@x' });
  b.aplicar([{ tipo: 'persona.reclamar', persona: 'b', nombre: 'Dos' }], { login: 'dos@x' });
  return b;
}
function ok(b, ops, por = 'a') {
  const r = b.aplicar([].concat(ops), { por });
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  return r;
}
const crear = (id, version, { nombre = id, inicio = L, emoji = '🧹' } = {}) => ({ tipo: 'tarea.crear', tarea: { id, nombre, emoji }, inicio, version });
const semanal = (dias, x = {}) => ({ puntos: 2, quien: 'a', hora: null, rep: { tipo: 'semanal', dias, cada: 1, ancla: L }, ...x });

/* ---------- El móvil falso ---------- */
function movil() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return { ecdh, auth, keys: { p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}
/** Descifra como el navegador (RFC 8291 / 8188). */
function descifrar(cuerpo, m) {
  const sal = cuerpo.subarray(0, 16);
  assert.equal(cuerpo.readUInt32BE(16), 4096);
  const n = cuerpo[20];
  const asPublica = cuerpo.subarray(21, 21 + n);
  const datos = cuerpo.subarray(21 + n);
  const uaPublica = m.ecdh.getPublicKey();
  const hk = (ikm, s, info, l) => Buffer.from(hkdfSync('sha256', ikm, s, info, l));
  const ikm = hk(m.ecdh.computeSecret(asPublica), m.auth, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica]), 32);
  const d = createDecipheriv('aes-128-gcm', hk(ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hk(ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12));
  d.setAuthTag(datos.subarray(datos.length - 16));
  const claro = Buffer.concat([d.update(datos.subarray(0, datos.length - 16)), d.final()]);
  assert.equal(claro[claro.length - 1], 2, 'delimitador de último registro');
  return JSON.parse(claro.subarray(0, -1).toString('utf8'));
}
/** Servicio de avisos falso: guarda lo recibido, comprueba la firma VAPID y responde lo que se le diga. */
function servicioFalso(claves, moviles) {
  const recibidos = [];
  const respuestas = {};
  const publica = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(deB64u(claves.publica).subarray(1, 33)), y: b64u(deB64u(claves.publica).subarray(33)) }, format: 'jwk' });
  const pedir = async (url, { headers, body }) => {
    const [, t, k] = headers.Authorization.match(/^vapid t=([^,]+), k=(.+)$/);
    assert.equal(k, claves.publica);
    const [c, p, f] = t.split('.');
    assert.ok(verify('sha256', Buffer.from(`${c}.${p}`), { key: publica, dsaEncoding: 'ieee-p1363' }, deB64u(f)), 'firma VAPID válida');
    const jwt = JSON.parse(deB64u(p).toString());
    assert.equal(jwt.aud, new URL(url).origin);
    assert.match(jwt.sub, /^https:\/\//);
    assert.equal(headers['Content-Encoding'], 'aes128gcm');
    const m = moviles[url];
    recibidos.push({ url, datos: m ? descifrar(body, m) : null });
    return { status: respuestas[url] || 201 };
  };
  return { pedir, recibidos, respuestas };
}
/** Cartero con reloj fijado, dos móviles (uno de cada persona) y el servicio falso. */
function montar(b) {
  const claves = clavesVapid(join(tmp(), 'vapid.json'));
  const ma = movil(), mb = movil();
  const urlA = 'https://push.ejemplo.test/a', urlB = 'https://push.ejemplo.test/b';
  b.guardarSuscripcion({ endpoint: urlA, persona: 'a', ...ma.keys });
  b.guardarSuscripcion({ endpoint: urlB, persona: 'b', ...mb.keys });
  const sv = servicioFalso(claves, { [urlA]: ma, [urlB]: mb });
  const reloj = { t: madrid('2026-11-25', '09:00') };
  const c = new Cartero({ base: b, claves, sujeto: 'https://ejemplo.test', log: () => {}, pedir: sv.pedir, ahora: () => reloj.t });
  const a = (fecha, hm) => { reloj.t = madrid(fecha, hm); return c.revisar(); };
  const recibidos = (quien) => sv.recibidos.filter((r) => r.url === (quien === 'a' ? urlA : urlB)).map((r) => r.datos);
  return { c, a, sv, recibidos, reloj, urlA, urlB };
}

/* ---------- Cifrado y firma ---------- */
test('cifrado: coincide con el ejemplo oficial del RFC 8291', () => {
  const r = cifrar('When I grow up, I want to be a watermelon',
    { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' },
    { privada: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', sal: 'DGv6ra1nlYgDCS1FRnbzlw' });
  assert.equal(b64u(r), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

test('cifrado: el móvil lo descifra (también con tildes y emojis) y cada envío es distinto', () => {
  const m = movil();
  const datos = { titulo: '↩ Ána te ha devuelto «Baño»', cuerpo: '🚿 falta el espejo' };
  const x = cifrar(JSON.stringify(datos), m.keys), y = cifrar(JSON.stringify(datos), m.keys);
  assert.deepEqual(descifrar(x, m), datos);
  assert.notEqual(b64u(x), b64u(y));
  assert.throws(() => cifrar('x', { p256dh: 'AAAA', auth: m.keys.auth }), /p256dh/);
  assert.throws(() => cifrar('x'.repeat(4000), m.keys), /largo/);
});

test('claves VAPID: se crean una vez, solo legibles por el servicio, y la firma vale', () => {
  const ruta = join(tmp(), 'sub', 'vapid.json');
  const k1 = clavesVapid(ruta), k2 = clavesVapid(ruta);
  assert.equal(k1.publica, k2.publica);
  assert.equal(deB64u(k1.publica).length, 65);
  assert.equal(statSync(ruta).mode & 0o777, 0o600);
  const cab = cabeceraVapid('https://web.push.apple.com/abc', k1, { sujeto: 'https://ejemplo.test', ahora: 1_800_000_000_000 });
  const jwt = JSON.parse(deB64u(cab.match(/t=[^.]+\.([^.]+)\./)[1]).toString());
  assert.deepEqual(jwt, { aud: 'https://web.push.apple.com', exp: 1_800_000_000 + 12 * 3600, sub: 'https://ejemplo.test' });
});

/* ---------- Preferencias ---------- */
test('preferencias: cada uno las suyas, validadas y reproducibles', () => {
  const b = baseLista();
  assert.deepEqual(N.prefsAvisos(b.e, 'a'), N.AVISOS_DEF);
  ok(b, { tipo: 'avisos.preferencias', hoy: false, horaHoy: '21:00', retraso: 15 }, 'b');
  assert.equal(N.prefsAvisos(b.e, 'b').hoy, false);
  assert.equal(N.prefsAvisos(b.e, 'b').horaHoy, '21:00');
  assert.equal(N.prefsAvisos(b.e, 'a').hoy, true);
  for (const mal of [{ horaHoy: '23:30' }, { horaHoy: '07:00' }, { retraso: 45 }, { hoy: 'si' }, {}]) {
    const [r] = b.aplicar([{ tipo: 'avisos.preferencias', ...mal }], { por: 'a' });
    assert.equal(r.ok, false, JSON.stringify(mal));
  }
  const [r] = b.aplicar([{ tipo: 'avisos.preferencias', hoy: false }], { por: null });
  assert.equal(r.ok, false);
  b.recargar();
  assert.equal(N.prefsAvisos(b.e, 'b').retraso, 15);
  assert.deepEqual(N.publico(b.e).avisos.b, { hoy: false, horaHoy: '21:00', retraso: 15 });
});

/* ---------- Qué se avisa y cuándo ---------- */
test('lo que te queda hoy: a las 20:00, solo a quien le toca, una vez y no tarde', async () => {
  const b = baseLista();
  ok(b, [crear('fregar', semanal([3]), { nombre: 'Fregar', emoji: '🍽️' }), crear('basura', semanal([1, 3], { quien: 'cualquiera' }), { nombre: 'Basura', emoji: '🗑️' })]);
  const { a, recibidos } = montar(b);
  await a('2026-11-25', '19:59');
  assert.equal(recibidos('a').length, 0);
  await a('2026-11-25', '20:00');
  await a('2026-11-25', '20:01');
  // a: fregar (hoy) + basura de hoy + basura del lunes (atrasada); b: las dos de basura
  assert.equal(recibidos('a').length, 1);
  assert.equal(recibidos('a')[0].titulo, 'Te quedan 3 tareas de hoy');
  assert.match(recibidos('a')[0].cuerpo, /🍽️ Fregar/);
  assert.equal(recibidos('a')[0].pendientes, 3);
  assert.equal(recibidos('b')[0].titulo, 'Te quedan 2 tareas de hoy');
  // Marcadas por uno, dejan de contar para el otro
  ok(b, [{ tipo: 'aparicion.hecha', aparicion: 'basura|2026-11-23', hechaPor: ['b'], dia: '2026-11-25' },
    { tipo: 'aparicion.hecha', aparicion: 'basura|2026-11-25', hechaPor: ['b'], dia: '2026-11-25' }], 'b');
  assert.deepEqual(recordatorios(b.e, { fecha: '2026-11-25', minutos: 20 * 60 }).map((r) => r.clave), ['hoy|a|2026-11-25']);
  // Portátil apagado a las 20:00 del jueves: a las 20:45 ya no se manda
  ok(b, crear('suelta', { puntos: 1, quien: 'a', hora: null, rep: { tipo: 'una', fecha: '2026-11-26' } }));
  await a('2026-11-26', '20:45');
  assert.equal(recibidos('a').length, 1);
});

test('tareas con hora: 30 min después si sigue sin hacer; nada si ya está hecha', async () => {
  const b = baseLista();
  ok(b, [crear('cena', semanal([3, 4], { quien: 'b', hora: '21:00' }), { nombre: 'Cena', emoji: '🍳' })]);
  ok(b, { tipo: 'avisos.preferencias', hoy: false }, 'b');
  const { a, recibidos } = montar(b);
  await a('2026-11-25', '21:29');
  await a('2026-11-25', '21:30');
  await a('2026-11-25', '21:31');
  assert.deepEqual(recibidos('b').map((d) => d.titulo), ['🍳 Cena']);
  assert.equal(recibidos('b')[0].cuerpo, 'Era a las 21:00 y sigue sin hacer.');
  assert.equal(recibidos('a').length, 0);
  b.reloj.fijar('2026-11-26');
  ok(b, { tipo: 'aparicion.hecha', aparicion: 'cena|2026-11-26', hechaPor: ['b'], dia: '2026-11-26' }, 'b');
  await a('2026-11-26', '21:30');
  assert.equal(recibidos('b').length, 1);
  // A su hora, si se elige así; y nunca de madrugada (22:45 + 30 = 23:15)
  ok(b, { tipo: 'avisos.preferencias', retraso: 0 }, 'b');
  assert.equal(recordatorios(b.e, { fecha: '2026-11-25', minutos: 21 * 60 })[0].cuerpo, 'Toca ahora (21:00).');
  ok(b, { tipo: 'aparicion.cambiar', aparicion: 'cena|2026-11-25', hora: '22:45' }, 'b');
  ok(b, { tipo: 'avisos.preferencias', retraso: 30 }, 'b');
  for (let m = 22 * 60; m < 24 * 60; m++) assert.deepEqual(recordatorios(b.e, { fecha: '2026-11-25', minutos: m }), []);
});

test('faltan puntos: viernes 18:00 y domingo 12:00 a los dos, con lo que falta', async () => {
  const b = baseLista('2026-11-27');
  ok(b, crear('bano', semanal([5], { puntos: 5, quien: 'ambos' }), { nombre: 'Baño' }));
  ok(b, { tipo: 'aparicion.hecha', aparicion: 'bano|2026-11-27', hechaPor: ['a'], dia: '2026-11-27' });
  const { a, recibidos } = montar(b);
  await a('2026-11-27', '18:00');
  assert.equal(recibidos('a')[0].titulo, 'Puntos de la semana');
  assert.equal(recibidos('a')[0].cuerpo, 'Os faltan 15 para 🛵 pedir a domicilio y 25 para 🍻 salir; a ti, 3 para tu mínimo; a Dos, 8 para su mínimo.');
  assert.match(recibidos('b')[0].cuerpo, /a Uno, 3 para su mínimo; a ti, 8 para tu mínimo/);
  await a('2026-11-28', '18:00'); // sábado: nada
  await a('2026-11-29', '12:10');
  assert.equal(recibidos('a').length, 2);
  // Todo desbloqueado: no se avisa
  ok(b, { tipo: 'metas.desde', desde: L, domicilio: 5, salir: 5, minimo: 0 });
  assert.deepEqual(recordatorios(b.e, { fecha: '2026-11-29', minutos: 12 * 60 }), []);
});

test('te han devuelto una tarea: al momento y con la nota; de noche, a las 08:00', async () => {
  const b = baseLista();
  ok(b, crear('bano', semanal([3], { quien: 'cualquiera' }), { nombre: 'Baño' }));
  const { c, a, recibidos, reloj } = montar(b);
  c.iniciar(1e9);
  try {
    ok(b, { tipo: 'aparicion.hecha', aparicion: 'bano|2026-11-25', hechaPor: ['a'], dia: '2026-11-25' });
    reloj.t = madrid('2026-11-25', '18:00');
    ok(b, { tipo: 'aparicion.devolver', aparicion: 'bano|2026-11-25', nota: 'falta el espejo' }, 'b');
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(recibidos('a').map((d) => [d.titulo, d.cuerpo]), [['↩ Dos te ha devuelto «Baño»', '«falta el espejo»']]);
    assert.equal(recibidos('b').length, 0, 'a quien la devuelve no se le avisa');
    // De noche: espera a las 08:00
    ok(b, { tipo: 'aparicion.hecha', aparicion: 'bano|2026-11-25', hechaPor: ['a'], dia: '2026-11-25' });
    reloj.t = madrid('2026-11-25', '23:30');
    ok(b, { tipo: 'aparicion.devolver', aparicion: 'bano|2026-11-25' }, 'b');
    await new Promise((r) => setTimeout(r, 20));
    await a('2026-11-26', '07:59');
    assert.equal(recibidos('a').length, 1);
    await a('2026-11-26', '08:00');
    assert.equal(recibidos('a').length, 2);
    assert.equal(recibidos('a')[1].cuerpo, 'Vuelve a estar pendiente.');
    // Si antes de las 08:00 ya la ha vuelto a hacer, no se manda
    ok(b, { tipo: 'aparicion.hecha', aparicion: 'bano|2026-11-25', hechaPor: ['a'], dia: '2026-11-25' });
    reloj.t = madrid('2026-11-26', '01:00');
    b.reloj.fijar('2026-11-26');
    ok(b, { tipo: 'aparicion.devolver', aparicion: 'bano|2026-11-25' }, 'b');
    await new Promise((r) => setTimeout(r, 20));
    ok(b, { tipo: 'aparicion.hecha', aparicion: 'bano|2026-11-25', hechaPor: ['a'], dia: '2026-11-25' });
    await a('2026-11-26', '08:00');
    assert.equal(recibidos('a').length, 2);
    assert.ok(b.ultimosAvisos().some((x) => x.resultado === 'ya no hacía falta'));
  } finally { c.parar(); }
});

test('cuándo sale lo que nace de noche y horas de silencio', () => {
  assert.equal(cuandoEnviar(madrid('2026-11-25', '23:30')).toISOString(), madrid('2026-11-26', '08:00').toISOString());
  assert.equal(cuandoEnviar(madrid('2026-11-26', '03:10')).toISOString(), madrid('2026-11-26', '08:00').toISOString());
  const d = madrid('2026-11-26', '12:34');
  assert.equal(cuandoEnviar(d), d);
  assert.ok(enSilencio(23 * 60) && enSilencio(7 * 60 + 59) && !enSilencio(8 * 60) && !enSilencio(22 * 60 + 59));
});

test('preferencias apagadas y aparatos caducados', async () => {
  const b = baseLista();
  ok(b, crear('fregar', semanal([3])));
  ok(b, { tipo: 'avisos.preferencias', hoy: false });
  const { a, sv, recibidos, urlA } = montar(b);
  await a('2026-11-25', '20:00');
  assert.equal(recibidos('a').length, 0);
  ok(b, { tipo: 'avisos.preferencias', hoy: true, horaHoy: '20:30' });
  sv.respuestas[urlA] = 410;
  await a('2026-11-25', '20:30');
  assert.equal(b.suscripciones('a').length, 0, 'el servicio dijo que ya no existe: se olvida');
  assert.equal(b.suscripciones('b').length, 1);
});

test('una semana entera, minuto a minuto: nada de noche, nada repetido, lo esperado', async () => {
  const b = baseLista('2026-11-23');
  ok(b, [
    crear('fregar', semanal([1, 2, 3, 4, 5, 6, 7], { quien: 'cualquiera', puntos: 1 })),
    crear('cena', semanal([1, 3, 5], { quien: 'b', hora: '21:00' })),
    crear('plantas', semanal([2, 6], { quien: 'a', hora: '10:00' })),
  ]);
  ok(b, { tipo: 'avisos.preferencias', manana: true });
  const { c, recibidos, reloj, sv } = montar(b);
  const inicio = madrid(L, '00:00').getTime();
  for (let t = inicio; t < inicio + 7 * 1440 * 60_000; t += 60_000) {
    reloj.t = new Date(t);
    await c.revisar();
  }
  for (const r of b.ultimosAvisos(500).filter((x) => x.enviado)) {
    const m = horaLocal(new Date(r.enviado)).minutos;
    assert.ok(!enSilencio(m), `${r.clave} enviado de noche`);
  }
  const claves = b.ultimosAvisos(500).map((x) => x.clave);
  assert.equal(new Set(claves).size, claves.length);
  const tipos = (q) => recibidos(q).map((d) => d.tag.split('|')[0]).reduce((o, t) => ({ ...o, [t]: (o[t] || 0) + 1 }), {});
  // a: hoy ×7 (fregar cada día), plantas ×2, puntos ×2 (viernes y domingo), mañana ×7 (incluida la del domingo para el lunes)
  assert.deepEqual(tipos('a'), { hoy: 7, hora: 2, puntos: 2, manana: 7 });
  // b: hoy ×7, cena ×3, puntos ×2 (mañana está apagado para b)
  assert.deepEqual(tipos('b'), { hoy: 7, hora: 3, puntos: 2 });
  assert.equal(sv.recibidos.length, 30);
});

/* ---------- API ---------- */
function pedir(puerto, metodo, ruta, { cuerpo, cab = {} } = {}) {
  return new Promise((bien, mal) => {
    const datos = cuerpo === undefined ? null : JSON.stringify(cuerpo);
    const req = request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers: { ...(datos ? { 'Content-Type': 'application/json' } : {}), ...cab } }, (res) => {
      const t = [];
      res.on('data', (x) => t.push(x));
      res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(t).toString()); } catch { /* */ } bien({ codigo: res.statusCode, json: j }); });
    });
    req.on('error', mal);
    if (datos) req.write(datos);
    req.end();
  });
}
const TS = (login) => ({ 'tailscale-user-login': login });

test('API de avisos: suscribirse, probar y quitar, solo lo tuyo y con las protecciones de siempre', async () => {
  const b = baseLista();
  const claves = clavesVapid(join(tmp(), 'vapid.json'));
  const m = movil();
  const url = 'https://fcm.ejemplo.test/x1';
  const sv = servicioFalso(claves, { [url]: m });
  const cartero = new Cartero({ base: b, claves, sujeto: 'https://ejemplo.test', log: () => {}, pedir: sv.pedir });
  const s = crearServidor({ base: b, carpetaWeb: join(AQUI, '../web'), carpetaTmp: join(tmp(), 'tmp'), log: () => {}, cartero });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  const p = s.address().port;
  try {
    assert.equal((await pedir(p, 'GET', '/api/avisos')).codigo, 403);
    assert.equal((await pedir(p, 'GET', '/api/avisos', { cab: TS('otro@x') })).codigo, 403);
    const g = await pedir(p, 'GET', '/api/avisos', { cab: TS('uno@x') });
    assert.deepEqual(g.json, { clave: claves.publica, dispositivos: 0 });
    assert.equal((await pedir(p, 'POST', '/api/avisos/probar', { cab: TS('uno@x'), cuerpo: {} })).codigo, 409);
    const sus = { endpoint: url, keys: m.keys };
    assert.equal((await pedir(p, 'POST', '/api/avisos/suscribir', { cab: { ...TS('uno@x'), 'sec-fetch-site': 'cross-site' }, cuerpo: { suscripcion: sus } })).codigo, 403);
    assert.equal((await pedir(p, 'POST', '/api/avisos/suscribir', { cab: TS('uno@x'), cuerpo: { suscripcion: { ...sus, endpoint: 'http://x.test/a' } } })).codigo, 400);
    assert.equal((await pedir(p, 'POST', '/api/avisos/suscribir', { cab: TS('uno@x'), cuerpo: { suscripcion: { ...sus, keys: { p256dh: 'x', auth: 'y' } } } })).codigo, 400);
    const r = await pedir(p, 'POST', '/api/avisos/suscribir', { cab: TS('uno@x'), cuerpo: { suscripcion: sus, dispositivo: 'iPhone' } });
    assert.deepEqual(r.json, { ok: true, dispositivos: 1 });
    const pr = await pedir(p, 'POST', '/api/avisos/probar', { cab: TS('uno@x'), cuerpo: {} });
    assert.deepEqual(pr.json, { dispositivos: 1, enviados: 1 });
    assert.match(sv.recibidos[0].datos.cuerpo, /Prueba/);
    // Las suscripciones no viajan a los móviles
    const est = await pedir(p, 'GET', '/api/estado', { cab: TS('dos@x') });
    assert.ok(!JSON.stringify(est.json).includes('fcm.ejemplo.test'));
    // Dos no puede quitar el aparato de Uno
    await pedir(p, 'POST', '/api/avisos/quitar', { cab: TS('dos@x'), cuerpo: { endpoint: url } });
    assert.equal(b.suscripciones('a').length, 1);
    const q = await pedir(p, 'POST', '/api/avisos/quitar', { cab: TS('uno@x'), cuerpo: { endpoint: url } });
    assert.equal(q.json.dispositivos, 0);
  } finally { s.close(); }
  // Sin cartero (claves no disponibles) la app sigue funcionando
  const s2 = crearServidor({ base: b, carpetaWeb: join(AQUI, '../web'), carpetaTmp: join(tmp(), 'tmp'), log: () => {} });
  await new Promise((r) => s2.listen(0, '127.0.0.1', r));
  try {
    const p2 = s2.address().port;
    assert.equal((await pedir(p2, 'GET', '/api/avisos', { cab: TS('uno@x') })).json.clave, null);
    assert.equal((await pedir(p2, 'POST', '/api/avisos/suscribir', { cab: TS('uno@x'), cuerpo: { suscripcion: { endpoint: 'https://x.test/1', keys: movil().keys } } })).codigo, 503);
  } finally { s2.close(); }
});
