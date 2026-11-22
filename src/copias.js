// Copias de seguridad: una cada noche (se guardan 30) y una al mes que no se borra nunca.
// Si el portátil estaba apagado a esa hora, se hace en cuanto arranca.
import { readdirSync, unlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const ZONA = 'Europe/Madrid';
export function horaLocal(d = new Date()) {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  const [fecha, hm] = f.split(' ');
  const [h, m] = hm.split(':').map(Number);
  return { fecha, mes: fecha.slice(0, 7), minutos: h * 60 + m };
}

/** Copia diaria (rota a `dias`) y, si es la primera del mes, la mensual en copias/mensual/. */
export function hacerCopias(base, carpeta, { dias = 30, ahora = horaLocal() } = {}) {
  const hechas = [base.copia(join(carpeta, `tareas-${ahora.fecha}.db`))];
  const diarias = readdirSync(carpeta).filter((f) => /^tareas-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of diarias.slice(0, Math.max(0, diarias.length - dias))) unlinkSync(join(carpeta, f));
  const mensual = join(carpeta, 'mensual', `tareas-${ahora.mes}.db`);
  if (!existsSync(mensual)) hechas.push(base.copia(mensual));
  return hechas;
}

export function programar({ base, carpetaCopias, log, hora = 3 * 60 + 30, cadaMs = 60_000 }) {
  let enMarcha = false;
  const revisar = () => {
    const t = horaLocal();
    if (enMarcha || base.meta('tarea_copia') === t.fecha) return;
    // La mensual no espera a la hora: si aún no existe la de este mes, se hace ya
    const faltaMensual = !existsSync(join(carpetaCopias, 'mensual', `tareas-${t.mes}.db`));
    if (t.minutos < hora && !faltaMensual) return;
    const err = JSON.parse(base.meta('tarea_copia_error') || 'null');
    if (err && Date.now() - Date.parse(err.cuando) < 60 * 60_000) return; // tras un fallo, reintenta cada hora
    enMarcha = true;
    try {
      const r = hacerCopias(base, carpetaCopias, { ahora: t });
      if (t.minutos >= hora) base.ponerMeta('tarea_copia', t.fecha);
      base.ponerMeta('tarea_copia_error', null);
      log('Copia hecha:', r.join(', '));
    } catch (e) {
      log('La copia falló: ' + e.message);
      base.ponerMeta('tarea_copia_error', JSON.stringify({ cuando: new Date().toISOString(), error: e.message }));
    } finally {
      enMarcha = false;
    }
  };
  const timer = setInterval(revisar, cadaMs);
  timer.unref();
  setTimeout(revisar, 5000).unref();
  return { parar: () => clearInterval(timer), revisar };
}
