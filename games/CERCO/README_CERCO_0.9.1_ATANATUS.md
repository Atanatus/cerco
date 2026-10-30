# CERCO 0.9.1 BETA — integración para ATANATUS

**Fecha:** 30-10-2026  
**Juego:** CERCO / Expedición  
**Plataforma:** ATANATUS — tienda, usuarios, inventarios, cosméticos y rankings  
**Archivo principal:** `cerco_expedition_v091_beta.html`  
**Versión:** `0.9.1` · **Reglamento competitivo:** `CERCO-0.9.1`  
**Estado:** beta jugable para pruebas, **no aprobado para rankings oficiales sin validación adicional**.

## 1. Qué contiene el HTML

El juego sigue siendo **HTML autocontenido** (CSS, JS y renderizador Canvas integrados). No requiere archivos adicionales para jugar. Conservar:

- Mapa y habitaciones procedurales, 8 direcciones, disparos, sprint y controles táctiles.
- Refugios cada cinco salas (5, 10, 15…), con 45 segundos, equipamiento por créditos de expedición y recogibles.
- Puntuación, combos, créditos de expedición, torretas ofensivas, mejoras, enemigos, modo frenesí e invasión del terreno.
- Dos skins incluidas (`cerco.default`, `cerco.void_circuit`; consultar siempre `skin_catalog` como catálogo canónico) y el renderizador compartido de previews.
- `Style Coins`: drops gratuitos físicos acumulados en el informe; **nunca acreditados directamente** en una cartera de ATANATUS desde el navegador.
- Integración por `postMessage`, CustomEvent y `window.CERCO_BRIDGE` para acceso de mismo origen.

**No** reemplazar el HTML existente de producción sin copia y comparación, y mantener una copia de 0.9.0 para conservar partidas y auditorías previas.

## 2. Cambios de 0.9.0 → 0.9.1

| Sistema | Implementación | Equilibrio |
|---|---|---|
| Interceptor Turret | Mejora `interceptTurret`: genera una torreta defensiva independiente que **solo intercepta proyectiles enemigos** con línea de visión y alcance limitado. | Una torreta, 40 s de vida, despliegue cada 7 s, intercepción cada 0,66 s. No ataca enemigos. |
| Twin Interceptors | Mejora `interceptExtra`, requiere `interceptTurret`. | Permite 2 interceptores simultáneos. El sistema de torretas ofensivas sigue teniendo su propio máximo 1/2. |
| Escudos en refugios | Con la habilidad `shield` equipada y escudo sin llenar, aparecen **hasta dos pickups** adicionales. | Cada uno repone un valor limitado; no restaura automáticamente la barra entera. |
| Guardianes por etapa | En salas 4, 9, 14, 19… se invocan 1, 2, 2, 3… (máximo 3). | Todos deben morir además de completar las bajas. Si alguno sigue vivo, **no** se abre la salida. |
| Infernal Guardian | Nuevo enemigo `devil` (cuernos y cola, paleta granate). | Comparte el rol de miniboss con `boss`; alternan en encuentros de guardianes. |
| Repulsion Pulse | Mejora `repulse` (máximo 3). Onda automática desde el jugador. | Empuja sin daño ni aturdimiento; respeta paredes, enemigos y colocación de torretas. Intervalo inicial 14 s, luego 11 y 8 s. |
| Elección temporizada | Pantalla con **20 s** para decidir habilidad. | Se puede seleccionar, rerollear o pulsar **Skip / tecla 0**. Tras 20 s se omite gratis; tiempo de combate y refugio pausados. |
| Build con límites | Máximo **20 mejoras elegidas** y **7 ramas distintas** por expedición. | Permite subir de nivel ramas existentes hasta el máximo, pero no comprar todas las habilidades. Tras agotar el cupo, se omiten las ofertas. |
| Contaminadores | Pueden colocar zonas radiantes a través de obstáculos, sin depender de la línea visual. | Alcance 12 celdas, aviso previo y máximo de zonas conservado. |
| Proyectiles buscadores | Velocidad, tiempo y giro se intensifican conforme aumenta el nivel de invasión. | Siguen teniendo una duración máxima y chocan con obstáculos/interceptores. |
| Ranged Assault | Mezcla `ranged`, `snarer`, `seeker`, `shaman` y desde niveles posteriores `blighter`. | Se mantienen las cotas de enemigos y proyectiles por rendimiento y legibilidad. |

### Decisiones de diseño a conservar

1. **Dos clases de torretas, sin compartir cupos:** ataque (`turret`/`turretExtra`) e intercepción (`interceptTurret`/`interceptExtra`). Cada una necesita conseguir sus mejoras propias.
2. **Nada de mejoras gratuitas después del cupo:** al alcanzar 20 selecciones, no se pueden acumular niveles infinitos. Límite secundario de siete ramas diferentes.
3. **No hay progreso económico por comprar en la tienda:** todos los nuevos sistemas son de combate y se consiguen con elecciones dentro de la expedición. No son artículos monetizables.
4. **El jugador tiene derecho a no elegir.** Una omisión no gasta créditos y no altera la puntuación. Un reroll continúa costando créditos de expedición y no compra nada en la web.
5. **Los guardianes no son objetos de granja de Style Coins**; tanto `boss` como `devil` quedan excluidos del dropeo cosmético.

