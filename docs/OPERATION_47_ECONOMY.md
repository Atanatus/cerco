# Operación 47 — auditoría y política económica

## Auditoría previa (base 7760aa4)

Se reutilizan `guest_profiles`, recuperación por hash y acceso Bearer efímero de `guest.js`; `matches.guest_id`, `match_session_tokens`, `pending_run_reports` y cierre atómico de sesiones. Los resultados oficiales y la vista histórica permanecen independientes. No hay cartera, ledger, compras ni propiedad comercial anterior en el esquema auditado. `/skins/inventory` concede únicamente Original por regla del servidor; equipar Void está denegado. No se importan selecciones locales como propiedad. No se asocian invitados históricos sin credencial a perfiles nuevos.

SHOP y SKINS existentes se reutilizan; catálogo visual oficial con dos IDs. PROFILE PICTURES no tiene catálogo comercial: permanece COMING SOON, categoría preparada a 1.250 ✦. Void Circuit cuesta 3.000 ✦; Original es gratuito. Créditos de expedición y score no intervienen en el saldo.

Wrangler apunta a producción: NO se usa para pruebas. `tests/support.cjs` instancia explícitamente Miniflare con D1 temporal, sin bindings remotos. Respaldo Git completo verificado: `.local-recovery/op47/pre-economy.bundle`.

## Límite de confianza

Recibido/pendiente, coherente, rechazado, verificado y liquidado son estados distintos. Ninguna ruta HTTP puede verificar ni acreditar una recompensa. Las comprobaciones aritméticas detectan inconsistencias, no demuestran combate legítimo. La futura autoridad deberá aportar evidencia independiente (simulación autoritativa o reproducción completa revisada); la seed y los diagnósticos cliente no bastan. No hay secretos dentro del juego ni endpoints para fondos de prueba.

La política inicial mantiene la acreditación automática desactivada. Las pruebas positivas usan autorizaciones insertadas exclusivamente en la D1 temporal por el harness, no por el cliente. Las compras solo gastan saldo confirmado del servidor; nunca recompensas pendientes.

## Atomicidad prevista

Se usan sentencias condicionales y triggers SQLite dentro de la transacción que las origina, con restricciones UNIQUE/CHECK/FK. Las operaciones de varios pasos usan `D1Database.batch`, cuyo fallo revierte la secuencia según la [documentación oficial de Cloudflare](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). No se asumen bloqueos SELECT FOR UPDATE ni transacciones abiertas entre peticiones. Los tests comprobarán concurrencia real en Miniflare/D1.

## Checkpoint C: backend de recompensas

`0006_cosmetic_rewards.sql` añade sesiones económicas enlazadas a `matches`, recibos únicos, cartera, ledger inmutable y autorizaciones independientes. Es repetible y no modifica tablas históricas. El único módulo que puede liquidar exige una autorización que coincida con el hash del informe y la cantidad; no se invoca desde HTTP, informes ni Cron. Dos liquidaciones concurrentes generan un solo movimiento. Las cantidades son enteras y la base rechaza balances negativos.

Contrato de API (mismo origen permitido y Bearer Guest existente, nunca UUID como autorización):

| Método/ruta | Entrada y respuesta | Límites/idempotencia |
|---|---|---|
| POST `/matches/start` | 0.9.0 admite `client_run_id` y `ruleset`; vincula una sesión económica al Guest autenticado | El runId es referencia; ID y token de partida los genera el servidor. Clientes antiguos siguen funcionando sin esos campos |
| POST `/economy/receipts` | `match_id`, hasta 32 eventos detallados reales `cosmetic_coin_spawned/collected`; devuelve accepted/state/verified:false | 32 KiB, 512 drops por partida, unicidad `(match_id,drop_id)`, conflictos rechazados, sin saldo |
| GET `/economy/wallet` | currencyId, balance, earned, pending, automaticCreditEnabled:false | Información solo del Guest autenticado; 90 peticiones económicas/minuto por Guest |
| POST `/runs/pending` | Contrato histórico intacto; reconcilia además auditoría cosmética de sesiones 0.9.0 vinculadas | Un fallo económico permite reintentar el mismo informe sin duplicarlo; informe y resultado siguen sin verificar |

