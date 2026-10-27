# Operación 36: endurecimiento y recuperación local

Para la beta 0.8.1, el plan vigente es [BETA_0.8.1.md](BETA_0.8.1.md).
Sustituye las instrucciones de publicación/reversión de esta etapa: añade un
Durable Object y conserva compatibilidad 0.8.0/0.8.1 al revertir.

## Estado y alcance

Base Git inspeccionada: `c3e4bb3`; las operaciones 34/35 estaban sin commit.
Copias previas a esta operación en `.local-recovery/op36/`, ignoradas por Git.
No se han ejecutado despliegues, push, migraciones remotas ni escrituras de producción.
No cambian el juego, la EXP, las tablas de puntuaciones ni la selección de rankings.
Los informes siguen siendo `client_reported_unverified`; no generan resultados oficiales.

La revisión añade comparación JSON iterativa en el Worker para evitar desbordamiento
de pila con auditorías profundas. Conserva el orden de arrays y compara todos los
campos de identidad del informe. También elimina credenciales en memoria al
confirmar, descartar o caducar una operación y separa cada recuperación de la partida actual.

## Contrato de almacenamiento

Solo se persisten operaciones terminales de partidas con credenciales ya recibidas:
informe final o abandono. Nunca se persiste una sesión activa ni se reintenta su creación.
Cada operación tiene una clave `cerco_terminal_v1:<match UUID>` en localStorage.
Incluye versión, partida, run, tipo de operación, snapshot del informe, token,
intentos reservados, creación y caducidad. El endpoint se elige en código.

Límites:

- Ocho registros, de hasta 125.000 unidades UTF-16 cada uno (aproximadamente 2 MB en total).
- Seis horas desde el evento terminal; las recargas no prolongan la caducidad.
- Cuatro intentos totales, incluidos los anteriores al reinicio y los de otras pestañas.
- Pausas de 1, 3 y 10 segundos; timeout de diez segundos por intento.
- Ante capacidad agotada se elimina el registro más antiguo. Los datos ajenos al prefijo se conservan.

El registro se guarda antes de la primera petición; cada intento se reserva en
almacenamiento antes de enviarse. Cerrar la pestaña durante una petición consume
ese intento aunque no se conozca su resultado. Agotar el presupuesto descarta la
operación: se prioriza un límite estricto sobre reintentos indefinidos.

Se borran registro y referencias al token tras confirmación, error definitivo,
caducidad, descarte o agotamiento. La limpieza se ejecuta al abrir, antes de enviar
y cada minuto mientras la página tiene ejecución. Un navegador cerrado o suspendido
no puede ejecutar borrados: un registro caducado se elimina en la próxima ejecución
y nunca se reenvía. La eliminación física depende también de que el navegador permita escribir.

## Concurrencia y fallos

Web Locks coordina pestañas del mismo origen. Un bloqueo por partida cubre la
lectura, reserva y petición. Otro bloqueo breve protege límites y actualizaciones
de la cola, sin esperar a la red. Una petición lenta no bloquea la persistencia
ni la entrega de una partida posterior. Tras adquirir el bloqueo se vuelve a leer
el registro: si otra pestaña lo confirmó o descartó, no se reenvía ni se recrea.

El servidor conserva la última frontera: autenticación antes de comprobar duplicados,
inserción única por partida, cierre atómico y rechazo de informes diferentes.
Una respuesta perdida se recupera mediante el mismo informe y las mismas credenciales.
No se alteran las fechas ni las puntuaciones ya guardadas.

Sin Web Locks se purga esta cola y se usa envío en memoria. Si falla la primera
escritura por cuota o permisos también se continúa en memoria. Si falla la reserva
de un registro persistido se descarta: no se envía con un presupuesto sin guardar.
Los registros corruptos, sobredimensionados, caducados, futuros o de otra versión
se eliminan sin enviarlos. Los fallos no interrumpen el juego.

HTTP 400/403/409/413 y demás errores definitivos no se reintentan. Fallos de red,
timeout, respuestas exitosas truncadas o de formato inesperado y HTTP
408/429/500/502/503/504 se reintentan dentro del presupuesto. Recargar puede adelantar
la próxima pausa, pero no aumenta el presupuesto ni amplía la retención.

## Límites de seguridad y disponibilidad

localStorage no es una caja fuerte: cualquier script ejecutado con acceso al mismo
origen puede leer o alterar sus datos. No se afirma confidencialidad frente a XSS,
extensiones o un perfil de navegador comprometido. Cifrar con una clave guardada
en ese mismo navegador no resolvería ese problema. Se minimizan alcance y retención;
los tokens nunca se imprimen en registros ni se exponen mediante la función de estado.
El presupuesto local no es un control antiabuso contra quien modifique su propio navegador.
Los informes no demuestran juego legítimo y permanecen sin verificar.

No se garantiza recuperación si el navegador borra sus datos, rechaza la escritura,
se cierra antes de completar el guardado o antes de recibir las credenciales de
creación, si vence la retención o si se supera capacidad/presupuesto. Tampoco se
reanuda una expedición activa: esa funcionalidad queda fuera de esta operación.

## Pruebas reproducibles

Desde la raíz, con Node 24:

```powershell
node --test tests/sessions.test.cjs
node --check src/js/cerco-sessions.js
node --check backend/worker/index.js
git diff --check
```

Se usa Miniflare local, o el incluido en Wrangler global. Entorno validado:
Node 24.13.1, Wrangler 4.151.3 y Miniflare 5.20261019.1-beta. No se descargan
dependencias para ejecutar estas pruebas en este entorno.
La D1 efímera se crea con esquema/migraciones locales, sin leer wrangler.jsonc.
El cliente se ejecuta en contextos VM independientes con almacenamiento compartido,
bloqueos por nombre, red y temporizadores simulados; no es una prueba visual de navegador.

