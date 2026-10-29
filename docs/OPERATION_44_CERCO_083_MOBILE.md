# Operación 44 — CERCO 0.8.3 Mobile

## Integración local

El HTML recibido se incorpora como `games/CERCO/cerco_expedition_v083_mobile.html`; el original en Descargas no se modifica. El juego 0.8.1 permanece disponible para reversión. La copia local de recuperación está en `.local-recovery/op44/` (ignorada por Git).

Hashes SHA-256 de la entrada auditada y de la copia integrada: `FBF2D98AB595AF30CA863EF57E3F498F9A842068CD0702170B07F72BB8B53828`. La versión 0.8.1 y su copia de recuperación coinciden en `B893716A027637E921D6D0677B33AF24CAD8D2B428C0BDF6958708E3DB9FEB5C`.

## Contratos

0.8.3 utiliza protocolo postMessage 1, ruleset `CERCO-0.8.2` y `cerco.audit.v2`. El Worker acepta explícitamente 0.8.0, 0.8.1 y 0.8.3; para 0.8.3 exige la pareja exacta de ruleset/esquema y las marcas de economía cosmética no verificada. Los informes continúan en `pending`; el contenido de auditoría enviado por el cliente no acredita resultados.

Style Coins, `cosmetic_coin_collected` y `cosmetic_report` permanecen como declaraciones no verificadas del cliente. El Worker no convierte esos datos en saldo, créditos, propiedad ni compras. La economía cosmética no se mezcla con créditos de equipamiento ni puntuaciones competitivas.

La validación del catálogo de skins acepta las versiones 0.8.1 y 0.8.3, manteniendo `cerco.default` y `cerco.void_circuit`. La propiedad de Void Circuit sigue dependiendo del inventario validado por el servidor.

## Publicación y reversión

No se ejecutaron migraciones, escrituras en D1 de producción, despliegues ni push. Para publicar: (1) desplegar Worker con contratos compatibles y verificar salud/API; (2) publicar el frontend mediante fast-forward; (3) validar versión, sesiones e informes `pending`, skins y móvil por HTTPS. Para revertir solo el frontend, usar un nuevo commit que restaure la referencia de `data-src` a `cerco_expedition_v081_skins.html`; no revertir la ampliación compatible del Worker mientras existan sesiones 0.8.3 pendientes. No hay cambios de esquema.

## Verificaciones

`npm test` cubre el contrato 0.8.3 y el Worker mantiene no verificados los informes y monedas declarados. `npm run test:browser` valida el flujo de sesión/reintento y la emulación móvil; revisar su salida en el informe de Operación 44 antes de publicar.