Errores: 400 formato/evento/contrato, 401 credencial, 403 origen o propiedad, 409 conflicto/sesión cerrada, 413 límite, 429 cuota, 503 servicio. No existe endpoint para financiar, aprobar o liquidar.

La reconciliación recalcula valores y límites, distingue spawns de recogidas, caducidad, salas y bajas elegibles, replays, secuencias y sumas por banda/sala. Recupera recibos faltantes desde la auditoría final íntegra sin duplicar eventos de transporte; cualquier discrepancia con recibos ya aceptados rechaza la recompensa. La auditoría sin final derrota queda sin liquidar. Ninguna comprobación de coherencia se presenta como verificación.

## Checkpoint D: comercio

`0007_cosmetic_commerce.sql` añade catálogo, categorías, compras, inventario y equipamiento. Solo existen Original y Void Circuit. PROFILE PICTURES tiene precio de categoría 1.250 ✦ y ningún artículo publicado. Las pruebas usan una imagen ficticia únicamente en la D1 efímera para comprobar el modelo genérico; no se incluye en migraciones ni en el catálogo real.

`GET /shop/catalog`, `POST /shop/purchase` (`productId`, `operationKey` de 16–80 caracteres), `GET /skins/inventory`, `POST /skins/equip` (`skinId` o `productId`) y `POST /profile-picture/equip` (`productId`) comparten la autenticación Guest y la cuota económica. `/skins/purchase` es alias compatible del mismo controlador, no una segunda implementación. GET autenticado sin Origin conserva compatibilidad con clientes nativos; los cambios exigen Origin exacto. Peticiones de compra/equipamiento limitadas a 2 KiB.

El servidor selecciona el precio y saldo dentro de la sentencia de compra. Sus triggers crean ledger, descuento e inventario en una transacción; cualquier error revierte todo. Una clave de compra exitosa devuelve la misma operación; reutilizarla para otro producto da 409. Fondos insuficientes no crean una compra: un reintento futuro puede tener éxito cuando exista saldo confirmado. Propiedad ya poseída no se cobra. Artículos inactivos conservan propiedad histórica, pero dejan de ser equipables; la respuesta recupera Original como alternativa.

El equipamiento persiste por Guest/categoría y la base también valida propiedad. Las asignaciones legítimas `server_grant` se respetan. No existe ruta pública para crearlas. La recuperación de Guest y sus credenciales no cambia al comprar ni equipar.

## Checkpoint E / 47E — cierre local del frontend (2026-10-30)

### Recuperación e historial

Trabajo exclusivo en `D:\CERCO_DEPLOY_20261026_120732`, rama `main`. HEAD recuperado: `f9eb4eee1a6d48a24fee0587bb57f99ca3aef14f`. El índice estaba vacío. Había exactamente dos archivos parciales: `src/js/skins.js` modificado y `src/js/economy-client.js` nuevo, sin seguimiento. Se leyó íntegramente el cliente económico antes de editarlo; sus peticiones de catálogo, compra y equipamiento se conservaron y completaron. `index.html`, `shop.js`, `profile-photo.js`, CSS y tests no tenían diferencias iniciales.

Se verificó el bundle anterior `pre-economy.bundle`, cuyo HEAD es `7760aa4`. Respaldo adicional previo a las modificaciones: `.local-recovery/op47/resume-20261030-061316/`. Incluye bundle completo de `f9eb4ee`, copias exactas de ambos archivos parciales, parches del árbol y del índice, estado Git y `SHA256.json`; se verificaron el bundle y los hashes de las copias. No se descartó trabajo parcial. No se accedió a `D:\PROYECTOZ` ni `D:\ATANATUS`, ni se modificó `NUL`.

| Operación | Commit local previo |
|---|---|
| 45B — SIGNAL, reproductor y leaderboard | `5206a34` (audio `23b349f`, SIGNAL `17ca0f0`) |
| 46 — CERCO 0.9.0 | `7760aa4` |
| 47 C — recibos, cartera y ledger | `a9d9a99` |
| 47 D — comercio e inventario | `f9eb4ee` |
| 47E — interfaz y validación | Commit que incorpora esta sección; SHA final en el informe de entrega y `.local-recovery/op47/CLOSEOUT_47E.json` |

