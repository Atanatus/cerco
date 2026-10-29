# CERCO 0.9.0 → ATANATUS | README de integración

**Documento de traspaso técnico para el desarrollador de la plataforma ATANATUS.**  
**Base auditada:** `cerco_expedition_v090.html` (HTML autocontenido, versión 0.9.0).  
**Fecha:** 29 de octubre de 2026.  
**Estado:** juego beta funcional; *integración económica y verificación en servidor pendientes de ATANATUS*.  
**Idioma de la interfaz del juego:** inglés. Este README está en español para facilitar el trabajo entre chats.

> **TL;DR para empezar:** coloca el HTML como recurso estático; intégralo en un `iframe`; escucha mensajes `source:'CERCO', protocol:1` verificando `event.origin` y `event.source`; crea una sesión de juego *servidor* al recibir `run_started`; registra `cosmetic_coin_collected` **solo como pendiente**; liquida la cartera **una única vez** al validar `run_finished`; configura la tienda y el equipamiento de skins en ATANATUS, no en CERCO. **No se puede atribuir valor económico a mensajes de un navegador sin verificación.**

---

## 1. Qué existe hoy y quién es dueño de cada sistema

| Sistema | CERCO 0.9.0 | ATANATUS (responsabilidad de integración) |
|---|---|---|
| Partida, enemigos, mapas, salas, refugios y combate | Implementados dentro del HTML | Alojar el juego y ofrecer su acceso desde la web |
| Controles PC/móvil | Teclado + ratón; joystick + FIRE/apuntado + SPRINT | Dar espacio y permisos correctos al iframe |
| Puntuación, combos, récords locales | Implementados; récords en `localStorage` | Leaderboard público, persistencia y moderación |
| Auditoría de partidas | `cerco.audit.v2` en eventos y consultas | Verificar, conservar, distinguir versiones y mostrar análisis público |
| Créditos de refugio (`◈`) | Solo dentro de la expedición, para equipamiento y rerolls | **NO** incorporarlos a ninguna cartera de cuenta |
| Style Coins (`✦`) | Drops físicos, recogida, contador temporal, recibos e informe | Crear cartera persistente; validar, liquidar y permitir compras cosméticas |
| Moneda premium | **No implementada en CERCO** | Definición, pagos, saldo, devoluciones y catálogo premium |
| Skins | Dos IDs, renderizado, catálogo, preview y comando de equipamiento | Precios, inventario, propiedad, equipamiento persistente y SHOP/SKINS |
| Perfil, autenticación, compras y base de datos | **No incluidos** | Completamente del lado ATANATUS |
| Prevención de fraude | Solo comprobaciones diagnósticas del cliente | Reglas, sesiones, validación y controles del servidor |

**Regla de diseño innegociable:** todos los cosméticos son decorativos. Nunca conceden daño, vida, velocidad, colisiones diferentes, más monedas, mayor puntuación o acceso competitivo privilegiado. Un usuario que no paga debe competir en igualdad de condiciones.

### Identificadores: no confundirlos

```text
Juego                         CERCO
Versión de cliente            0.9.0
Ruleset competitivo           CERCO-0.9.0
Protocolo de mensajes         1
Esquema de auditoría          cerco.audit.v2
Esquema de monedas            cerco.cosmetics.v1
Esquema de skins              cerco.skins.v1
Currency ID gratuita          atanatus.style_coins
Skin por defecto              cerco.default
Skin especial                 cerco.void_circuit
```

**Importante:** 0.9.0 cambia enemigos, comportamiento y puntuación de nuevos tipos (`seeker` = 245 puntos base, `blighter` = 260). No mezclar sus resultados automáticamente con el ruleset 0.8.x.

---

## 2. Despliegue y arquitectura propuesta

El juego está contenido en **un único archivo HTML con CSS y JavaScript integrados**; no introduce backend ni peticiones de red propias. Alojarlo como estático mediante HTTPS y mostrarlo desde ATANATUS en un iframe. Una ruta de ejemplo (no obligatoria) sería `https://cerco.atanatus.com/cerco_expedition_v090.html`.

```text
┌──────────────────────────────────────────────────────┐
│ ATANATUS (web, autenticación, SHOP, SKINS, perfil)   │
│                                                      │
│   <iframe> CERCO 0.9.0                               │
│       partida local + eventos postMessage            │
│           │                                          │
│           ▼                                          │
│   Adaptador del sitio: valida origen y sesión        │
│           │                                          │
└───────────┼──────────────────────────────────────────┘
            ▼ HTTPS autenticado
  API de ATANATUS + base de datos
    ├─ sesiones y resultados de partida
    ├─ recibos de recogida PENDIENTES
    ├─ cartera + libro mayor de transacciones
    ├─ compras + propiedad de cosméticos
    └─ skin equipada por usuario
```

Ejemplo conceptual de iframe (ajustar ruta/origen y política de seguridad al despliegue real):

