// Web Push sin dependencias (solo node:crypto):
//  · cifrado del mensaje con «aes128gcm» (RFC 8291 y RFC 8188), para que el servicio de avisos del móvil
//    (Apple o Google) lo lleve sin poder leerlo
//  · firma VAPID (RFC 8292) con las claves propias del portátil, sin cuentas ni registros
import { createECDH, createCipheriv, createPrivateKey, generateKeyPairSync, hkdfSync, randomBytes, sign } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const b64u = (buf) => Buffer.from(buf).toString('base64url');
export const deB64u = (s) => Buffer.from(String(s), 'base64url');
const hkdf = (ikm, salt, info, n) => Buffer.from(hkdfSync('sha256', ikm, salt, info, n));

/**
 * Cifra `texto` para una suscripción (p256dh y auth del navegador, en base64url).
 * `prueba` (solo en las pruebas) fija la sal y la clave efímera para comparar con el ejemplo del RFC 8291.
 */
export function cifrar(texto, { p256dh, auth }, prueba = {}) {
  const uaPublica = deB64u(p256dh), secreto = deB64u(auth);
  if (uaPublica.length !== 65 || uaPublica[0] !== 4) throw new Error('Clave p256dh no válida');
  if (secreto.length !== 16) throw new Error('Secreto auth no válido');
  const efimera = createECDH('prime256v1');
  if (prueba.privada) efimera.setPrivateKey(deB64u(prueba.privada)); else efimera.generateKeys();
  const asPublica = efimera.getPublicKey();
  const compartido = efimera.computeSecret(uaPublica);
  const sal = prueba.sal ? deB64u(prueba.sal) : randomBytes(16);
  // RFC 8291 §3.3–3.4
  const ikm = hkdf(compartido, secreto, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublica, asPublica]), 32);
  const cek = hkdf(ikm, sal, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(ikm, sal, Buffer.from('Content-Encoding: nonce\0'), 12);
  // Un solo registro: el texto y el delimitador 0x02 de «último registro», sin relleno
  const claro = Buffer.concat([Buffer.from(texto, 'utf8'), Buffer.from([2])]);
  if (claro.length > 3993) throw new Error('Aviso demasiado largo');
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const cifrado = Buffer.concat([c.update(claro), c.final(), c.getAuthTag()]);
  // Cabecera RFC 8188: sal (16) · tamaño de registro (4) · longitud de la clave (1) · clave efímera (65)
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([sal, rs, Buffer.from([asPublica.length]), asPublica, cifrado]);
}

/** Claves VAPID del portátil: se crean la primera vez y se guardan en `ruta` (solo legible por el servicio). */
export function clavesVapid(ruta) {
  if (existsSync(ruta)) {
    const jwk = JSON.parse(readFileSync(ruta, 'utf8'));
    return deJwk(jwk);
  }
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = privateKey.export({ format: 'jwk' });
  mkdirSync(dirname(ruta), { recursive: true, mode: 0o700 });
  writeFileSync(ruta, JSON.stringify(jwk), { mode: 0o600, flag: 'wx' });
  return deJwk(jwk);
}
function deJwk(jwk) {
  const privada = createPrivateKey({ key: jwk, format: 'jwk' });
  const publica = b64u(Buffer.concat([Buffer.from([4]), deB64u(jwk.x), deB64u(jwk.y)]));
  return { privada, publica };
}

/** Cabecera Authorization de VAPID para el servicio de avisos de `endpoint`. */
export function cabeceraVapid(endpoint, { privada, publica }, { sujeto, ahora = Date.now() } = {}) {
  const aud = new URL(endpoint).origin;
  const cab = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const cuerpo = b64u(JSON.stringify({ aud, exp: Math.floor(ahora / 1000) + 12 * 3600, sub: sujeto }));
  const firma = sign('sha256', Buffer.from(`${cab}.${cuerpo}`), { key: privada, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${cab}.${cuerpo}.${b64u(firma)}, k=${publica}`;
}

/**
 * Envía un aviso. Devuelve el código HTTP del servicio de avisos (201 = aceptado; 404/410 = suscripción caducada).
 * `pedir` es fetch (las pruebas ponen uno falso).
 */
export async function enviar(sus, datos, claves, { sujeto, ttl = 4 * 3600, urgencia = 'normal', tema = null, pedir = fetch, tiempo = 15_000 } = {}) {
  const u = new URL(sus.endpoint);
  if (u.protocol !== 'https:') throw new Error('El servicio de avisos tiene que ser https');
  const cuerpo = cifrar(JSON.stringify(datos), sus);
  const cab = {
    TTL: String(ttl), Urgency: urgencia, 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
    Authorization: cabeceraVapid(sus.endpoint, claves, { sujeto }),
  };
  if (tema) cab.Topic = tema.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const r = await pedir(sus.endpoint, { method: 'POST', headers: cab, body: cuerpo, signal: AbortSignal.timeout(tiempo) });
  return r.status;
}