### Resultado por subsistema

| Subsistema | Estado | Resultado comprobado localmente |
|---|---|---|
| Recuperación y respaldo | COMPLETADO | Estado inicial auditado, índice vacío y backup verificado |
| Identidad y sesiones 0.9.0 | COMPLETADO | Guest autenticado, `client_run_id`, `CERCO-0.9.0`, aislamiento de partidas/iframe/identidad |
| Transporte y reconciliación de recibos | COMPLETADO | Cola acotada, dedupe, reintentos y auditoría final sin duplicar recompensas |
| Cartera del perfil | COMPLETADO | Saldo confirmado y pendiente separados; carga/error; solo datos del servidor |
| SHOP y compras | COMPLETADO | Catálogo real, precio del servidor, clave idempotente, débito único y lectura posterior |
| Inventario y SKINS | COMPLETADO | Original gratuito; Void Circuit solo tras propiedad autenticada |
| Equipamiento | COMPLETADO | Persistencia por Guest y aplicación correlacionada al iframe; recuperación al reabrir Chromium |
| PROFILE PICTURES | PARCIAL | Modelo de compra/propiedad/equipamiento disponible; galería de inventario preparada; catálogo real ausente |
| Validación de coherencia | COMPLETADO | Filtros y triggers existentes comprobados; no equivalen a acreditar combate legítimo |
| Autoridad antifraude independiente | NO IMPLEMENTADO | Sigue siendo necesaria para autorizar recompensas legítimas |
| Acreditación automática | NO IMPLEMENTADO | Intencionadamente desactivada; `automaticCreditEnabled:false` |
| Validación local | COMPLETADO | 105 pruebas y 23 grupos Chromium; capturas e inspección visual |
| Publicación de 47 | NO IMPLEMENTADO | Sin push, despliegue, migración remota ni escrituras en producción |

### Flujo y contratos efectivos

Se completaron `economy-client.js` y `skins.js`; se conectaron en `index.html`, se extendió `cerco-sessions.js` y se añadió `src/css/cosmetics.css`. SHOP y el modal de fotos conservan sus controladores existentes. `cerco-skins-adapter.js`, el HTML de juego 0.9.0, los assets auténticos, backend y migraciones no necesitaron modificaciones en 47E. Se actualizaron los textos de almacenamiento para describir cartera, compras, credenciales y reintentos.

El cliente usa estas rutas existentes, sin introducir endpoints nuevos:

| Ruta | Método | Autenticación y resultado utilizado |
|---|---|---|
| `/guest/profile` | POST | Credencial de recuperación existente; emite Guest y Bearer efímero |
| `/matches/start` | POST | Bearer; versión, modo, `client_run_id`, ruleset; devuelve `match_id` y ticket de partida |
| `/economy/receipts` | POST | Bearer y pertenencia de partida; `accepted`, `state`, `verified:false` |
| `/runs/pending` | POST | Ticket de partida y Guest coincidente; informe idempotente y reconciliación económica; `accepted:true,status:pending,verified:false` |
| `/matches/abandon` | POST | Ticket de partida; cierre idempotente, sin crédito |
| `/economy/wallet` | GET | Bearer; `balance`, `earned`, `pending`, `automaticCreditEnabled:false` |
| `/shop/catalog` | GET | Bearer; categorías, productos y el mismo inventario/cartera autenticados |
| `/shop/purchase` | POST | Bearer; solo `productId` y `operationKey`; respuesta de propiedad/compra más inventario |
| `/skins/inventory` | GET | Bearer; propiedad y equipamiento persistentes |
| `/skins/equip` | POST | Bearer; producto poseído, categoría y actividad; inventario más `cosmeticOnly:true` |
| `/skins/purchase` | POST | Alias compatible de compra autenticada; el frontend usa `/shop/purchase` |
| `/profile-picture/equip` | POST | Bearer; mismo control de propiedad por categoría |

Las escrituras mantienen la comprobación de Origin exacto `https://cerco.atanatus.com`. Las pruebas envían el tráfico interceptado al Worker efímero y ajustan el Origin solo en el harness; ningún navegador de prueba alcanza producción. Se conserva el GET autenticado sin Origin para clientes nativos y la compatibilidad histórica de skins. Las versiones 0.8.x no reciben contratos económicos 0.9.0 por accidente.

