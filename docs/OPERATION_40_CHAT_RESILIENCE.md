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

## Pruebas locales

`npm.cmd test` (51 pruebas) y `node tests/browser-smoke.cjs` cubren API disponible,
configuración ausente, origen, pausa/reanudación, fallo de la primera consulta y
éxito de la segunda, timeout real, reintento manual, pérdida y vuelta de Internet,
retorno a primer plano, backoff limitado, WebSockets sin duplicados, mensajería,
XSS, denuncias, retirada, bloqueo, juego, informes, skins y música. Chromium enruta
toda escritura a Miniflare y D1/DO temporales.

## Publicación

Los cambios están solo en el repositorio local. Publicar primero el Worker y revisar
`/chat/status`; luego publicar el frontend y validar timeout, reconexión y
moderación. No se necesitan nuevas migraciones D1. Ante una incidencia, se puede
pausar la sala sin afectar al juego ni borrar contenido.