La batería cubre reinicios, recuperación de informe y abandono después de commit D1
con respuesta perdida, duplicados simultáneos, carreras finalizar/abandonar,
preservación exacta de filas y fechas, auditorías profundas, manipulación,
presupuesto entre recargas, dos pestañas, aislamiento de partidas posteriores,
snapshot inmutable, cuota, caducidad activa y al reiniciar, datos corruptos,
origen de mensajes, lectura de respuesta interrumpida, CORS, salud, caducidad de
sesiones y rankings separados sin crear resultados oficiales.

Resultado final local: 37 pruebas aprobadas, sin fallos; comprobaciones de sintaxis
del cliente y Worker y `git diff --check` correctas. La prueba de puntuaciones
existentes compara los datos de `results`, excluyendo metadatos variables de D1,
y confirma que no aparece ninguna fila verificada.

## Commits y resolución del bloqueo

La auditoría encontró `.git/index.lock` ausente, índice inicialmente vacío y `.git`
de solo lectura en el perfil de la sesión. La ACL incluía denegaciones de escritura
y el proceso utilizaba la identidad de sandbox. No era un lock residual que borrar.
La protección de `.git` está descrita también en
[OpenAI Docs](https://learn.chatgpt.com/docs/agent-approvals-security).

La autorización limitada por comando permitió ejecutar `git add` con rutas
explícitas y `git commit` en este repositorio. No se modificaron ACL ni configuración
del sandbox; no se pidió acceso general al equipo. Se conservaron todos los cambios.
No fue necesario preparar un bloque alternativo para terminal externa.

Separación local por responsabilidad:

1. `81d8906` — `fix(api): accept authenticated report resends idempotently`.
   Worker idempotente, comparación iterativa y reconocimiento de cambios del trigger.
2. `27bc286` — `feat(sessions): recover bounded terminal retries across browser restarts`.
   Cliente de operaciones 35/36, las 37 pruebas y exclusión de copias de recuperación.
3. Commit de documentación: `docs(operations): prepare staged release and safe rollback`.
   Contratos, diagnóstico, validación y plan de publicación. Su hash figura en el log Git.

## Plan de publicación y reversión — requiere autorización

Preparación local: repetir las 37 pruebas después de los commits, comprobar
`git fsck --full`, árbol limpio y ausencia de cambios desde `c3e4bb3` en el HTML
del juego, `index.html`, esquema/migraciones D1 y contrato de identidad. Registrar
los hashes de commits. No hay workflows `.github` versionados en esta auditoría;
eso no establece cómo está configurada la publicación de GitHub Pages en remoto.
Antes de cualquier push, comprobar si actualizar `main` publica automáticamente
el frontend. No enviar toda la rama antes de completar la fase del Worker.

### Fase 1: Worker

- Registrar la versión de Cloudflare actualmente activa y conservar su artefacto
  para reversión. Confirmar de nuevo el destino y binding D1 existentes.
- Publicar, solo con autorización explícita, el Worker correspondiente a `81d8906`.
  Mantener el frontend anterior. Si se requiere push para esa vía de publicación,
  autorizarlo por separado y limitarlo a la revisión de backend apropiada.
- Comprobar GET `/health`, preflight con origen permitido y rechazo de origen ajeno.
  Comprobar por separado `/leaderboards?kind=guest` y `kind=registered` sin escribir.
- La prueba de escritura requiere autorización propia: crear sesiones de prueba,
  enviar un informe no verificado, repetirlo y confirmar 201/200, modificarlo y
  confirmar 409, probar credencial inválida y confirmar 403; probar también abandono
  duplicado. Nunca usar una partida o puntuación existente para pruebas de manipulación.
- Autorizar la fase 2 únicamente con esas comprobaciones satisfactorias o con una
  decisión explícita que acepte las comprobaciones pendientes. No ejecutar migraciones.

### Fase 2: frontend

- Publicar, solo con autorización explícita, el cliente de `27bc286` y la revisión
  final de documentación. Confirmar antes la vía de hosting y su automatización.
- Verificar que el navegador recibe el nuevo script sin una copia obsoleta en caché.
- Con sesiones de prueba expresamente autorizadas, comprobar en navegador real:
  finalización, abandono, desconexión y recarga, dos pestañas, agotamiento del
  presupuesto y limpieza de registros. Las simulaciones VM no sustituyen ese smoke test.
- Verificar que la recuperación no selecciona ni cambia la nueva partida, no crea
  resultados verificados y no mezcla rankings. No registrar payloads ni tokens.
- Vigilar errores 4xx/5xx y reenvíos. Pausar la publicación ante incremento inesperado
  de conflictos, ausencia de limpieza o interferencia con partidas posteriores.

Reversión preferida del cliente: publicar el mismo módulo con `RECOVERY_ENABLED = false`.
Conserva la limpieza de `cerco_terminal_v1:` y vuelve al envío en memoria sin recuperación.
No restaurar simplemente el JS antiguo: dejaría pendientes sus tokens sin rutina de limpieza.
Los navegadores cerrados solo podrán purgar sus registros al volver a visitar.
El Worker idempotente puede mantenerse mientras se revierte el cliente.
Si también fuera necesario revertir el Worker, hacerlo después de desactivar
la recuperación del frontend, usando la versión anterior registrada de Cloudflare.
Las páginas ya abiertas pueden seguir enviando; el cierre único existente evita
duplicados aunque un Worker anterior devuelva 409 en vez de confirmar el reenvío.

No hay migraciones ni reversión D1: nunca se borran ni se reescriben informes,
resultados o historial para revertir esta funcionalidad. Todo push, despliegue y
reversión de producción requiere autorización explícita.