```html
<iframe id="cercoFrame"
        src="https://cerco.atanatus.com/cerco_expedition_v090.html"
        title="CERCO Expedition"
        allow="fullscreen"
        style="width:100%;height:100%;border:0"></iframe>
```

- La ventana padre debe suscribirse a `message` **antes de cargar** o crear el iframe, o consultar `capabilities` después de cargarlo; `bridge_ready` puede emitirse antes de que el host esté escuchando.
- Si se usa `sandbox` en el iframe, no bloquear la ejecución de scripts. Revisar cuidadosamente sus restricciones de origen; una configuración que produzca `origin:'null'` rompe las órdenes de skin de CERCO. No conceder permisos extra innecesarios.
- Los recursos estáticos pueden servirse desde el propio dominio de ATANATUS o desde el subdominio del juego. Para comunicar entre orígenes, usar `postMessage`, no acceso directo al DOM del iframe.
- Configuración actual del juego para padres autorizados a cambiar skins: `<meta name="cerco-trusted-parent-origins" content="https://atanatus.com https://www.atanatus.com https://cerco.atanatus.com">`. Si cambia el origen real, actualizar esa lista explícita, sin comodines.
- La interfaz ocupa el viewport asignado; proporcionar una altura efectiva al contenedor padre. El juego usa canvas adaptable y oculta el scroll general.

---

## 3. Cómo se juega: contexto necesario para auditar partidas

- Modo **Expedition** por salas. Las salas **5, 10, 15… son santuarios** (45 segundos); las demás son de combate.
- El jugador se mueve en 8 direcciones, apunta y dispara, usa resistencia para correr, obtiene mejoras y puede instalar hasta dos torretas mediante las habilidades apropiadas.
- La eliminación de enemigos genera puntos y puede generar créditos **temporales**. La racha de bajas permite multiplicadores de puntuación hasta ×3.
- El objetivo de eliminaciones y la velocidad de aparición crecen con la profundidad. Hay guardianes antes del refugio (salas 4, 9, 14…) y asaltos especiales a distancia en las salas 7, 17, 27…
- Los enemigos de 0.9.0 incluyen perseguidores, interceptores, flanqueadores, tiradores, buscadores de disparos guiados (`seeker`), contaminadores (`blighter`), tóxicos, ralentizadores, sanadores, chamanes, fantasmas, brutos, detonadores y guardianes.
- La horda progresa por niveles de amenaza; en etapas avanzadas, una fase de frenesí prolongada puede consumir el suelo disponible. Es una partida de supervivencia destinada a terminar en derrota, con el récord como objetivo.
- El contador de **monedas cosméticas** no influye en el daño, la generación de enemigos ni los puntos. Las monedas solo se proponen como recompensa para el catálogo cosmético de la web.
- `Replay this map seed` produce una **partida de práctica** (`seedReplay:true`), sin generación de Style Coins. ATANATUS debe decidir su elegibilidad competitiva; se recomienda excluirla del ranking oficial.

### Controles

| PC | Móvil |
|---|---|
| `Q W E A S D Z C` movimiento | Joystick táctil izquierdo |
| Ratón / mantener clic: apuntar/disparar | Mantener FIRE; arrastrar para orientar disparo |
| `Space`: sprint | Botón SPRINT |
| `F`: auto-movimiento, si se desbloqueó | Botón AUTO, si corresponde |
| `P`: pausa; `R`: reinicio | Botones de la interfaz |

---

## 4. Las economías: separación absoluta

| Concepto | Identificación | Origen | Persistencia / uso |
|---|---|---|---|
| **Créditos de expedición** | `credits`, icono `◈` | Eliminaciones durante la partida | Solo partida: armadura, núcleo, botas y rerolls; **no tienen valor en la web** |
| **Style Coins gratuitas** | `atanatus.style_coins`, icono `✦` | Moneda física caída de enemigos elegibles | CERCO contabiliza lo recogido; ATANATUS verifica y acredita saldo permanente para cosméticos |
| **Moneda premium** | **ID aún no definido por CERCO** | Compra gestionada por ATANATUS | Solo cosméticos, nunca ventajas; sus precios/operaciones son decisión del sitio |
| **Score** | `score` | Bajas, combos y bonificaciones de sala | Leaderboard y récords; **no es una moneda** |

**No convertir** créditos de refugio ni puntos a Style Coins. **No permitir** comprar créditos de refugio, mejoras, puntuación ni drops con moneda gratuita o premium.

### 4.1 Algoritmo real de drops de Style Coins en 0.9.0

