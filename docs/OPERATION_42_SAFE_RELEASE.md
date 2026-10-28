# Operación 42 — Publicación gradual de identidad global

## Estado local

La rama `main` está tres commits por delante de `origin/main` en la revisión
`2b8e0cc`. La configuración versionada para el primer despliegue mantiene
`CHAT_ENABLED=true` y fija `GUEST_IDENTITY_REQUIRED=false`. Esta combinación
añade el endpoint y los perfiles nuevos mientras mantiene las rutas del cliente
anterior durante el corte.

La activación estricta no forma parte del primer despliegue. Debe cambiarse a
`true` en un despliegue Worker separado, después de verificar la publicación del
frontend y completar la puerta de compatibilidad descrita abajo.

## Auditoría de `0005_guest_profiles.sql`

La migración solo crea tres tablas y sus índices y añade `matches.guest_id` como
columna nullable con FK. No actualiza, elimina ni asocia filas preexistentes.
Las partidas antiguas quedan con `guest_id = NULL`; los informes, tokens de
sesión, resultados, EXP y rankings no cambian. La migración no es para repetirse
manualmente: Wrangler registra las migraciones aplicadas. No ejecutar la
migración SQL suelta ni alterar el registro de migraciones.

## Secuencia de publicación

### A. Respaldo y preflight

1. Confirmar rama, commits esperados y árbol limpio; comprobar que Pages publica
   desde `main:/` y que no hay otro despliegue Worker concurrente.
2. Antes de escribir D1, obtener un export remoto protegido mediante el
   procedimiento autorizado del operador, guardarlo fuera del repositorio con
   ACL restringida, calcular SHA-256 y comprobar que el archivo se puede leer.
   No incluir el export en artefactos ni logs. Si no se puede verificar el
   respaldo, detenerse.
3. Registrar solo conteos de tablas relevantes (`matches`, `pending_run_reports`,
   `results`) y estado del último cron; no copiar datos de jugador a la bitácora.
4. Verificar `CHAT_ENABLED=true`, secreto existente sin imprimirlo, bindings D1 y
   Durable Object, Cron `0 */6 * * *`, versión Worker y salud actuales.

### B. Migración y Worker compatible

1. Aplicar únicamente la migración 0005 en D1 remoto por Wrangler, una sola vez.
2. Verificar que existen las nuevas tablas/índices y la columna nullable, que
   `PRAGMA foreign_key_check` no devuelve filas y que los conteos de partidas,
   informes y resultados coinciden con el preflight. Confirmar que todas las
   filas antiguas tienen `matches.guest_id IS NULL` y que los informes siguen
   `pending`.
3. Desplegar el Worker de los commits preparados con
   `GUEST_IDENTITY_REQUIRED=false`, sin tocar secreto, Durable Object, D1 binding,
   Cron ni `CHAT_ENABLED`.
4. Verificar `/health`, `/chat/status`, Cron, perfil y expedición 0.8.1. En esta
   fase se admiten los clientes antiguos y nuevos; un UUID viejo no se convierte
   ni se asocia con un perfil.

### C. Frontend

Publicar los commits restantes mediante fast-forward. Esperar a GitHub Pages y
verificar en una sesión limpia que carga el HTML/JS nuevos, muestra primero
`Loading profile…` y después el nombre asignado por CERCO. Verificar una partida,
chat, skins, informe `pending` y su reenvío. Mantener una sesión anterior abierta
y comprobar que puede terminar y entregar su informe con el token de partida que
ya tenía. Sus matches antiguos permanecen sin identidad asociada.

### D. Activación estricta, solo si se puede probar segura

Desplegar otra vez el Worker con `GUEST_IDENTITY_REQUIRED=true` solo cuando:

- Pages entrega los recursos nuevos y el cache de HTML/JS está actualizado.
- Las comprobaciones nuevas de perfil, expedición, chat e informes pasan.
- No quedan partidas antiguas activas sin informe que necesiten finalizar; usar
  la ventana máxima existente de 72 horas y volver a comprobar antes de activar.
- Hay evidencia operativa de que los clientes antiguos ya no intentan iniciar
  sesiones/entrar al chat durante una ventana acordada de al menos 72 horas.
- Se conserva un operador disponible para volver a modo compatible si aparecen
  visitantes antiguos.

El proyecto todavía no tiene telemetría que identifique de forma fiable el uso
de clientes antiguos. Si el operador no puede obtener esa evidencia desde la
observabilidad de Cloudflare, **no activar `true`**: mantener el Worker compatible
evita bloquear jugadores. Un cliente antiguo que vuelva después de activar el
modo estricto recibirá 401 para nuevas sesiones; no existe una forma segura de
adoptar su UUID local como prueba de identidad. Los informes pendientes o las
partidas ya abiertas continúan utilizando sus credenciales originales.

## Verificaciones y contingencia

La prueba local aplica la migración después de poblar la estructura anterior y
compara filas completas de `matches` y `pending_run_reports`; también valida el
cliente viejo/nuevo en modo compatible, dos perfiles, reentrada al chat,
rechazo del cliente viejo en modo estricto, y el informe de una partida anterior
después de activarlo.

Si falla la migración o una comprobación de integridad, no desplegar el Worker ni
el frontend. No borrar tablas, filas o la columna. La recuperación compatible
es detener la secuencia y volver al Worker anterior; la migración aditiva queda
sin uso y no afecta a ese Worker. Si falla el frontend, restaurar la versión
anterior de Pages y dejar el Worker en `false`. No activar modo estricto hasta
publicar y validar de nuevo. Nunca restaurar el export sobre la base viva como
primer paso de rollback.

## Autorización pendiente

No se ejecutaron operaciones remotas. Para publicar habrá que autorizar en un
único alcance: export/validación de respaldo D1, migración remota 0005, despliegue
Worker compatible, push fast-forward de los tres commits, validación de Pages y
sesiones sintéticas acotadas. La activación estricta es una fase separada y
condicional; si no se puede demostrar que no afectará a usuarios con caché viejo,
el sistema debe permanecer en modo compatible.