## 3. Separar correctamente las economías

**No son la misma cosa:**

1. **Score**: puntuación competitiva que determina el puesto del jugador en el ranking. No es dinero.
2. **Shop credits** (`state.credits`): recursos temporales dentro de la expedición. Se obtienen eliminando enemigos y se gastan en el mercader y rerolls. Desaparecen con la partida.
3. **Style Coins** (`atanatus.style_coins`): monedas gratuitas cosméticas. CERCO representa su aparición y recoge recibos; **el servidor de ATANATUS** decidirá si las acredita a una cartera persistente.
4. **Moneda premium**: exclusiva de ATANATUS. CERCO no genera, verifica ni concede moneda premium. Tampoco permite obtener ventajas competitivas por pago.

Las nuevas mejoras del jugador y la torreta interceptora **no modifican** el protocolo de recompensas de Style Coins.

### Resumen de drops cosméticos existente

- Probabilidad: 3 % por eliminación elegible, con valores crecientes en franjas de cinco salas.
- Se genera una sola moneda física con valor `+X`; solo se cuenta cuando el jugador la recoge antes de caducar.
- No hay drops de Style Coins por `boss`, `devil`, Nukes, cadenas ambientales ni en repeticiones de semillas.
- Los límites son por *valor generado* en cada franja, no una promesa de premio.
- Los límites de tramo, valores y probabilidades exactas se consultan con **`cosmetic_policy`**; no reimplementar tablas de forma estática en ATANATUS.
- `dropId` y `runId` identifican la recogida para el proceso de deduplicación del servidor; **esos IDs proceden del cliente y no prueban legitimidad por sí mismos**.

### Flujo recomendado de acreditación

1. ATANATUS autentica a la persona y crea una sesión de partida en su propio backend (token y límites server-side). La versión actual de CERCO sigue siendo **cliente no confiable**.
2. Al iniciar CERCO, el padre registra el `run_started` y asocia el `runId` reportado a la sesión autorizada.
3. El padre recoge eventos `cosmetic_coin_collected` (e, idealmente, `cosmetic_coin_spawned`) y los guarda como **candidatos no confirmados**, junto con sus `dropId`.
4. Al finalizar `run_finished`, consulta/verifica el informe `cosmetic_report` o el informe anidado en `run_report` y comprueba coherencia, límites, versiones, salas, dobles envíos y progresión plausible. **Esto no garantiza ausencia de manipulación.** Para recompensas seguras hace falta simulación/verificación de servidor o introducir un protocolo de eventos con autoridad suficiente del lado servidor.
5. El backend concede **como máximo una vez** cada recompensa aprobada mediante una transacción de base de datos con clave única compuesta por cuenta, sesión/partida y `dropId` (y una política de idempotencia para el resultado final).
6. La cartera y el inventario se actualizan **solo en base de datos** y ATANATUS muestra el saldo confirmado. Ningún `postMessage` puede incrementar directamente el saldo.

**No introducir una ruta tipo `POST /wallet/add` que acepte la cantidad que diga el navegador.**

## 4. API cliente CERCO

El padre `<iframe>` escucha mensajes de la forma:

```js
window.addEventListener('message', (event) => {
  if (event.source !== cercoIframe.contentWindow) return;
  // Sustituir por el origen REAL de CERCO según el deployment.
  if (event.origin !== 'https://cerco.atanatus.com') return;
  const message = event.data;
  if (message?.source !== 'CERCO' || message.protocol !== 1) return;
  // Manejar message.event, message.detail y, cuando proceda, requestId.
});
```

Para pedir un informe, enviar desde el padre al iframe:

```js
cercoIframe.contentWindow.postMessage({
  source: 'ATANATUS',
  protocol: 1,
  action: 'cerco_query',
  query: 'cosmetic_report',
  requestId: 'consulta-123'
}, 'https://cerco.atanatus.com');
```

**Consultas disponibles** (protocolo 1): `capabilities`, `snapshot`, `run_report`, `skin_catalog`, `skin_state`, `skin_preview`, `cosmetic_policy`, `cosmetic_report`.

**Comando de apariencia** (solo padre de origen permitido):

```js
cercoIframe.contentWindow.postMessage({
  source: 'ATANATUS',
  protocol: 1,
  action: 'cerco_set_skin',
  requestId: 'equipar-123',
  skinId: idConfirmadoEnElServidor
}, 'https://cerco.atanatus.com');
```

Importante: el cambio visual no implica que CERCO haya validado la propiedad. **ATANATUS verifica propiedad/equipamiento antes de enviar la orden.** La lista real de IDs se solicita con `skin_catalog`.