- En una sala de combate, por cada baja **elegible**, se hace una tirada independiente del **3 %** (`CERCO_COIN_DROP_CHANCE = .03`).
- Elegible = eliminación con `origin:'normal'` de un enemigo distinto de `boss`. Excluidas Nukes y explosiones ambientales, repeticiones de semilla, refugios y ciertas bajas finales cuyo premio sería irrecogible.
- Se genera **un solo objeto físico** dorado con valor entero `+X`, no X sprites.
- El valor crece por bloques de cuatro salas de combate y una de refugio. Existe un **presupuesto máximo del valor generado** por bloque, incluso si el jugador no recoge algunas monedas.
- Permanecen **18 segundos**. Deben tocarse con el jugador; las que caducan o se pierden al salir no se conceden.
- Máximo de **12 objetos recogibles simultáneos** en el escenario para intentar crear otro drop (es un límite de ocupación, no doce monedas garantizadas).
- La tirada de moneda usa un generador pseudoaleatorio separado, basado en `seed` y sala; **esto no constituye prueba antifraude** porque el cliente controla el resultado.
- Las recogidas se acumulan en `state.cosmetic.collected` a lo largo de la expedición; aparecen flotantes `+X ✦` y el contador local `Style Coins · this run`.

| Salas de combate | Banda | Valor por objeto | Máximo de valor generado en esa banda |
|---|---:|---:|---:|
| 1–4 | 1 | 2–5 | 40 |
| 6–9 | 2 | 4–8 | 65 |
| 11–14 | 3 | 6–12 | 90 |
| 16–19 | 4 | 8–16 | 115 |
| 21–24 | 5 | 10–20 | 140 |
| 26–29 | 6 | 12–24 | 165 |
| 31–34 | 7 | 14–28 | 190 |
| 36–39 y posteriores | 8+ | Sigue creciendo con límites | 200 |

**La probabilidad del 3 % no implica 30 monedas por 100 bajas**. Una tirada con éxito crea una moneda física cuyo valor depende de la banda; la ganancia real exige recogerla y está sujeta a límites. Estos son **parámetros beta de equilibrio**, no precios ni recompensas perpetuas garantizadas.

Consultar la configuración vigente del juego mediante `cosmetic_policy`; en el código están las funciones `cercoCoinPolicy`, `cercoCosmeticTryDrop`, `cercoCosmeticCollect` y `cercoCosmeticReport`. Si se cambia la fórmula económica en futuras versiones, versionar la política/ruleset y actualizar la validación del backend.

### 4.2 Qué recibos produce el juego

**En la aparición**, `cosmetic_coin_spawned` solo registra que nació un objeto. **Al recogerlo**, `cosmetic_coin_collected` produce un recibo como este (valores ilustrativos, campos reales):

```json
{
  "source": "CERCO",
  "protocol": 1,
  "event": "cosmetic_coin_collected",
  "detail": {
    "runId": "ID-CLIENTE-DE-LA-PARTIDA",
    "gameVersion": "0.9.0",
    "ruleset": "CERCO-0.9.0",
    "eventSeq": 42,
    "seedReplay": false,
    "currencyId": "atanatus.style_coins",
    "coin": {
      "dropId": "ID-CLIENTE-DE-LA-PARTIDA:coin:4",
      "room": 6,
      "band": 2,
      "currencyId": "atanatus.style_coins",
      "value": 6,
      "enemyType": "normal",
      "eligibleKillNumberInRoom": 20,
      "spawnedAtActiveSeconds": 210.3,
      "collectedAtActiveSeconds": 213.1
    },
    "runCosmeticTotal": 18,
    "creditable": false,
    "trust": "client_reported_unverified"
  }
}
```

**La identidad persistente de una recompensa es `(sesión_servidor, dropId)`**. Un `dropId` es único solo en el contexto de la partida; por sí solo **no demuestra autenticidad**. `runCosmeticTotal` es el contador local, nunca el saldo oficial.

> **Advertencia sobre doble conteo:** después de `cosmetic_coin_collected`, CERCO también emite `pickup_collected` con `pickupType:'style_coin'` por compatibilidad de telemetría. **No acreditar ambas señales.** La primera es el evento detallado; la segunda, puramente informativa.

### 4.3 Cuándo liquidar la recompensa

La versión actual emite `run_finished` con resultado `defeat` y un informe final completo. Recoge también un `run_abandoned` cuando el usuario confirma abandonar. **No existe una API de cartera dentro del juego ni garantía de liquidación automática de lo recogido si se cierra la pestaña**.

Política inicial recomendada para evitar discrepancias: **liquidar una sola vez al recibir y validar `run_finished`; dejar `run_abandoned` y cierres sin final en pendiente/no acreditados** hasta diseñar checkpoints autenticados. Esto respeta que morir no borra lo recogido en la partida terminada, sin prometer un saldo persistente antes de su validación. Si ATANATUS decide acreditar durante la partida, debe diseñar un protocolo de checkpoints idempotentes que no dependa únicamente de mensajes falsificables del cliente.

---

## 5. Skins: API visual lista, comercio pendiente

Catálogo actual, con IDs **exactos y estables**:

| ID | Nombre | Clasificación interna | ¿Gratis por defecto? |
|---|---|---|---|
| `cerco.default` | Original | `starter` | Sí |
| `cerco.void_circuit` | Void Circuit | `rare` | No; el precio y la moneda se definen en ATANATUS |

