# Operación 45B — SIGNAL, audio y trono universal

Trabajo exclusivamente local. Se conservan los cuatro commits de 44 (`4c9f2d7`, `816e1bd`, `7a29dbf`, `17955c8`). Base remota comprobada por lectura: `5df3acd`. SIGNAL está en `17ca0f0`; audio en `23b349f`. No se han desplegado estos cambios.

## Recuperación

El archivo ignorado `.local-recovery/op45b/baseline-17955c8.zip` contiene 69 archivos. CRC y objetos Git verificados, teniendo en cuenta la conversión CRLF de Git para Windows. SHA-256: `36bfb01868a8b17116ce06e2e4bdb6c9e93c16abb6a9b3a95f699882130837ef`. El registro `recovery-23b349f/RECOVERY.json` documenta el HEAD, cuatro archivos pendientes del leaderboard y copias con hashes previas al cierre.

`NUL` es un directorio literal con 30 logs de Wrangler (367.251 bytes en la auditoría), creado al usar `WRANGLER_LOG_PATH=NUL` como ruta de logs. Se conservó íntegro y se excluyó mediante `/NUL/`. Git vuelve a enumerar el árbol sin el aviso de acceso. No se versionan logs ni backups. La recuperación se hace por archivos individuales o nuevos commits, nunca por una restauración destructiva.

## SIGNAL y música

El chat conserva sus API y autenticación. LIVE solo aparece tras el mensaje `welcome` autenticado del WebSocket. El enfoque de invitado es local, dura 30 segundos y se desactiva por botón o Escape. La representación conserva nodos y foco de teclado entre mensajes; texto, metadatos y denuncias se crean mediante DOM seguro.

Se consolidaron 67 selectores de chat y 63 de audio antes dispersos en `main.css`, manteniendo las declaraciones de las demás zonas. Sus estilos viven en `signal.css` y `music-player.css`.

El reproductor conserva el popup de volumen, mute y persistencia. El título ocupa su espacio real, los cuatro controles comparten fila y la barra usa `HTMLAudioElement.currentTime`/`duration`. Duración desconocida deshabilita la búsqueda. Teclado y saltos de pista funcionan sin fabricar progreso. El visualizador existente mantiene su animación asociada a Play/Pause; su pulso es fijo y no constituye un análisis espectral.

Playlist comprobada en Chromium (decodificación y avance real):

| Archivo | Título |
|---|---|
| Track1.mp3 | A River of Stone |
| Track2.mp3 | The Silver Bridge |
| Track3.mp3 | Cypress and Silk |
| Track4.mp3 | Jade and Heather |
| Track5.mp3 | Silkbwoofer |
| Track6.mp3 | Bamboo Groove |
| Track8.mp3 | Highland Blue |
| Track9.mp3 | Last Train to Jongno |

No se encontró Track7 / Midnight at the Gate en Descargas ni en su búsqueda acotada a dos subniveles; no se creó entrada. Los originales permanecen sin cambios y los seis nuevos MP3 se copiaron con verificación SHA-256. El manifiesto está en `.local-recovery/op45b/audio-manifest.json`.

## Leaderboard

El renderizado distingue `loading`, `empty`, `ready`, `unavailable` y `personal`. Solo `empty`, después de validar la respuesta del endpoint oficial, muestra `CLAIM THE THRONE` en #1. Durante carga muestra `CHECKING…`; ante fallo muestra `UNKNOWN`. PERSONAL y puestos 2–30 conservan `—`. Un campeón proviene de la respuesta API, se representa como texto y conserva su puntuación.

La petición tiene un límite de ocho segundos; navegar aborta la anterior. Un contador de generación descarta respuestas antiguas incluso cuando no se puede cancelar su transporte. La corona corresponde únicamente a un campeón devuelto por API. El dorado señala ese campeón o la invitación a ocupar un trono confirmado vacío. La semántica del segundo listado comienza en 16, como su contador visual.

## Evidencia local

`npm test`: 67 pruebas aprobadas, incluidas cuatro de renderizado/control de peticiones y consulta del Worker local que excluye todos los informes pendientes. Miniflare recibe explícitamente una D1 temporal; no usa la configuración `cerco-production` de Wrangler.

`node tests/browser-smoke.cjs`: regresión integral con 18 grupos, dos invitados, chat y reconexión, moderación local, Shop, skins, recuperación de informe 0.8.3, controles táctiles, audio real y estados del leaderboard. Los casos HTTP, respuesta inválida y campeón se inyectan solo en Chromium local para comprobar representación. La ausencia de resultados usa el Worker/D1 local real. Ningún campeón de prueba se escribe en producción.

Capturas en `.local-recovery/op45b/screenshots/`: `signal-focused-desktop.png`, `signal-emoji-desktop.png`, `layout-1366x768.png`, `layout-1920x1080.png`, `layout-1024x768.png`, `layout-768x1024.png`, `layout-390x844.png`, `throne-loading.png`, `throne-confirmed-empty.png`, `throne-api-fixture-champion.png`, `throne-unavailable.png`. El archivo del campeón está expresamente etiquetado como fixture. Se revisaron capturas del chat, reproductor, móvil y trono.

No se cambiaron Worker, D1, economía, EXP, cuentas ni reglas durante 45B. Publicar requerirá una autorización posterior y el orden Worker compatible → frontend de la operación 44 sigue siendo necesario.