El host comprueba ventana emisora, origen, protocolo y sesión activa antes de procesar monedas. Conserva como máximo 1.024 eventos detallados; el servidor admite hasta 512 drops por partida. Deduplica por tipo y `dropId`, ordena por `eventSeq` y envía lotes de 16. Tiene hasta cuatro intentos por lote, con esperas de 1/3/10 segundos; no guarda recibos como prueba de propiedad. `pickup_collected` no genera un segundo recibo. Conflictos, saturación o entrega incierta muestran un estado explícito. Una recarga o cambio de Guest invalida la cola anterior. Un informe que termina antes de obtener identidad/sesión conserva su propia auditoría y no se atribuye a una partida nueva.

El informe final se entrega mediante el outbox existente, limitado a ocho partidas, cuatro intentos y seis horas. Su versión 2 guarda metadatos en localStorage y tickets de Guest por separado en IndexedDB. La recuperación compatible de informes v1 del mismo Guest migra su ticket antes de reintentar. Las rutas históricas sin perfil siguen siendo compatibles. Ningún Bearer ni secreto de recuperación se entrega al iframe ni se añade a logs. Los nuevos registros Guest no guardan `sessionToken` en localStorage; Chromium comprueba esta condición y recupera una respuesta perdida tras escribir en D1.

La finalización utiliza la reconciliación existente para recuperar recibos perdidos. `coherent` significa que el servidor ha comprobado consistencia del informe cliente; el resultado sigue pendiente de autoridad independiente. El saldo confirmado no cambia al recibir eventos ni al finalizar. Los recibos de otra partida/Guest, duplicados y abandonos se comprueban sin introducir resultados oficiales.

La cartera muestra datos de `catalog.inventory.wallet`, que utiliza la misma implementación que `/economy/wallet`. No hay otra cartera ni inventario local. Un fallo de lectura deja el balance no disponible, sin recurrir a cantidades guardadas en el navegador. El contrato no ofrece fecha de actualización: no se inventa. Se comprobaron 0 confirmadas/5 pendientes, 5.000 confirmadas de prueba, 2.000 tras la compra y cantidades grandes hasta 1.000.000.000 para revisar el layout.

Void Circuit conserva su precio de **3.000 ✦** y Original es gratuito. El catálogo determina el precio mostrado y la sentencia de compra determina el precio cobrado. Solo se envían ID y clave idempotente. El cliente bloquea compras simultáneas, reutiliza la misma clave ante pérdida de respuesta y vuelve a leer catálogo/inventario/cartera. Las claves no secretas tienen límite de ocho y caducidad de seis horas; siguen en memoria si no hay almacenamiento. Cambiar de Guest invalida respuestas antiguas, incluso durante la lectura posterior a comprar. Nunca se descuenta saldo de forma optimista.

SKINS solicita equipamiento al servidor y utiliza el adaptador existente para `cerco_set_skin`/`skin_set_result`. El evento `skin_changed` no concede derechos. La elección se restaura al recargar iframe, página y navegador. No se modifican estadísticas ni se convierte score o créditos ◈ en Style Coins.

PROFILE PICTURES muestra **1.250 ✦ · COMING SOON**, tomado del precio de categoría. No se añadieron imágenes, IDs ni productos comerciales ficticios. El avatar actual y cualquier imagen ajena al equipamiento administrado se conservan. El backend tiene modelo genérico de propiedad/equipamiento; la UI puede mostrar imágenes poseídas con rutas locales admitidas cuando exista un catálogo auténtico. Publicar ese catálogo y habilitar su oferta visual completa sigue pendiente.

### Validación y evidencia

`npm test`: **105/105**, cero fallos, cancelaciones u omisiones. Log final: `.local-recovery/op47/full-tests-final-v2.log`. Se añadieron pruebas contra Worker/D1 para cola antes del inicio, recibos duplicados y de otra partida, fin duplicado, identidad cambiada en varias fases, iframe recargado, inicio retrasado, cola saturada, errores de red acotados, compra concurrente, pérdida de respuesta y recuperación de la clave tras recarga/sin almacenamiento. Se ampliaron comprobaciones de Origin y autenticación. Los tests anteriores siguen verificando atomicidad, reversión, ledger inmutable, permisos, migraciones y compatibilidad.