- Ambas son **cosméticas**. Sus dibujos y miniaturas se producen con la misma función del juego, `cercoDrawAvatar`.
- En el **SHOP** de ATANATUS se muestra el catálogo del juego más los precios, disponibilidad, eventos y propiedad que decida el backend.
- En **SKINS** se muestra el inventario del usuario, se permite seleccionar una **skin poseída** y se persiste `equipped_skin_id` en el servidor.
- Tras verificar la propiedad, ATANATUS envía `cerco_set_skin` al iframe. El juego cambia visualmente sin reiniciar la partida.
- CERCO responde a IDs desconocidos con `ok:false, error:'unknown_skin'`, pero **no comprueba compras ni propiedad**.
- Al recargar CERCO empieza con `cerco.default`. ATANATUS debe recuperar el equipamiento persistido y reenviarlo tras cargar el iframe.
- Los precios, rarezas comerciales, promociones y catálogo premium no deben inventarse en el código del juego. Puede haber cosméticos gratuitos, eventuales y exclusivos; nunca ofrecer ventajas jugables.

### Orden de equipamiento mediante `postMessage`

```js
// Ejecutar SOLO después de autorizar la propiedad en el backend de ATANATUS.
const frame = document.querySelector('#cercoFrame');
const gameOrigin = new URL(frame.src, location.href).origin;
frame.contentWindow.postMessage({
  source: 'ATANATUS', protocol: 1,
  action: 'cerco_set_skin', requestId: crypto.randomUUID(),
  skinId: 'cerco.void_circuit'
}, gameOrigin);
```

Respuesta: `event:'skin_set_result'`, `requestId` coincidente, `detail:{ok:true, skinId:'cerco.void_circuit',changed:true,cosmeticOnly:true}`. Al cambiar de verdad también aparece `skin_changed`. El campo `serverEntitlementVerified:false` en el estado del juego **no significa que la web no haya validado**: significa que CERCO no puede verificarlo por sí mismo.

Para obtener la miniatura (64–512 px), consultar `skin_preview` con `{skinId:'cerco.void_circuit', size:256}`; devuelve `detail.dataUrl` (PNG). Es una imagen **generada**, no una URL estática permanente. Se puede cachear por `(skinId, visualVersion, size)` en el sitio.

---

## 6. API de CERCO: mensajes, consultas y eventos

### 6.1 Transportes

**Principal para integraciones entre dominios:** `window.parent.postMessage({source:'CERCO',protocol:1,event,detail}, '*')`.

**Alternativos dentro del documento del juego:**

```js
window.addEventListener('cerco:event', e => console.log(e.detail));
window.addEventListener('cerco:run_finished', e => console.log(e.detail));
window.CERCO_BRIDGE.getCapabilities(); // solo acceso permitido al contexto del juego
```

La web debe validar **simultáneamente** `event.source === iframe.contentWindow`, `event.origin === GAME_ORIGIN`, `data.source === 'CERCO'` y `data.protocol === 1`. CERCO envía eventos generales con destino `'*'`, por lo que **la comprobación de origen del receptor es imprescindible**. Los eventos del navegador pueden ser manipulados: validar origen no equivale a verificar una partida.

### 6.2 Eventos que CERCO 0.9.0 anuncia en `capabilities`

| Evento | Cuándo | Uso recomendado en ATANATUS |
|---|---|---|
| `bridge_ready` | El script de CERCO ha inicializado el conector | Habilitar consultas y sincronizar skin equipada |
| `run_started` | Arranca una expedición | Asociar al usuario y solicitar/crear sesión **en servidor**; registrar seed y ruleset |
| `room_entered` | Comienza sala/refugio | Telemetría de progresión |
| `room_cleared` | Objetivo cumplido | Checkpoint lógico y datos de sala |
| `upgrade_selected` | Elige una mejora | Auditoría de build |
| `upgrade_rerolled` | Cambia oferta de cartas | Auditoría de gasto de créditos de partida |
| `gear_purchased` | Compra equipamiento de refugio | Auditoría de equipo; **no mover saldo de Style Coins** |
| `pickup_collected` | Recoge vida, escudo, Nuke o Style Coin | Telemetría; si es moneda, **no pagar por este evento** |
| `cosmetic_coin_spawned` | Nace moneda física | Evidencia diagnóstica opcional, nunca abono |
| `cosmetic_coin_collected` | Recoge moneda física | Registrar recibo **pendiente**, con deduplicación |
| `skin_changed` | Cambia la apariencia local | Telemetría visual, **no prueba de compra** |
| `run_finished` | Partida terminada por derrota | Verificar resultado y liquidar **una sola vez** |
| `run_abandoned` | Abandono confirmado | Cerrar sesión o marcar pendiente según política del servidor |

Respuestas a consultas y órdenes: `query_result` y `skin_set_result`. No son eventos de recompensa.

### 6.3 Consultar el juego desde el padre

```js
const frame = document.querySelector('#cercoFrame');
const gameOrigin = new URL(frame.src, location.href).origin;
const requestId = crypto.randomUUID();
frame.contentWindow.postMessage({
  source: 'ATANATUS', protocol: 1,
  action: 'cerco_query', requestId, query: 'cosmetic_report'
}, gameOrigin);
```