`postMessage` comunica información, no es mecanismo de autenticación. El `targetOrigin` debe ser exacto y el receptor debe comprobar `event.source`, `event.origin`, `source` y `protocol`.

### Eventos importantes

La API mantiene los existentes, incluidos:

- `bridge_ready`, `run_started`, `room_entered`, `room_cleared`, `upgrade_selected`, `upgrade_rerolled`, `gear_purchased`, `pickup_collected`.
- `cosmetic_coin_spawned`, `cosmetic_coin_collected`, `run_finished`, `run_abandoned`, `skin_changed`.
- **Nuevo en 0.9.1: `upgrade_skipped`**, enviado cuando el jugador omite voluntariamente, expira el temporizador o no quedan ofertas por cap.

### Auditoría/analizador: nueva información

La estructura se mantiene como `cerco.audit.v2` (campos añadidos compatibles), pero el **reglamento cambia a `CERCO-0.9.1`**. El informe ahora puede incluir:

```json
{
  "gameVersion": "0.9.1",
  "ruleset": "CERCO-0.9.1",
  "final": {
    "upgradePicks": 12,
    "choiceSkips": 3,
    "guardianSpawned": 2
  },
  "upgradeSkips": [
    {
      "room": 6,
      "activeSeconds": 85.4,
      "reason": "manual",
      "offered": ["damage", "repulse", "interceptTurret"]
    }
  ],
  "killsByType": {
    "devil": 1
  }
}
```

**Ejemplo ilustrativo, no resultado real**. Valores concretos dependen de cada partida. `upgrade_skipped.reason` puede ser `manual`, `timeout` o `cap_reached`.

Los nuevos IDs de mejora son `interceptTurret`, `interceptExtra`, `repulse`. `devil` es el nuevo `enemy.type`. Mantener estos nombres exactamente en el analizador; no reinterpretarlos como tokens, carteras, compras, skins o artículos de pago.

## 5. Ranking y compatibilidad

La fórmula básica del score sigue siendo la de CERCO 0.9.0, pero el jugador puede obtener puntuaciones distintas por **nuevas configuraciones de enemigos y guardianes**. Por ello:

- No comparar puntuaciones 0.9.0 y 0.9.1 como si fueran un mismo reglamento sin validar su equivalencia.
- Guardar `gameVersion`, `ruleset`, `auditSchema`, `runId` y la versión de políticas aplicadas al admitir una partida.
- El analizador debe reconocer varias muertes de guardianes por sala y `devil` como guardian, no como zombi ordinario.
- La verificación del cliente **no equivale** a defensa antitrampas. Hacer un ranking global exclusivamente con reportes falsificables no es seguro.

## 6. Pruebas realizadas sobre 0.9.1

- Sintaxis JS comprobada en Node.js; carga y comienzo de partida en Chromium sin excepciones detectadas.
- Prueba de guardianes: sala 4→1; 9→2; 14→2; 19→3. Eliminar un guardián no permite terminar mientras quedan otros.
- Interceptor destruye un proyectil simulado y no dispara a enemigos.
- Refugio: se colocan dos escudos si la habilidad existe y hay capacidad de recarga.
- Selección: omitir manualmente no cuesta créditos; expirar 20 s provoca omisión; límites de ramas y mejoras aplicados.
- Ranged Assault: se han muestreado los cinco tipos disponibles a partir de la sala 17.
- Resoluciones probadas: 1365×760 (PC), 390×844 (móvil vertical) y 844×390 (móvil horizontal); sin scroll ni errores de ejecución detectados.
- `CERCO_BRIDGE.getCapabilities()` reporta `0.9.1` / `CERCO-0.9.1`, con las consultas y eventos de economía ya existentes.

**Pendiente de validación humana:** dificultad real con distintas builds, tensiones de los guardianes sucesivos, duración total de partidas, conveniencia del cap de 20/7 y nivel de protección de las torretas interceptoras. No se ha demostrado equilibrio competitivo mediante las pruebas automatizadas.

## 7. Orden recomendado para el otro desarrollador

1. **Conservar un backup** del CERCO instalado y comprobar el `version/ruleset` de producción.
2. Probar la versión beta en URL de staging dentro del iframe y confirmar que no afecta al panel ni a la navegación de ATANATUS.
3. Actualizar parser y analizador para aceptar `upgrade_skipped`, `devil` y múltiples guardianes por sala, sin tocar los contratos de Style Coins y skins.
4. Conservar contratos de catálogo y equipamiento de skins existentes; no crear nuevas compras en el HTML.
5. Validar el flujo de identidad/sesión, telemetría, deduplicación y acreditación server-side de Style Coins; la beta no trae backend nuevo.
6. Solo cuando existan pruebas de economía y jugabilidad, promover el reglamento 0.9.1 a los rankings que correspondan.

**Responsabilidades:** desarrollador CERCO = combate, renderizador, reglas, telemetría cliente. Desarrollador ATANATUS = web, autenticación, servidores, carteras, compras, inventario, perfiles, selector de skins, ranking y análisis público.
