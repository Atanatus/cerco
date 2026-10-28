# Operación 41 — Perfil global de invitado

## Contrato

El orden de publicación de este documento queda actualizado por
[OPERATION_42_SAFE_RELEASE.md](OPERATION_42_SAFE_RELEASE.md): primero Worker en
modo compatible, después frontend y la exigencia estricta solo tras superar su
puerta de compatibilidad.

El UUID historico `cerco_guest_id_v1` no autoriza operaciones nuevas. El cliente
conserva una ruta de compatibilidad para pruebas locales, pero el Worker con
`GUEST_IDENTITY_REQUIRED=true` rechaza sesiones sin credencial. Los navegadores
con JavaScript anterior deben recargar antes de iniciar partida o entrar al chat.

Cada instalación del navegador obtiene un único perfil Guest cuando carga CERCO.
El nombre `Guest XXXXXXXX` y el UUID los asigna el Worker; el cliente no puede
elegir ninguno. El botón de edición permanece deshabilitado hasta que exista un
servicio de nombres autenticado.

La recuperación usa un secreto aleatorio de 256 bits guardado en IndexedDB. El
Worker conserva solo su SHA-256. Recuperar el perfil emite un token bearer
independiente, también guardado por hash en D1 y válido durante dos horas. El
token de acceso permanece en memoria; cada recarga recupera el perfil y emite uno
nuevo. Hay un límite de 16 tokens simultáneos por perfil y un límite de creación
de 12 perfiles por IP y hora. Ninguna credencial aparece en logs.

El UUID histórico `cerco_guest_id_v1` no autoriza operaciones. La ruta de
compatibilidad de sesiones anterior solo se usa cuando falta el módulo de perfil
(pruebas/cliente antiguo); la configuración desplegable exige identidad con
`GUEST_IDENTITY_REQUIRED=true`. El cliente actual conserva informes históricos y
reintentos que ya quedaron pendientes: esas partidas tienen `matches.guest_id`
nulo, mantienen su UUID enviado originalmente y no se reescriben.

Las nuevas expediciones usan el mismo perfil autenticado en `/matches/start` y
guardan su ID en `matches.guest_id`. Los informes de esas partidas deben tener el
mismo ID. Todo informe sigue siendo `pending` y `verified=false`; no se escribe en
`results` ni se altera EXP o rankings. Chat valida el token del perfil y usa su
ID/nombre en la sala. Salir o reconectar solo renueva la credencial temporal de
chat. Inventario/equipamiento autentica el mismo ID; Guest no demuestra propiedad
de una skin de pago. Solo `cerco.default` sigue disponible.

El secreto de recuperación se conserva en este navegador hasta que se borren los
datos del sitio. Eliminar esos datos pierde el acceso al perfil y una visita
posterior crea otro; actualmente no hay recuperación entre dispositivos ni
borrado automático de perfiles abandonados en servidor. La pantalla de privacidad
explica este comportamiento.

## Migración y publicación

`backend/d1/migrations/0005_guest_profiles.sql` añade tablas e índices y una
columna nullable a `matches`. No borra ni convierte filas antiguas. Antes de
publicar se debe aplicar esta migración en una fase autorizada de D1, desplegar el
Worker con `GUEST_IDENTITY_REQUIRED=true`, y después publicar el frontend. Worker
y frontend necesitan la misma fase de release: un navegador con la versión
anterior del cliente no dispone del perfil global y puede recibir 401 al iniciar
una sesión nueva. No se debe relajar la autenticación para ocultar ese caso; debe
recargar el cliente actualizado. Los informes locales preexistentes siguen
reenviándose con su token de sesión original.

## Pruebas y reversión

`npm.cmd test` cubre creación y recuperación, concurrencia, dos perfiles,
caducidad, limitación de creación, rechazo de UUID/nombres falsificados, vínculo
de chat/skins/partidas, informes atados al perfil y cero resultados oficiales.
`node tests/browser-smoke.cjs` comprueba primera visita, perfiles distintos en
contextos independientes, recarga y cierre/reapertura completa de Chromium,
entrada/reconexión de chat, partida real 0.8.1, informes, Shop/skins y música.
Todas las escrituras del navegador se enrutan a Miniflare con D1 y Durable Object
locales.

La reversión no debe deshacer la migración ni borrar datos. Si falla el Worker,
se restaura el artefacto previo compatible y la columna/tablas aditivas quedan
sin usar. Si falla el frontend, se conserva el Worker mientras se corrige; volver
a una página que no entiende `/guest/profile` bloqueará nuevas sesiones con la
política estricta, así que solo debe hacerse junto con una reversión compatible
del Worker. En cualquier caso, informes ya aceptados y pendientes permanecen
intactos y no se marcan verificados.

## Estado de publicación

Esta operación solo cambia archivos locales y usa D1/DO efímeros de pruebas. No
se ha aplicado la migración remota, desplegado Worker, publicado Pages ni tocado
ningún dato de producción.