CERCO devuelve al mismo padre un mensaje de tipo:

```js
{
  source: 'CERCO', protocol: 1,
  event: 'query_result', requestId, query: 'cosmetic_report',
  detail: { /* informe solicitado */ }
}
```

El host debe correlacionar `requestId`, verificar origen/fuente y limitar el número/tamaño de consultas y mensajes. El juego exige `requestId` de texto de longitud no mayor de 100 caracteres. Las consultas son de **solo lectura**.

| `query` permitida | Respuesta |
|---|---|
| `capabilities` | Versión, schemas, eventos y comandos |
| `snapshot` | Estado compacto actual (`runId`, sala, kills, score, seed, skin, Style Coins, etc.) |
| `run_report` | Auditoría completa `cerco.audit.v2`, o `null` si no hay partida |
| `skin_catalog` | Catálogo `cerco.skins.v1` |
| `skin_state` | Skin visible actualmente |
| `skin_preview` | Imagen PNG `dataUrl` con `skinId`/`size` |
| `cosmetic_policy` | Reglas de drops `cerco.cosmetics.v1` |
| `cosmetic_report` | Recibos y métricas acumuladas de Style Coins |

El objeto `window.CERCO_BRIDGE` existe dentro del HTML del juego y expone `getSnapshot()`, `getRunReport()`, `getCapabilities()`, `getSkinCatalog()`, `getSkinState()`, `getSkinPreview()`, `setSkin()`, `getCosmeticPolicy()` y `getCosmeticReport()`. **En iframe cross-origin, emplear mensajes**, no intentar leer `iframe.contentWindow.CERCO_BRIDGE`.

El adaptador antiguo `CERCO_ATANATUS_STYLE_COINS_ADAPTER.js` sirve **solo para transporte** de eventos de economía/consultas básicas; **no crea usuarios, sesiones ni wallets** y no implementa todas las consultas de skins de 0.9.0. No tratarlo como implementación de backend.

### 6.4 Estructura del `snapshot` (campos destacados)

```js
{
  runId,                // identificador LOCAL del navegador; no es token
  gameVersion,          // "0.9.0"
  ruleset,              // "CERCO-0.9.0"
  mode,                 // estado del cliente
  seed, seedReplay, room, roomsCleared,
  kills, roomKills, roomGoal, score, credits,
  activeSeconds, health, skinId,
  boardColumns, boardRows,
  styleCoinsRun,        // total LOCAL recogido, aún no acreditado
  styleCoinCurrency,    // "atanatus.style_coins"
  styleCoinsVerified,   // false: CERCO no puede validar backend
  finished, auditSchema, eventSeq
}
```

### 6.5 Informe final de partida

El evento `run_finished` contiene `detail.audit`, que incluye:

- `schema`, `gameVersion`, `ruleset`, `runId`, `seed`, `seedReplay`, `result`, `activeSeconds`.
- `final`: sala, salas completadas, eliminaciones, puntuación, créditos temporales, Style Coins recogidas, vida, dimensiones del tablero, build, equipamiento y skin visible.
- `scoreBreakdown`: `baseKills`, `comboBonus`, `roomBonuses`, `total`.
- `economy`: créditos de partida ganados/gastados y balance, **distintos de Style Coins**.
- `killsByType`, `killBuckets`, máximos de combo y multiplicador, bajas de Nuke/ambientales.
- `upgrades`, `gearPurchases`, `rerolls`, `pickups`, `rooms`.
- `rooms[*].invasionTier`, `hazardsCreated`, `maxEncroachment` (nuevos campos de 0.9.0).
- `cosmeticEconomy`: informe de moneda gratuita (ver apartado siguiente).
- `diagnosticChecks`: comprobaciones aritméticas informativas.
- `trust:'client_reported_unverified'`.

`startedAtClient` y `activeSeconds` vienen del propio dispositivo. **No probar tiempos auténticos solo con esos campos**.

### 6.6 Informe económico `cosmetic_report`

```js
{
  schema: 'cerco.cosmetics.v1',
  currencyId: 'atanatus.style_coins',
  collected: 29,          // total de Style Coins recogidas, no acreditadas
  collectedCount: 6,     // número de objetos físicos recogidos
  spawnedValue: 36,      // valor total aparecido en suelo
  spawnedCount: 8,
  rooms: [...],           // desglose por sala
  bands: [...],           // desglose por bloque de 5 salas
  spawns: [...],          // dropId y datos de cada aparición
  receipts: [...],        // dropId + collectedAtActiveSeconds
  diagnosticChecks: {
    receiptSumMatchesTotal: true,
    receiptIdsUnique: true,
    receiptsReferenceSpawn: true,
    spawnedBandCapsRespected: true,
    collectedDoesNotExceedSpawned: true
  },
  trust: 'client_reported_unverified',
  serverWalletCredited: false
}
```

**Los indicadores `diagnosticChecks:true` son autoconsistencia declarada por el cliente, no certificación antifraude.** Siempre recalcularlos en backend.

