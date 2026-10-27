# CERCO 0.8.1 — beta pública preparada localmente

Estado: implementación y pruebas locales completas; publicación no ejecutada.
No se han realizado push, despliegues, escrituras D1 remotas ni compras.
Las operaciones 34/35/36 y sus 37 casos siguen ejecutándose. Se conservan sus commits
`81d8906`, `27bc286`, `a019e64`, sin rebase, amend ni cambios de historial.

## Alcance entregado

- Juego 0.8.1 con skins oficiales. 0.8.0 permanece intacto como respaldo.
- Sesiones e informes compatibles con ambas versiones, ligando versión de auditoría
  a versión de partida. Idempotencia, cierre atómico, abandono, caducidad de 72 horas
  y outbox local de operación 36 conservados. No se crean resultados verificados.
- Shop y Skins existentes: miniaturas Original y Void Circuit, previews del propio
  renderizador, inventario de Original y equipamiento autorizado por servidor.
- Chat público entre navegadores: WebSocket, invitados emitidos por servidor,
  hora de servidor, iniciales circulares, mensajes propios, emojis, reconexión,
  denuncias, eliminación, bloqueo y pausa inmediata por moderación.
- Botón de volumen junto a reproducción, popup ocultable, mute y preferencias
  persistentes; Escape, foco y disposición de pantallas pequeñas comprobados.
- Avisos visibles sobre almacenamiento, informes no verificados y reglas del chat.

## Handoff y conservación

Se inspeccionaron los ocho miembros de `CERCO_0.8.1_SKINS_HANDOFF.zip` en Descargas:
lista exacta, rutas sin escape, sin duplicados/symlinks, tamaños acotados, CRC y
coincidencia binaria del HTML suelto. Ningún script del ZIP se ejecutó al inspeccionarlo.
El documento de skins, catálogo y adaptador se leyeron íntegros.

Copias/auditoría en `.local-recovery/beta081/`; copias anteriores a las modificaciones
en `before/`. Handoff de referencia y hashes en `docs/handoff/cerco-0.8.1/`.
Los PNG y el catálogo coinciden con la entrega. El único cambio al HTML entregado
es un bloque CSS que oculta el HUD sobre modales en pantallas menores de 600 px.
Scripts, renderizado oficial, estadísticas, puntuación y reglas de la entrega
permanecen idénticos. `tests/handoff.test.cjs` verifica esta propiedad.

Contrato: `cerco.default`, `cerco.void_circuit`, `cerco.skins.v1`, protocolo 1,
`cerco.audit.v1`, ruleset `CERCO-0.7.0`. El adaptador comprueba ventana emisora,
origen, protocolo, requestId, tipo de respuesta y consulta; usa destino explícito
y limita peticiones pendientes. Nunca se interpreta `skin_changed` como una compra.

## Economía: bloqueo deliberado

No hay infraestructura operativa de cuentas, saldo o compras en este repositorio.
No se accedió a otros proyectos para inventar una integración.

`GET /skins/inventory` devuelve `authenticated:false`, solo `cerco.default`,
`purchasesAvailable:false`. `POST /skins/equip` acepta únicamente Original y
`POST /skins/purchase` devuelve 503. Void permanece visible y bloqueada como
"Purchase coming soon", sin precio, moneda, saldo ficticio ni propiedad en localStorage.
El juego conserva su API cosmética local de desarrollo: cambiar su propia apariencia
desde consola no otorga propiedad ni beneficios. La autorización económica futura
deberá verificarse en servidor con cuenta real, CSRF, transacción y unicidad de compra.

## Chat: elección y límites

Se elige un Durable Object SQLite con WebSocket Hibernation para una sala pública.
Un solo coordinador permite ordenar y deduplicar escrituras. Frente a sondear D1
por cada visitante, elimina consultas periódicas de historial y reduce latencia
de entrega. Hibernación evita mantener tiempo de ejecución activo durante el ocio.
No se promete coste cero ni una latencia geográfica medida. El despliegue debe
confirmar plan/cuotas de Cloudflare y presupuesto antes de abrir el servicio.

Límites implementados:

