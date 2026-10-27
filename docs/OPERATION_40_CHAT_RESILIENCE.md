# Operación 40 — disponibilidad resiliente del chat

## Decisión de producto

Los invitados conversan sin que un moderador humano esté conectado. `CHAT_ENABLED`
se mantiene en `true` en `backend/worker/wrangler.jsonc`. El secreto autentica las
operaciones administrativas; no representa una persona presente. La pausa del
Durable Object es una acción explícita para una incidencia, no el estado normal.
El futuro panel necesitará cuentas y roles reales. Esta operación no inventa
identidades ni permisos.

## Estados y recuperación

`GET /chat/status` devuelve `{available:true,paused:false}` normalmente y
`{available:false,paused:true}` cuando el operador pausa la sala. La falta de flag,
binding o secreto de servicio no se presenta como una pausa: se informa como error
temporal. Las respuestas usan `Cache-Control: no-store` y validan el origen.

El cliente separa comprobando, disponible, pausado, error de red y reconectando.
Timeout, HTTP inválido, JSON erróneo o desconexión producen un aviso temporal y
permiten reintento manual. Las consultas automáticas usan esperas de 1, 2, 4, 8,
15 y 30 segundos como máximo. No hay polling continuo cuando la pestaña está oculta
o el navegador offline. `online`, `focus`, `pageshow`, el retorno a primer plano y
la acción manual vuelven a consultar. Las comprobaciones simultáneas comparten una
petición. Una pausa real nunca se presenta como timeout.

Una consulta de estado no reemplaza los WebSockets activos. Tras perder un socket,
el cliente reconecta una sola conexión con backoff de hasta 30 segundos mientras
dure la sesión del invitado. Las claves idempotentes y el historial del servidor
evitan duplicados. Antispam, cuotas, identidades de invitado, denuncias, bloqueos y
protección XSS siguen en el Worker.

Las sesiones de invitado se validan con una tolerancia de cinco minutos entre el
reloj del navegador y el Worker. El Worker conserva la autoridad sobre la
caducidad del token; la tolerancia evita rechazar una sesión válida cuando el
reloj local va ligeramente retrasado.

## Pruebas locales

`npm.cmd test` (51 pruebas) y `node tests/browser-smoke.cjs` cubren API disponible,
configuración ausente, origen, pausa/reanudación, fallo de la primera consulta y
éxito de la segunda, timeout real, reintento manual, pérdida y vuelta de Internet,
retorno a primer plano, backoff limitado, WebSockets sin duplicados, mensajería,
XSS, denuncias, retirada, bloqueo, juego, informes, skins y música. Chromium enruta
toda escritura a Miniflare y D1/DO temporales.

La validación pública confirmó el timeout inicial seguido de una respuesta real,
la recuperación del botón sin recargar, y el reintento manual. La entrada de dos
invitados en producción quedó limitada por HTTP 429 del control antispam por IP
durante la prueba; no se eludió la cuota ni se enviaron mensajes. La prueba de dos
invitados y reconexión sí pasa localmente en Chromium.

## Publicación

Worker publicado en `6ec38c27-f3ef-481b-802a-fc1104803639`; `CHAT_ENABLED=true`,
secreto administrativo, Durable Object y D1 siguen enlazados, y Cron conserva
`0 */6 * * *`. `/health` responde bien y `/chat/status` devuelve disponible, no
pausado. GitHub Pages sirve los recursos del commit `ee6630f`. No se ejecutaron
migraciones D1. Una incidencia administrativa permite pausar la sala sin afectar
al juego ni borrar contenido.
