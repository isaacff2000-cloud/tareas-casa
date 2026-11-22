"""La app en dos móviles a la vez (Uno y Dos), con datos inventados y el día fijado.
Uso: python3 test/e2e_app.py      (necesita Python con playwright y Chromium)"""
import asyncio, json, os, re, subprocess, sys, tempfile, time, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUERTO = 8814
URL = f'http://127.0.0.1:{PUERTO}'
NODE = ['node', '--disable-warning=ExperimentalWarning', os.path.join(RAIZ, 'src/cli.js')]
UNO, DOS = 'uno@ejemplo.test', 'dos@ejemplo.test'
L = '2026-11-23'  # lunes de la semana de prueba
ok = 0
PAGINAS = {}  # para guardar capturas si algo falla


def comprobar(cond, msg):
    global ok
    if not cond:
        raise AssertionError(msg)
    ok += 1
    print('  ✓', msg)


def api(ruta, datos=None, quien=UNO):
    req = urllib.request.Request(URL + ruta, data=json.dumps(datos).encode() if datos is not None else None,
                                 headers={'Content-Type': 'application/json', 'x-quien': quien})
    return json.load(urllib.request.urlopen(req))


async def esperar(cond, ms=5000):
    t = time.time()
    while time.time() - t < ms / 1000:
        r = cond()
        if asyncio.iscoroutine(r):
            r = await r
        if r:
            return True
        await asyncio.sleep(0.1)
    return False