| Recurso | Límite |
|---|---|
| Sala | Una, fijada en servidor; sin nombres arbitrarios del cliente |
| Conexiones | 128 totales, 8 sin autenticar, 2 por identidad |
| Autenticación inicial | Diez segundos; token en primer frame, nunca en URL |
| Identidades | 256 activas; diez altas por IP/hora; caducan en dos horas |
| Conexiones nuevas | Sesenta por IP/hora |
| Mensaje | 300 unidades UTF-16, sin caracteres de control/bidi; frames hasta 2 KiB |
| Envíos nuevos | Un mensaje cada dos segundos; diez por invitado/minuto; treinta por IP/minuto; 120 por sala/minuto |
| Frames por conexión | Treinta por minuto, también para duplicados/denuncias |
| Historial | Últimos cien mensajes, máximo 24 horas |
| Denuncias | Cinco por invitado, cien totales, máximo 24 horas |
| Bloqueos | 24 horas, por participante y hash de IP; máximo 256 claves |
| Buckets de red | 512, con retención máxima de 24 horas |
| Dedupe | Ocho acuses recientes por invitado más secuencia monótona; una secuencia antigua nunca vuelve a insertar |
| Cliente | Cuatro intentos por mensaje pendiente y cinco reconexiones automáticas, sin bucle ilimitado |

La identidad `Guest <sufijo>` y su ID proceden del servidor; el nombre de perfil
local no se usa como identidad pública. No se muestran insignias de cuenta
verificada ni imágenes remotas. El token opaco se guarda hasheado en el servidor
y solo en memoria de la pestaña durante su vigencia. Recargar inicia una identidad
nueva; la reconexión en la misma página conserva identidad y mensaje pendiente.

El servidor ignora nombres, avatar, ID de participante, hora y atributos verified
enviados por el navegador. La UI usa textContent para texto, nombres y etiquetas.
Solo utiliza iniciales locales para avatares. La selección de emojis se mantiene.
Se retira el historial local anterior; no hay fallback que simule chat público.

Las escrituras del objeto se coordinan antes de emitir acuses. El estado y los
attachments permiten reconstrucción tras hibernación. Las alarmas limpian caducados
y sesiones no autenticadas; no hay intervalos periódicos en un objeto inactivo.
Se persisten límites antes de responder. Borrar un mensaje no permite resucitarlo
reintentando el clientId. Los cuerpos HTTP se leen con límites antes de decodificar
o parsear; no se reserva memoria proporcional a un body sin límite declarado.

Son controles para una beta limitada, no una protección DDoS completa. Deben
revisarse límites de cuenta/WAF al crecer el tráfico. El bloqueo por IP puede
afectar a participantes que compartan red. El objeto único no es un diseño para
salas ilimitadas: al alcanzar capacidad rechaza altas y conserva el resto del juego.

## Moderación y privacidad operativa

El chat público queda **habilitado por defecto** (`CHAT_ENABLED=true`) y no requiere
un moderador humano conectado para que los invitados conversen. El
`CHAT_MODERATION_TOKEN` autentica operaciones administrativas; no representa una
persona presente. La sala solo se detiene por una pausa administrativa explícita.
El cliente distingue esa pausa de los errores temporales de red, reintenta con
backoff limitado y consulta de nuevo al recuperar Internet o primer plano. Si la
API o su secreto de servicio faltan, informa indisponibilidad temporal y reintenta,
sin simular mensajes locales. El secreto no va en Git, HTML, localStorage, capturas
ni URLs.

La API `/chat/moderation` exige Bearer y permite listar mensajes/denuncias/bloqueos,
retirar un mensaje, bloquear participante/IP y pausar/reanudar la sala. No hay una
interfaz administrativa expuesta en la web. Ejemplos para operador autorizado:

```powershell
# CERCO_CHAT_MODERATION_TOKEN debe estar previamente cargado en el entorno seguro.
node tools/moderate-chat.mjs list
node tools/moderate-chat.mjs delete <message-uuid> --apply
node tools/moderate-chat.mjs ban <participant-uuid> --apply
node tools/moderate-chat.mjs pause --apply
node tools/moderate-chat.mjs resume --apply
```

