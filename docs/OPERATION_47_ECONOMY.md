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