`node tests/browser-smoke.cjs`: **23 grupos aprobados**, `pageErrors:[]`. Resultado en `.local-recovery/op47/browser-1793337986979/browser-results.json`; log `.local-recovery/op47/browser-regression-final.log`. Tras el último ajuste de invalidación de identidad se repitieron `npm test` y los **4 grupos económicos** con `node tests/browser-smoke.cjs --economy-only`, sin errores: `.local-recovery/op47/browser-1793338106794/browser-results.json` y `.local-recovery/op47/browser-economy-final.log`.

Chromium prueba compra contra el Worker real local, pérdida de la respuesta después del commit en D1 y un único cargo; inventario/equipamiento al reabrir todo el navegador; recibos y fin de partida; ausencia de productos de fotos; juego utilizable con servicio cosmético caído. La moneda del escenario se genera con funciones reales del juego instrumentadas únicamente en memoria por el harness; el movimiento por teclado atraviesa su casilla y activa la recogida real. Es un fixture sintético, no evidencia antifraude. El HTML entregado permanece intacto.

Se inspeccionaron capturas de SHOP, SKINS, perfil y juego en **1920×1080, 1366×768, 1024×768, 390×844 y 844×390**. Se corrigió el solapamiento de navegación en ventanas de poca altura: botones con mínimo de 44 px y panel lateral desplazable. Las cantidades grandes envuelven el texto sin overflow horizontal. Se revisaron precios/✦, contraste, botones, modal, teclado y scroll. Las galerías estrechas permiten desplazamiento horizontal y los paneles cortos desplazamiento vertical. SIGNAL, las ocho canciones, timeline/volumen/teclado, leaderboard y controles táctiles siguen pasando.

Capturas locales finales (excluidas del commit):

- [SHOP, saldo cero](../.local-recovery/op47/browser-1793338106794/screenshots/economy-shop-zero.png)
- [Perfil, recompensas pendientes](../.local-recovery/op47/browser-1793338106794/screenshots/economy-profile-pending.png)
- [Perfil, saldo confirmado de prueba](../.local-recovery/op47/browser-1793338106794/screenshots/economy-profile-funded.png)
- [SHOP, Void Circuit poseída](../.local-recovery/op47/browser-1793338106794/screenshots/economy-shop-owned.png)
- [SKINS, inventario adquirido](../.local-recovery/op47/browser-1793338106794/screenshots/economy-skins-owned.png)
- [Juego, recogida de moneda](../.local-recovery/op47/browser-1793338106794/screenshots/economy-game-coin-collected.png)
- [Juego, informe final](../.local-recovery/op47/browser-1793338106794/screenshots/economy-game-final.png)
- [Chromium cerrado y reabierto](../.local-recovery/op47/browser-1793337986979/screenshots/economy-browser-reopened.png)

Los directorios anteriores incluyen también las capturas por resolución, estados de error y regresión general. `.local-recovery` permanece ignorado; no se incluyen logs, tickets, bases, backups ni capturas en Git.

### Límites y siguiente trabajo pendiente

La operación cierra **localmente** la cadena CERCO 0.9.0 → sesión autenticada → recibos/auditoría pendientes → cartera → SHOP → inventario → equipamiento. Las migraciones `0006_cosmetic_rewards.sql` y `0007_cosmetic_commerce.sql` se ejecutaron solo en D1 efímera; no se cambiaron ni aplicaron remotamente durante 47E.

Los filtros actuales no prueban que el combate haya sido legítimo: el cliente puede alterar eventos/auditorías. No existe todavía una autoridad independiente de reproducción/simulación revisada. Por ello no se habilitó acreditación automática ni se declara la economía operativa en producción. Los únicos fondos positivos usados pertenecen a fixtures autorizados de la base temporal. No hay endpoints, parámetros ni botones para financiar usuarios.

Pendiente fuera de este cierre: implementar y revisar esa autoridad, aportar un catálogo auténtico de fotos, y autorizar por separado cualquier publicación futura. El SHA final y el estado limpio de Git se registran tras revisar el índice y crear el commit local de frontend. **No se realizó push ni despliegue; producción no fue modificada.**