Estos comandos NO se han ejecutado contra producción. `--apply` es una protección
de uso, no sustituye la autorización. Pausar cierra sockets existentes y bloquea
nuevas conexiones. Bajar CHAT_ENABLED impide altas y mensajes; los sockets abiertos
se cierran al enviar o al vencer su alarma. La pausa explícita es el cierre inmediato.
Eliminar mensajes y bans no afecta partidas, inventarios, EXP o puntuaciones.

El aviso de la web describe flujos técnicos reales. Antes de apertura se debe
designar responsable/moderador y un contacto real de privacidad/abuso, revisar los
avisos y las obligaciones aplicables al operador y fijar cobertura de moderación.
No se afirma cumplimiento jurídico automático. Cloudflare sigue procesando datos
de red conforme a su configuración y políticas; los hashes de IP son seudónimos,
no datos anónimos. D1 conserva los informes no verificados según la política existente;
esta entrega no introduce un borrado ni inventa su periodo de conservación.

## Validación reproducible

Node 24, Playwright 1.64.1, Miniflare 5.20261019.1-beta; dependencias fijadas por lockfile.

```powershell
npm.cmd ci --ignore-scripts --no-audit --no-fund
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD\.local-recovery\browsers"
node node_modules/playwright/cli.js install chromium
npm.cmd test
node tests/browser-smoke.cjs
git diff --check
git fsck --full
```

Resultado local: **49 pruebas automatizadas aprobadas, cero fallidas**, incluidas
las 37 originales; seis grupos funcionales de Chromium aprobados en contextos
independientes, tamaños 1366×900, 820×700 y 390×844, y cero excepciones JS de página.
El navegador mantiene su sandbox (`chromiumSandbox:true`). En este entorno la
creación de páginas necesitó autorización limitada de ejecución de ese arnés.

Se verifican API antigua/nueva, rechazo de versiones mezcladas, invariancia de filas,
streaming acotado, idempotencia, duplicados/carreras, retención y reconstrucción de
chat, cuotas concurrentes, moderación y pausa, XSS como texto, skins y procedencia,
controles musicales y recuperación 0.8.1 después de respuesta perdida y recarga real.
Para finalizar un informe en el smoke test se emite el evento terminal con el informe
del bridge: no es un ensayo de una expedición completa ni un verificador antitrampas.
La prueba compara antes/después la fila D1 para confirmar que no se duplica ni altera.

HTTP y WebSocket del navegador se interceptan hacia Miniflare local con D1/DO efímeros;
no se toca producción. No es una medición de red global ni sustituye el smoke test
posterior al despliegue. No se han probado Safari/Firefox ni control táctil del juego:
el motor entregado requiere teclado/ratón; la adaptación móvil es de disposición visual.
No se ha realizado una prueba de carga pública a capacidad máxima.

Capturas y resultados: `.local-recovery/beta081/screenshots/` y `browser-results.json`.
Los fallos de entorno/selectores del arnés encontrados durante la ejecución están
corregidos; no quedan pruebas fallidas en la batería final.

## Estado remoto comprobado, sin escrituras

GitHub remoto `main=c3e4bb37cf0f20e3dbbb62d93a6411821528d693`. Pages: tipo legacy,
origen `main:/`, `cerco.atanatus.com`, workflow dinámico `pages-build-deployment` activo,
sin otros workflows ni webhooks de repositorio. Un push de toda la rama publicaría
la interfaz automáticamente. No se interpreta ausencia de hooks como ausencia de Apps externas.

Worker activo observado: `7f3d5f22-0f94-4a79-9100-879dd1d449e7`, 100 % del tráfico.
Cron `0 */6 * * *`. El binding D1 actual se conserva.
Cloudflare Workers Builds y deploy hooks siguen devolviendo 403/10000 con la sesión
disponible. Hace falta lectura autorizada de Settings > Builds y sus comandos/rutas
antes de cualquier push. No se ha creado una credencial con permisos más amplios.

## Publicación agrupada — requiere autorización explícita

