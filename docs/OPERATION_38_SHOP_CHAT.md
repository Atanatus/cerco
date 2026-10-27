# Operación 38 — Shop y apertura moderada del chat

## Estado y causa

Base pública auditada: `d3a0035`; Worker activo `1c70c4a9-ac0b-4f07-bf02-2c523d4b9932`.
La consulta remota `wrangler secret list` devolvió `[]`: no existe todavía
`CHAT_MODERATION_TOKEN`. La configuración conserva `CHAT_ENABLED=false`, DB y
CHAT_ROOM, la clase SQLite PublicChat y la migración `chat-v1`. No hace falta
ninguna migración D1 ni un nuevo namespace. Los permisos de lectura funcionan;
el permiso efectivo de instalar secretos se comprobará únicamente tras autorizarlo.

Shop combinaba grid de dos filas `auto`, contenedores flex con `min-height:0`
y galerías no reducibles. Al faltar altura, la fila asignada a SKINS se comprimía
sin contener la altura intrínseca de las tarjetas. El valor `overflow-y:visible`
no lo arreglaba: con `overflow-x:auto` se calcula como `auto`. El encabezado de la
segunda fila podía quedar encima de las tarjetas de la primera.

Ahora el contenido es una columna flex desplazable verticalmente. Las categorías
no encogen y las galerías mantienen altura natural y scroll horizontal. Se eliminan
los overrides contradictorios; no hay offsets compensatorios. Se conserva el skew
de los encabezados y la estética. También se corrige una altura heredada de 20 px
en mensajes recibidos que permitía que otro mensaje tapase Report.

Reproducción antes: en 1024×360, tarjetas hasta y=432,59 y PROFILE PICTURES desde
y=212. Después: y=432,59 e y=448,59. En los otros cinco tamaños la separación
medida es de 22 px; en poca altura, 16 px, resultado del padding y gap existentes.
No son offsets nuevos. Evidencias locales en `.local-recovery/op38/`.

## Flujo y garantías del chat

`GET /chat/status` devuelve exclusivamente `{available:boolean}`, sin credenciales,
con no-store y origen validado. Ausencia de flag, secreto, binding o servicio, y pausa
de moderación, mantienen la entrada cerrada. El HTML arranca con entrada deshabilitada
y texto «Public chat temporarily closed». Si está disponible permite Join.
Si se pausa, los sockets se cierran inmediatamente y el cliente comprueba el estado.
Tras reanudar, recargar la página para habilitar la entrada; no se hace polling continuo.

`POST /chat/session` valida origen, aceptación de normas y cuotas antes de emitir
credenciales efímeras de invitado. `GET /chat/socket` autentica mediante el primer
frame, nunca mediante una URL. El servidor asigna nombre e identidad Guest; el
cliente dibuja iniciales, texto y hora sin HTML ni imágenes remotas. Dedupe y
secuencias sobreviven a reconexiones; límites por invitado, IP, sala, conexiones,
frames y tamaño. Máximo 100 mensajes / 24 horas; credenciales en memoria de pestaña
durante hasta dos horas. Los identificadores de red se almacenan como hash con sal.
El esquema y los límites de informes de partidas no cambian.

## Moderación desde el equipo del propietario

Responsable: operador y propietario del proyecto, conforme a su designación.
Usar PowerShell 7 en Windows desde este repositorio, sin transcripción/debugging
de secretos. El operador debe poder consultar y pausar antes de abrir la sala.

La herramienta `tools/chat-operator.ps1` genera 48 bytes criptográficos y guarda
solo su representación cifrada mediante DPAPI del usuario actual en
`%LOCALAPPDATA%\CERCO\chat-moderation.dpapi`, fuera del repositorio. Necesita el
mismo usuario Windows en ese equipo. No sincronizar el fichero con Pages/Git,
ni copiar claves en comandos, chats o capturas. Un proceso bajo el mismo usuario
Windows sigue pudiendo acceder a sus credenciales; DPAPI no protege un equipo comprometido.

Solo después de autorización de producción:

```powershell
pwsh -NoProfile -File tools/chat-operator.ps1 -Action Provision -Apply
```

Instala el secreto por stdin de Wrangler, sin argumentos secretos, sin logs de
Wrangler a disco, con sanitización y salida retenida. Si falla conserva el vault
cifrado para reintentar sin regenerar la clave. No activa el chat. No se ha ejecutado
Provision durante la preparación local ni se ha generado un secreto de producción.
Validación local de esta herramienta: análisis sintáctico y guardia sin `-Apply`;
la instalación y autenticación real quedan pendientes de autorización.

Operación habitual (sin copiar claves):

```powershell
pwsh -NoProfile -File tools/chat-operator.ps1 -Action List
pwsh -NoProfile -File tools/chat-operator.ps1 -Action Delete -Id <messageId> -Apply
pwsh -NoProfile -File tools/chat-operator.ps1 -Action Ban -Id <participantId> -Apply
pwsh -NoProfile -File tools/chat-operator.ps1 -Action Pause -Apply
pwsh -NoProfile -File tools/chat-operator.ps1 -Action Resume -Apply
```