---

## 7. Backend ATANATUS: tareas concretas para conectar la economía

**Esto es una propuesta de integración, no funcionalidad ya creada.** Adaptar entidades y endpoints a la arquitectura y nombres existentes de ATANATUS; evitar duplicar tablas o rutas si el otro chat ya ha implementado parte.

### 7.1 Entidades mínimas recomendadas

| Entidad lógica | Campos importantes | Restricciones |
|---|---|---|
| `game_sessions` | `server_session_id`, `user_id`, `client_run_id`, `game_id`, `ruleset`, `seed`, `seed_replay`, `started_at_server`, `finished_at_server`, `status`, token/credencial de sesión | ID server autoritativo; vínculo usuario; control de estado |
| `coin_receipts` | `server_session_id`, `drop_id`, `room`, `band`, `value`, `client_event_seq`, `status` | `UNIQUE(server_session_id, drop_id)` |
| `wallets` | `user_id`, `currency_id`, `balance` | `UNIQUE(user_id, currency_id)`; no negativo |
| `wallet_ledger` | `entry_id`, `user_id`, `currency_id`, `delta`, `source_type`, `source_id`, `created_at` | Idempotencia de settlement y de compras; libro mayor auditable |
| `shop_catalog` | `item_id`, `game_id`, `skin_id`, `currency_id`, `price`, `active`, `availability` | ID de skin conocido por catálogo de CERCO |
| `user_cosmetics` | `user_id`, `item_id`/`skin_id`, `acquired_at`, `source` | Propiedad única por usuario y cosmético |
| `user_equipment` | `user_id`, `game_id`, `equipped_skin_id` | Equipo único; backend comprueba propiedad |
| `orders` | `order_id`, `user_id`, `item_id`, `status`, `amount`, `currency_id` | Compra repetida no puede cobrar dos veces |

**La moneda premium necesita un ID y reglas de pago definidos por ATANATUS; CERCO no proporciona uno.** Si existe ya un esquema de cuentas/carteras, reutilizarlo.

### 7.2 Flujo de integración recomendado

```text
[1] El usuario autenticado abre CERCO.
[2] CERCO emite run_started con runId/seed/ruleset locales.
[3] ATANATUS crea sesión autoritativa para ese usuario,
    registra hora del servidor y emite credencial protegida.
[4] CERCO emite cosmetic_coin_spawned → log opcional, sin saldo.
[5] CERCO emite cosmetic_coin_collected → pending en backend,
    deduplicado por sesión + dropId, NUNCA saldo directo.
[6] CERCO emite run_finished → auditoría completa.
[7] ATANATUS valida sesión, tiempo, ruleset, seedReplay,
    recibos, caps y consistencia; decide aceptar/rechazar.
[8] Si acepta: transacción atómica e idempotente:
    marcar sesión liquidada + insertar ledger + sumar wallet.
[9] SHOP compra cosméticos con balance del servidor.
[10] SKINS consulta propiedad y guarda skin equipada;
     ATANATUS manda cerco_set_skin al juego.
```

**Atención a una limitación de arquitectura:** el HTML 0.9.0 **no recibe ni envía credenciales de sesión emitidas por el servidor**, y la web no puede convertir la emisión de eventos del navegador en un origen de datos confiable por sí sola. La asociación y el envío a la API pertenecen al padre; si se quiere vinculación/atestación fuerte dentro del juego, hará falta una ampliación coordinada del protocolo de CERCO o un sistema de replay/validación independiente. No se debe afirmar “partida verificada” por recibir un `runId` o un JSON coherente.

### 7.3 Validaciones mínimas en servidor

1. Usuario autenticado; sesión vigente, suya, no liquidada y asociada a `CERCO-0.9.0`.
2. `runId` del cliente ligado a la sesión del servidor; **no usar `runId` como credencial secreta**.
3. `seedReplay === false` para rewards; comprobar política competitiva sobre replays.
4. Recibos únicos; cada recibo referencia un spawn; suma de `receipts.value` = `collected` = `final.styleCoinsRun`.
5. Todos los objetos respetan tipos, valores enteros, salas de combate, bandas y límites **de valor generado**.
6. Tiempos de aparición y recogida ordenados, no anteriores al inicio, no posteriores al final; duración total plausible según reloj del servidor (con margen razonable por pausas/latencia).
7. `eventSeq` y transiciones de salas con orden plausible; informes de puntos, eliminaciones, créditos, combos, mejoras y compras internos coherentes.
8. Recalcular en backend cualquier suma/diagnóstico en lugar de fiarse de `diagnosticChecks`.
9. Controlar límites de petición, tamaño de informe, frecuencia de envío, y no incluir datos personales/tokens en el analizador público.
10. Implementar transacción **idempotente**: si el cliente reenvía `run_finished`, el ledger y la cartera no cambian dos veces.

La validación de plausibilidad es **un filtro contra abuso básico, no antitrampas absoluto**. La simulación sigue en JavaScript del cliente y puede falsificarse; para un leaderboard realmente competitivo harán falta medidas más fuertes (reproducción determinista verificable, validación autoritativa u otra estrategia revisada).