**La siguiente secuencia reemplaza el plan antiguo de publicar primero commits a main.**
La rama ya contiene frontend en commits intermedios. Se despliega primero el backend
desde un artefacto aislado y no se hace ningún push hasta que sea compatible y estable.

1. Revalidar remoto, árbol limpio, pruebas, cuotas/plan, artefactos y automatismos de
   Cloudflare con acceso de lectura suficiente. Resolver cualquier discrepancia.
   Designar moderador/contacto y revisar avisos. La falta de economía no bloquea la beta.
2. Preparar o comprobar artefactos locales:

```powershell
node tools/prepare-beta-release.cjs
```

   Código backend fijado en `e921083`, archivos y SHA-256 en
   `.local-recovery/beta081/release-e921083/manifest.json`. Ningún HTML ni token en el artefacto.
   Se han compilado mediante `--dry-run` el Worker actual y el compatible de reversión.
3. **Primera escritura autorizada:** desplegar únicamente el backend compatible,
   con chat todavía desactivado:

```powershell
wrangler.cmd deploy --config .local-recovery/beta081/release-e921083/worker/wrangler.jsonc --autoconfig=false --keep-vars --tag cerco-beta-081 --message "CERCO 0.8.1 compatible API; chat held"
```

   Esta operación crea el namespace/clase SQLite `PublicChat` mediante la migración
   Durable Object `chat-v1`: requiere aprobación de recursos/costes. **No es una
   migración D1**. No ejecutar ningún comando de migración o mantenimiento de D1.
   Registrar version ID y conservar artefactos. Comprobar salud, CORS, cron y bindings;
   chat debe devolver 503 y el frontend público debe seguir en 0.8.0.
4. Pruebas de escritura **solo si se incluyen en la autorización**: sesiones sintéticas
   nuevas 0.8.0 y 0.8.1, informe 201/duplicado 200/alterado 409/token ajeno 403,
   abandono duplicado y cierre correcto. No probar alteraciones sobre partidas reales,
   no marcar verified y no borrar luego esas filas para "limpiar" la producción.
5. Solo después de validar backend, aprobar la publicación del frontend. Capturar
   el SHA final revisado y publicarlo mediante fast-forward, sin tags ni force:

```powershell
$betaCommit = git rev-parse HEAD
git diff --exit-code e921083 HEAD -- backend/worker
# Revalidar main remoto antes de la siguiente instrucción; detenerse si cambió.
git -c push.followTags=false push origin "${betaCommit}:refs/heads/main"
```

   Esta es una operación de producción: Pages publica automáticamente. Todos los
   commits antiguos y nuevos conservan su orden. Esperar el build del SHA exacto y
   comprobar el contenido del JS servido, no solo un HTTP 200; la caché observada
   previamente era de 600 segundos. Comprobar juego, menús, música e inventario.
   Si Cloudflare también tiene integración con main, su comportamiento y comandos
   deben estar revisados previamente; no permitir migraciones o despliegues inesperados.
6. Para abrir chat, aprobar provisión segura de un secreto aleatorio fuerte
   `CHAT_MODERATION_TOKEN` y su entrega al operador fuera del repositorio/logs.
   Configurarlo con el mecanismo de secretos de Cloudflare y verificar moderación.
   Nunca guardar una clave en un archivo que Pages pueda servir. Activar después:

```powershell
wrangler.cmd deploy --config .local-recovery/beta081/release-e921083/worker/wrangler.jsonc --autoconfig=false --keep-vars --var CHAT_ENABLED:true --tag cerco-beta-081-chat --message "CERCO moderated guest chat enabled"
```

   Probar con dos navegadores y mensajes sintéticos: cruce, reconexión, doble envío,
   denuncia, retirada, ban y pausa/reanudación. Estas escrituras en Durable Object
   también requieren aprobación. Abrir al público solo con moderador y cobertura reales.
   Si no está listo, mantener la beta jugable con chat explícitamente no disponible.
7. Vigilar errores, capacidad, presupuesto y denuncias, sin registrar tokens ni
   informes completos. No habilitar compras, vinculación de cuentas ni rankings oficiales.