List muestra `reports`, `messages`, `bans` y `paused`; consultar las denuncias
mientras esté abierta la sala. Buscar el mensaje por `reports[].messageId`; el autor
se obtiene de `messages[].participantId` (el `participantId` de una denuncia es el
denunciante, no necesariamente el autor). Delete retira un mensaje de todas las
conexiones e historial; Ban bloquea al participante y su IP durante 24 h y cierra
sus conexiones. Ban no borra mensajes previos: retirarlos por ID si procede.
La IP puede ser compartida: no bloquear sin evaluar ese efecto. Si no se puede
atender abuso, Pause inmediatamente. Resume solo tras resolverlo. No hay bandeja
de notificaciones externa ni moderación automática. Las denuncias se conservan
hasta 24 h, con cuotas. Un mensaje ya caducado puede no estar en el historial.

## Pruebas locales

```powershell
npm.cmd test
node tests/browser-smoke.cjs
```

50 pruebas automatizadas y 8 grupos Chromium. Miniflare/D1/DO aislados, sin tráfico
de escritura a producción. Geometría medida con getBoundingClientRect y hit-testing
de todos los botones, incluidos los deshabilitados, en 1366×768, 1920×1080,
1024×768, 768×1024, 390×844 y 1024×360. Scroll horizontal móvil y vertical corto.
Dos contextos independientes: nombres/iniciales, mensajes, XSS como texto,
reconexión/dedupe, denuncias, retirada, bloqueo, pausa y reanudación, fallo del estado
y entrada cerrada. Límites antispam y carreras en las pruebas del Worker.
Se conservan las regresiones de sesiones/reintentos, skins, música y reglas.

## Plan de producción sujeto a autorización específica

1. Comprobar main aún en d3a0035, árbol limpio, pruebas y hashes; conservar archive
   `baseline-d3a0035.zip` y artefactos compatibles de operación 37. Leer versión
   activa y automatismos; detenerse si hay cambios concurrentes inesperados.
2. Desplegar el Worker preparado con CHAT_ENABLED=false, clase/binding/migración
   existentes y `--keep-vars`. Verificar health, CORS, inventario y status=false.
   Sin escrituras SQL, partidas sintéticas nuevas ni cambios de reglas/economía.
3. Desde el equipo del operador, Provision -Apply por el canal protegido. Consultar
   List y ejecutar Pause -Apply antes de activar el flag. Confirmar que el operador
   puede ejercer esos controles; no abrir si falla instalación/autenticación/pausa.
4. Push fast-forward de los commits de operación 38 a main, sin force. Esperar
   Pages y verificar HTTPS: Shop/geometría, recursos, navegación, skin original,
   compras bloqueadas, música, consola y chat explícitamente cerrado.
5. Solo con permiso de apertura, desplegar el mismo Worker con CHAT_ENABLED=true
   usando --keep-vars; la sala sigue pausada. Verificar status=false. Después Resume.
6. Comprobar por HTTPS en dos contextos Chromium independientes: invitado real,
   intercambio, iniciales, reconexión y duplicados, texto HTML inerte, denuncia,
   retirada por moderador y pausa/reanudación. Máximo seis mensajes sintéticos;
   retirar exclusivamente sus IDs, sin borrar mensajes de usuarios. No probar un
   ban de IP en producción desde la IP del operador: bloqueo ya comprobado localmente.
   Pausar durante limpieza y revisión, reanudar solo al pasar las comprobaciones.
7. Comprobar versión final, chat utilizable, moderación operativa, Worker saludable,
   rankings sin cambios e integridad del repositorio. Si no pasa el chat, publicarlo
   cerrado conservando la corrección de Shop y el resto de la beta.

Comandos de despliegue, sobre artefactos congelados preparados localmente:

```powershell
wrangler.cmd deploy --config .local-recovery/op38/worker/wrangler.jsonc --autoconfig=false --keep-vars --message "CERCO op38 availability; chat held"
# Tras secreto, Pause, publicación y validación:
wrangler.cmd deploy --config .local-recovery/op38/worker/wrangler.jsonc --autoconfig=false --keep-vars --var CHAT_ENABLED:true --message "CERCO op38 moderated chat"
```

El push usará el SHA final registrado en `.local-recovery/op38/release-manifest.json`.
Este documento no constituye autorización de producción.

## Contingencia

Ante un fallo crítico, Pause inmediato y despliegue del artefacto op38 con
CHAT_ENABLED=false; mantener Shop arreglado. Si falla el Worker, usar el artefacto
compatible conservado `release-e921083/rollback-worker/`, que admite informes
0.8.0/0.8.1, mantiene PublicChat y cierra el chat. La nueva interfaz falla cerrada
si ese backend no expone status. Nunca borrar namespaces, migraciones, D1 o registros.
Un fallo crítico de interfaz se revierte con un nuevo commit selectivo, sin force ni
reescribir main. No volver a la API anterior a 0.8.1. Estas contingencias también
necesitan quedar incluidas en la autorización agrupada.