def arrancar(datos, hoy):
    env = {**os.environ, 'TAREAS_DATOS': datos, 'PUERTO': str(PUERTO), 'TAREAS_PRUEBAS': '1', 'TAREAS_HOY': hoy}
    srv = subprocess.Popen(NODE + ['servir'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(URL + '/api/salud'); break
        except Exception:
            time.sleep(0.1)
    return srv


async def hay(loc, n):
    return await loc.count() == n


def tarea(pg, nombre):
    return pg.locator('.tarea', has=pg.locator('strong', has_text=re.compile('^' + re.escape(nombre) + '$')))


async def hecha(pg, nombre):
    return await tarea(pg, nombre).last.locator('.marcar.si').count() == 1


async def capturas():
    carpeta = os.environ.get('E2E_CAPTURAS') or tempfile.mkdtemp()
    for nombre, pg in PAGINAS.items():
        try:
            await pg.screenshot(path=os.path.join(carpeta, nombre + '.png'), full_page=True)
        except Exception:
            pass
    print('Capturas en', carpeta)


async def main():
    from playwright.async_api import async_playwright
    datos = tempfile.mkdtemp()
    srv = arrancar(datos, '2026-11-25')
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            errores = []

            async def movil(quien, hora='2026-11-25T12:00:00', sw='block'):
                ctx = await b.new_context(viewport={'width': 390, 'height': 844}, extra_http_headers={'x-quien': quien}, service_workers=sw)
                pg = await ctx.new_page()
                pg.on('pageerror', lambda e: errores.append(f'{quien}: {e}'))
                pg.on('console', lambda m: errores.append(f'{quien}: {m.text}') if m.type == 'error' or 'Content Security Policy' in m.text else None)
                await pg.clock.set_fixed_time(hora)
                await pg.goto(URL)
                PAGINAS[quien.split('@')[0] + ('-' + sw if sw != 'block' else '')] = pg
                return ctx, pg

            try:
                cu, uno = await movil(UNO)
                cd, dos = await movil(DOS)

                print('Alta')
                await uno.get_by_placeholder('Persona 1').fill('Uno')
                await uno.get_by_role('button', name='Soy Uno').click()
                await uno.wait_for_selector('.pestanas')
                async def solo_dos():
                    return await dos.get_by_role('button', name='Soy Uno').count() == 0 and await dos.get_by_placeholder('Persona 2').count() == 1
                comprobar(await esperar(solo_dos), 'Dos ya solo puede elegir el hueco libre, sin recargar')
                await dos.get_by_placeholder('Persona 2').fill('Dos')
                await dos.get_by_role('button', name='Soy Dos').click()
                await dos.wait_for_selector('.pestanas')
                comprobar(await dos.get_by_text('Aún no hay tareas').count() == 1, 'Empieza vacía e invita a crear la primera tarea')

                print('Crear una tarea desde el móvil')
                await uno.get_by_role('button', name='Nueva tarea').click()
                await uno.get_by_placeholder('Ej. Limpiar el baño').fill('Limpiar el baño')
                await uno.get_by_role('button', name='5', exact=True).click()
                await uno.locator('.hoja').get_by_role('button', name='Dos', exact=True).click()
                await uno.get_by_role('button', name='Cada semana').click()
                await uno.get_by_role('button', name='sábado').click()  # miércoles (hoy) ya está marcado
                comprobar(await uno.get_by_role('button', name='miércoles').get_attribute('aria-pressed') == 'true', 'La tarea nueva propone el día de hoy')
                await uno.get_by_role('button', name='Crear tarea').click()
                comprobar(await esperar(lambda: tarea(dos, 'Limpiar el baño').count()), 'A Dos le aparece la tarea de Uno sin recargar')
                await dos.get_by_role('button', name='Semana', exact=True).click()
                sab = dos.locator('.dia', has=dos.locator('h2', has_text='sábado 28'))
                comprobar(await sab.locator('.tarea', has_text='Limpiar el baño').count() == 1, 'Se repite también el sábado')
                comprobar(await dos.locator('.dia', has=dos.locator('h2', has_text='lunes 23')).locator('.tarea').count() == 0, 'No aparece en días anteriores a su creación')
                await dos.get_by_role('button', name='Semana siguiente').click()
                comprobar(await dos.locator('.dia .tarea', has_text='Limpiar el baño').count() == 2, 'Y la semana siguiente, miércoles y sábado')
                await dos.get_by_role('button', name='Ir a esta semana').click()
                await dos.get_by_role('button', name='Hoy', exact=True).click()

                # Más tareas, por la API (igual que haría otro móvil)
                def crear(i, nombre, puntos, quien, dias, hora=None):
                    return {'id': 'c' + i, 'tipo': 'tarea.crear', 'tarea': {'id': i, 'nombre': nombre, 'emoji': '🧽'}, 'inicio': L,
                            'version': {'puntos': puntos, 'quien': quien, 'hora': hora, 'rep': {'tipo': 'semanal', 'dias': dias, 'cada': 1, 'ancla': L}}}
                r = api('/api/ops', {'ops': [crear('fregar', 'Fregar', 1, 'cualquiera', [1, 2, 3, 4, 5, 6, 7]), crear('basura', 'Basura', 1, 'a', [1, 3]),
                                             crear('cena', 'Cena', 2, 'ambos', [3], '21:00')]})
                comprobar(all(x['ok'] for x in r['resultados']), 'La API acepta tareas nuevas')
                r = api('/api/ops', {'ops': [crear('fregar', 'Fregar', 1, 'cualquiera', [1])]})
                comprobar(r['resultados'][0].get('repetida'), 'La misma operación enviada dos veces se aplica una sola vez')
                comprobar(await esperar(lambda: tarea(uno, 'Basura').count()), 'Las tareas nuevas llegan solas')
                comprobar(await tarea(uno, 'Basura').first.locator('.atr').count() == 1, 'La basura del lunes sale como atrasada')
                horas = await uno.locator('.dia, section').filter(has_text='Cena').locator('.tarea strong').all_inner_texts()
                comprobar('Cena' in horas, 'La cena de las 21:00 sale hoy')

                print('Metas y semáforo')
                await uno.get_by_role('button', name='Ajustes').click()
                for etiqueta, v in [('🛵 Domicilio', '3'), ('🍻 Salir', '9'), ('Mínimo c/u', '1')]:
                    await uno.get_by_label(etiqueta).fill(v)
                await uno.get_by_role('button', name='Guardar metas desde esta semana').click()
                await uno.get_by_role('button', name='Cerrar', exact=True).click()
                comprobar(await esperar(lambda: dos.locator('.cab-sem', has_text='/ 9').count()), 'Las metas nuevas le llegan a Dos')

                await tarea(uno, 'Basura').last.locator('.marcar').click()  # la de hoy
                comprobar(await esperar(lambda: hecha(dos, 'Basura')), 'Lo que marca Uno le aparece hecho a Dos')
                comprobar(await uno.locator('.aviso', has_text='«Basura» hecha · +1').count() == 1, 'Aviso con los puntos y «Deshacer»')
                await tarea(uno, 'Cena').locator('.marcar').click()  # de los dos: suma a los dos
                comprobar(await esperar(lambda: dos.locator('.premio.si', has_text='Pedir a domicilio').count()), 'Con la meta y el mínimo de cada uno, se desbloquea pedir a domicilio')
                comprobar(await dos.locator('.premio.si', has_text='Salir').count() == 0, 'Salir sigue bloqueado')
                comprobar(await dos.locator('.minimos').inner_text() == 'Mínimo 1 cada uno:\nU\n3 ✓\nD\n2 ✓', 'Cada uno ve los puntos de los dos (3 y 2)')

                print('Devolver')
                await tarea(dos, 'Cena').locator('.marcar').click()  # la marcó el otro: abre la hoja
                await dos.get_by_placeholder('Ej. falta el baño de arriba').fill('falta recoger la mesa')
                await dos.get_by_role('button', name=re.compile('Devolver a pendiente')).click()
                comprobar(await esperar(lambda: tarea(uno, 'Cena').locator('.dev', has_text='Dos: falta recoger la mesa').count()), 'Uno ve la tarea devuelta con la nota')
                comprobar(await esperar(lambda: hay(uno.locator('.premio.si'), 0)), 'Al devolverla se vuelve a bloquear')

                print('Escribir sin que se borre')
                await uno.get_by_role('button', name='Nueva tarea').click()
                caja = uno.get_by_placeholder('Ej. Limpiar el baño')
                await caja.fill('Regar las pla')
                await tarea(dos, 'Fregar').first.locator('.marcar').click()
                await uno.wait_for_timeout(800)
                comprobar(await caja.input_value() == 'Regar las pla', 'Lo que Uno está escribiendo no se borra cuando Dos cambia algo')
                await uno.keyboard.press('Escape')

                print('Solo esta vez')
                await dos.get_by_role('button', name='Detalles de Limpiar el baño').first.click()
                await dos.get_by_role('button', name='Cambiar día, hora o persona').click()
                await dos.get_by_role('button', name='viernes 27').click()
                await dos.get_by_role('button', name='A una hora').click()
                await dos.get_by_label('Hora', exact=True).last.fill('18:30')
                await dos.get_by_role('button', name='Guardar esta vez').click()
                await uno.get_by_role('button', name='Semana', exact=True).click()
                vie = uno.locator('.dia', has=uno.locator('h2', has_text='viernes 27'))
                comprobar(await esperar(lambda: vie.locator('.tarea', has_text='Limpiar el baño').count()), 'La tarea movida aparece el viernes en el móvil de Uno')
                comprobar('18:30' in await vie.locator('.tarea', has_text='Limpiar el baño').inner_text(), 'Con su hora de esta vez')
                await uno.get_by_role('button', name='Semana siguiente').click()
                comprobar(await uno.locator('.dia', has=uno.locator('h2', has_text='miércoles 2')).locator('.tarea', has_text='Limpiar el baño').count() == 1, 'La semana siguiente sigue en su día')
                await uno.get_by_role('button', name='Ir a esta semana').click()
                await uno.get_by_role('button', name='Detalles de Basura').first.click()
                await uno.get_by_role('button', name='Esta semana no toca').click()
                comprobar(await uno.locator('.tarea.saltada', has_text='Basura').count() == 1, 'Saltada esta semana')
                await uno.locator('.aviso').get_by_role('button', name='Deshacer').click()
                comprobar(await esperar(lambda: hay(uno.locator('.tarea.saltada'), 0)), '«Deshacer» la vuelve a poner')

                print('Sin cobertura')
                await cd.set_offline(True)
                await dos.wait_for_timeout(300)
                await dos.get_by_role('button', name='Semana', exact=True).click()
                jue = dos.locator('.dia', has=dos.locator('h2', has_text='jueves 26'))
                await jue.locator('.tarea', has_text='Fregar').locator('.marcar').click()
                comprobar(await esperar(lambda: dos.locator('.sinc', has_text='1 por enviar').count()), 'Sin conexión: el cambio se ve y queda pendiente de enviar')
                cola = json.loads(await dos.evaluate("localStorage.getItem('tareas.cola')"))
                comprobar(len(cola) == 1 and cola[0]['tipo'] == 'aparicion.hecha', 'El cambio queda guardado en el móvil por si se cierra la app')
                await cd.set_offline(False)
                await dos.evaluate('dispatchEvent(new Event("online"))')
                jue_uno = uno.locator('.dia', has=uno.locator('h2', has_text='jueves 26')).locator('.tarea', has_text='Fregar')
                comprobar(await esperar(lambda: jue_uno.locator('.marcar.si').count(), 8000), 'Al volver la red, a Uno le llega lo marcado sin cobertura')

                print('Los dos marcan la misma a la vez')
                await cu.set_offline(True); await cd.set_offline(True)
                await uno.wait_for_timeout(300)
                for pg in (uno, dos):
                    await pg.locator('.dia', has=pg.locator('h2', has_text='viernes 27')).locator('.tarea', has_text='Fregar').locator('.marcar').click()
                await cu.set_offline(False); await cd.set_offline(False)
                for pg in (uno, dos):
                    await pg.evaluate('dispatchEvent(new Event("online"))')
                async def iguales():
                    t = []
                    for pg in (uno, dos):
                        t.append(await pg.locator('.dia', has=pg.locator('h2', has_text='viernes 27')).locator('.tarea', has_text='Fregar').inner_text())
                    return t[0] == t[1] and 'hecha por' in t[0] and not await pg.locator('.sinc', has_text='enviar').count()
                comprobar(await esperar(iguales, 8000), 'Los dos móviles acaban viendo lo mismo (vale la primera)')
                estado = api('/api/estado')
                comprobar(len(estado['datos']['apariciones'][L]['fregar|2026-11-27']['hecha']['por']) == 1, 'Y en el servidor queda hecha una sola vez')

                print('App instalada sin red')
                ci, ins = await movil(UNO, sw='allow')
                await ins.wait_for_selector('.pestanas')
                await ins.evaluate('navigator.serviceWorker.ready')
                await ins.reload(); await ins.wait_for_selector('.pestanas')
                await ci.set_offline(True)
                await ins.reload()
                comprobar(await esperar(lambda: ins.locator('.semaforo').count()), 'La app instalada abre sin red con lo último que tenía')
                await ci.close()

                print('Semana cerrada')
                await cu.close(); await cd.close()
                srv.terminate(); srv.wait()
                srv = arrancar(datos, '2026-12-02')
                cu, uno = await movil(UNO, hora='2026-12-02T10:00:00')
                await uno.wait_for_selector('.pestanas')
                await uno.get_by_role('button', name='Semana', exact=True).click()
                await uno.get_by_role('button', name='Semana anterior').click()
                comprobar(await uno.get_by_text('Semana cerrada: ya no se puede cambiar.').count() == 1, 'La semana del 23 ya está cerrada el miércoles siguiente')
                comprobar(await uno.locator('.marcar:not([disabled])').count() == 0, 'Y no se puede marcar nada')
                comprobar(await uno.locator('.premio small', has_text='Conseguido ✓').count() == 1 and await uno.locator('.premio small', has_text='No conseguido').count() == 1,
                          'Muestra qué se consiguió y qué no')
                comprobar(await uno.get_by_role('button', name='Nueva tarea').count() == 0, 'Ni añadir tareas')
                r = api('/api/ops', {'ops': [{'tipo': 'aparicion.hecha', 'aparicion': 'fregar|2026-11-29', 'hechaPor': ['a'], 'dia': '2026-11-29'}]})
                comprobar('cerrada' in r['resultados'][0]['error'], 'El servidor también la da por cerrada')

                # Los fallos de red mientras se simula «sin cobertura» son esperados
                reales = [x for x in errores if 'Failed to load resource' not in x and 'ERR_INTERNET_DISCONNECTED' not in x]
                comprobar(not reales, 'Sin errores en la consola ni avisos de la política de seguridad: ' + '; '.join(reales))
            except Exception:
                await capturas()
                raise
            await b.close()
    finally:
        srv.terminate()
    print(f'\n{ok} comprobaciones correctas')


asyncio.run(main())