Autorización agrupada solicitada: despliegue del backend/creación de DO, pruebas
sintéticas D1, push que activa Pages, secreto/activación/pruebas de chat y reversión
de contingencia. Puede aprobarse por etapas; ninguna está ejecutada en esta sesión.

La preparación posterior de Shop, disponibilidad del chat y consola de moderación
del propietario se documenta en [Operación 38](OPERATION_38_SHOP_CHAT.md).
Su apertura requiere una nueva autorización específica de producción.

## Reversión sin perder datos

- Chat: `pause --apply` cierra la sala inmediatamente; después desplegar con
  `--var CHAT_ENABLED:false` para mantener el cierre. Conservar mensajes/bans según
  sus caducidades; no eliminar namespace ni datos para revertir código.
- Si el backend de chat falla, está preparado y probado el artefacto
  `release-e921083/rollback-worker/`: API compatible basada en `db9e134`, lectura de
  cuerpos acotada y chat 503, conservando export de PublicChat, binding y tag de migración.
  Publicarlo solo con autorización:

```powershell
wrangler.cmd deploy --config .local-recovery/beta081/release-e921083/rollback-worker/wrangler.jsonc --autoconfig=false --keep-vars --message "CERCO compatible rollback; chat disabled"
```

- No utilizar sin revisión un rollback a `7f3d5f22`/c3e4bb3: no aceptaría informes
  0.8.1 pendientes y los cambios de clase DO pueden impedir esa reversión. El
  artefacto compatible preserva informes de ambas versiones y los recursos nuevos.
- Frontend: crear un nuevo commit de corrección; nunca resetear ni forzar main.
  Se puede devolver el iframe a 0.8.0 y mantener el host de sesiones compatible con
  ambas versiones. Si se desactiva el outbox, conservar su purga de tokens
  (`RECOVERY_ENABLED=false`); no restaurar a ciegas el JS antiguo sin limpieza.
- Mantener el backend compatible mientras puedan existir páginas 0.8.1 abiertas o
  informes pendientes; no basta esperar la retención local si una expedición sigue activa.
- Revalidar salud, CORS, ambas versiones, cron y que rankings/resultados no cambian.
  No borrar ni reescribir resultados, puntuaciones o historial para simular una reversión.

## Checklist de apertura pública

- [ ] Autorizar etapas y recursos; resolver lectura 403 de Workers Builds/deploy hooks.
- [ ] Responsable, contacto de privacidad/abuso y moderador designados; avisos revisados.
- [ ] Namespace DO SQLite permitido en el plan; presupuesto/límites revisados.
- [ ] Backend compatible desplegado y probado antes de publicar frontend.
- [ ] Smoke test real en HTTPS, dos navegadores, reconexión y recuperación de informes.
- [ ] Compras desactivadas, Original disponible, Void bloqueada sin precio ficticio.
- [ ] Chat moderado abierto o claramente no disponible; normas, Report y pausa operativas.
- [ ] Credenciales fuera de Git/Pages/logs; artifacts y versión anterior conservados.
- [ ] Reversión compatible disponible; alertas/cobertura durante la apertura acordadas.

## Commits de implementación

| Commit | Responsabilidad |
|---|---|
| db9e134 | API compatible e inventario gratuito real |
| 3a6ff47 | Chat Durable Object, retención, antispam y pruebas |
| 754a103 | Pausa inmediata y herramienta de moderación |
| 318e08b | Handoff, skins, adaptador y sesiones 0.8.1 |
| e6c0e9a | Interfaz, chat cliente, volumen y privacidad |
| 94f56e2 | Dependencias fijadas, navegador, procedencia y reversión |
| e921083 | Límite de cuerpos HTTP antes de reservar/decodificar |
| d648a0f | Artefactos de reversión compatibles y prueba actualizada |

El commit final de documentación conserva el plan y la revisión de artefactos.
Su hash se obtiene del log y se entrega en el informe final.

Fuentes técnicas de la decisión y operación:
[WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[límites de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/limits/),
[Pages desde una rama](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site),
[rollbacks de Workers](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).