### 7.4 Compra de skins con Style Coins

Flujo **solo servidor**:

1. Validar sesión del usuario y que el producto está activo y disponible.
2. Revisar propiedad; si ya lo tiene, no cobrar de nuevo.
3. Comprobar `wallets[atanatus.style_coins] >= precio`.
4. En una operación atómica: descontar balance, añadir entrada negativa a ledger, crear propiedad y marcar compra finalizada; usar `order_id`/clave de idempotencia.
5. Devolver inventario y nuevo saldo al frontend.
6. El botón SKINS consulta el inventario validado y persiste el equipamiento; al cargar CERCO enviar `cerco_set_skin`.

Las skins premium siguen flujo de checkout/refund propio del backend; jamás confiar en una pantalla de confirmación del navegador como prueba del cobro. Un reembolso o revocación debe afectar la propiedad y devolver al usuario a `cerco.default` si corresponde.

### 7.5 Riesgos de integración a tener en cuenta

- **No hacer `wallet += coin.value` desde `onCoinCollected`.** Es un evento de cliente falsificable y también hay un segundo evento genérico que causaría duplicados.
- **No liquidar simultáneamente por recogidas y por informe final.** Elegir una sola fuente canónica de abono con transacción idempotente.
- **No mezclar `credits`, `score`, `styleCoinsRun` ni saldo oficial.** Son unidades distintas.
- **No hacer compras dentro del HTML CERCO** ni crear atajos para convertir moneda real en poder de combate.
- **No confiar en que los `runId` sean únicos globalmente a efectos de seguridad.** Identificador servidor independiente.
- **No integrar a ciegas 0.9.0 con un validador hecho para 0.8.x.** Son rulesets diferentes.
- **No asumir que la seed hace el combate reproducible enteramente.** El RNG de monedas es específico por sala, pero la lógica de combate usa también fuentes de aleatoriedad del navegador; no hay un input log certificado de reproducción completa.
- **No tratar previews `dataUrl` como assets de compra ni como prueba de inventario.** Son solo gráficos.
- **No publicar logs completos de usuario con tokens o identificadores de sesión sensibles.** El reporte público debe ser una proyección sanitizada.

---

## 8. Ejemplo seguro de recepción de eventos en ATANATUS

Este fragmento **solo recibe y enruta** eventos. Los nombres `onCerco...` son funciones **que debe implementar ATANATUS** según su API. No acredita dinero y no constituye un sistema antifraude.

```js
const cercoFrame = document.getElementById('cercoFrame');
const cercoOrigin = new URL(cercoFrame.src, location.href).origin;

window.addEventListener('message', async (event) => {
  if (event.source !== cercoFrame.contentWindow || event.origin !== cercoOrigin) return;
  const message = event.data;
  if (!message || message.source !== 'CERCO' || message.protocol !== 1) return;

  const { event: name, detail } = message;
  switch (name) {
    case 'bridge_ready':
      await onCercoReady(); // consultar equipamiento autorizado y re-equipar
      break;
    case 'run_started':
      await onCercoRunStarted(detail); // crear sesión servidor; sin confiar en runId
      break;
    case 'cosmetic_coin_collected':
      await onCercoCoinPending(detail); // pendiente, deduplicado, NUNCA sumar cartera
      break;
    case 'run_finished':
      await onCercoRunFinished(detail); // enviar informe al servidor para validar/liquidar
      break;
    case 'run_abandoned':
      await onCercoRunAbandoned(detail); // marcar abandono según política
      break;
  }
});
```

**Detalle operativo:** el envío de eventos no espera a la API del padre. Si `run_started` todavía se está creando cuando llegan recibos, el adaptador debe **ponerlos en cola por `runId` hasta recibir `server_session_id`**, preservando orden y deduplicación. Si el frontend se recarga o falla la red, que el backend y los reintentos sean idempotentes; no sumar dos veces.

---

## 9. Orden de trabajo para el desarrollador de ATANATUS

### Fase A — Conexión sin economía

- [ ] Servir la versión correcta `cerco_expedition_v090.html` por HTTPS.
- [ ] Incrustar iframe con alto útil en escritorio y móvil.
- [ ] Escuchar `postMessage` con validación de origen y fuente.
- [ ] Consultar `capabilities`, `snapshot`, `skin_catalog`, `cosmetic_policy`.
- [ ] Sincronizar la skin previamente equipada desde el backend.

### Fase B — Recompensas gratuitas

- [ ] Registrar `atanatus.style_coins` como moneda no premium y solo cosmética.
- [ ] Crear sesiones servidor asociadas al usuario y ruleset.
- [ ] Recibir/correlacionar `cosmetic_coin_collected` como pendientes, nunca como saldo.
- [ ] Validar auditoría `run_finished` y `cosmetic_report`.
- [ ] Implementar settlement transaccional idempotente y ledger.
- [ ] Mostrar saldo **verificado** en ATANATUS, separado de `styleCoinsRun`.
- [ ] Resolver las partidas abandonadas, desconexiones y cierres de pestaña con política explícita.

### Fase C — SHOP y SKINS

- [ ] Exponer catálogo con moneda, precio, disponibilidad y propiedad.
- [ ] Añadir `cerco.default` gratis para todos y `cerco.void_circuit` como cosmético adquirible según precio fijado por ATANATUS.
- [ ] Comprar con operación atómica/ledger; evitar dobles cargos.
- [ ] Guardar inventario y skin equipada.
- [ ] Enviar `cerco_set_skin` solo tras autorizar propiedad, re-equipar en cargas nuevas.
- [ ] Añadir cartera y checkout premium en la web cuando se defina la tercera unidad; **nada de poder competitivo**.

### Fase D — Auditoría, QA y publicación

- [ ] Publicar resultados de 0.9.0 etiquetados por `ruleset`, sin mezclarlos con 0.8.x.
- [ ] Probar doble `coin_collected`, doble `run_finished`, recarga de web y fallo de red.
- [ ] Probar un usuario sin saldo, compra insuficiente, compra repetida, skin no poseída, devolución y equipamiento restaurado.
- [ ] Probar replays (`seedReplay:true`), monedas caducadas, bandas/caps, abandono y muerte.
- [ ] Probar origen no autorizado y un `requestId` incorrecto.
- [ ] Probar móvil vertical/horizontal y PC sin tocar la lógica del juego.
- [ ] Diferenciar públicamente `client_reported_unverified`, resultados estadísticamente consistentes y validaciones realmente fuertes.

---

## 10. Criterios de aceptación: integración terminada de verdad

**Prueba positiva:** usuario autenticado inicia partida nueva, recoge dos monedas con `dropId` diferentes, muere, ATANATUS acepta el resultado, el ledger acredita **exactamente la suma de ambas** una sola vez, el saldo mostrado aumenta, compra una skin disponible, el inventario la registra y el botón SKINS la equipa inmediatamente y tras refrescar.

**Prueba negativa:** reenviar esos mismos dos recibos, duplicar el informe final, enviar el evento genérico `pickup_collected`, simular una compra desde la consola, equipar una skin no poseída o iniciar un replay de seed **no aumenta saldo, no cobra duplicado ni concede propiedad**.

**Prueba de separación:** comprar equipamiento de refugio gasta `◈`, no `✦`; recoger Style Coins no cambia `◈`, score, daño, HP ni estadísticas; vestir Void Circuit tampoco.

### Estado de implementación y pruebas

- **Código verificado para este README:** el HTML `cerco_expedition_v090.html` y sus interfaces definidas en JavaScript.
- **No implementado aquí:** API, sesiones autoritativas, carteras, checkout, precios definitivos, inventario, compras o verificación fuerte.
- **Beta:** enemigos, límites y cantidades económicas aún sujetos a playtesting. No anunciar ingresos garantizados por partida.
- **No modificar CERCO para cambiar la apariencia comercial de la tienda** salvo que se añadan skins/capacidades visuales. El sitio debe conservar autonomía sobre precios, propiedad y promociones.

---

## 11. Referencias de código en el archivo fuente (para encontrar todo rápido)

| Buscar en `cerco_expedition_v090.html` | Qué contiene |
|---|---|
| `CERCO_VERSION`, `CERCO_RULESET` | Versión y reglamento |
| `CERCO_SKINS`, `cercoDrawAvatar`, `cercoSetSkin`, `cercoSkinPreview` | Skins, dibujo, cambio y miniaturas |
| `cercoTrustedParentOrigin` | Orígenes admitidos para equipamiento |
| `cercoSnapshot`, `emitCercoEvent`, `cercoBridgeCapabilities` | API de eventos |
| `window.addEventListener('message'` | Consultas y comandos desde el padre |
| `Object.defineProperty(window,'CERCO_BRIDGE'` | API de acceso local |
| `cercoCoinPolicy`, `cercoCosmeticTryDrop` | Generación de moneda gratuita |
| `cercoCosmeticCollect`, `cercoCosmeticReport` | Recogida y recibos de moneda |
| `cercoAuditReport`, `cercoAuditKill`, `cercoAuditCredits` | Auditoría y conciliación de partidas |
| `begin`, `prepareStage`, `waveRules`, `finishRun`, `confirmReset` | Ciclo de vida de partida |
| `equipmentOffer`, `purchase`, `rerollUpgradeChoices` | Créditos y comercio **solo interno** |
| `invasionTier`, `spawnEnemy`, `updateContamination`, `updateEncroachment` | Nuevo equilibrio de enemigos y presión |
| `touchJoy`, `touchFire`, `touchSprint` | Control móvil |

**Si la web necesita un evento adicional o una comprobación que el juego no emite**, definir primero el contrato con el desarrollador de CERCO. No inventar campos, modificar el HTML a ciegas ni asumir que una consulta hace operaciones de escritura.

**Fin del README.**
