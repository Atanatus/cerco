# CERCO 0.8.1 — Skins: instrucciones para el desarrollador de ATANATUS

**Esta tarea corresponde a la web ATANATUS, no al juego.** CERCO ya incorpora **el renderizado de las skins**, las miniaturas y los mensajes necesarios. ATANATUS debe implementar las compras, propiedad, inventario, botón **Skins** y la persistencia del aspecto equipado.

## Entrega y compatibilidad

- Juego listo para integrar: `cerco_expedition_v081_skins.html`. Un único HTML que sigue funcionando sin conexión y sin archivos externos.
- Catálogo exportado: `CERCO_SKIN_CATALOG_v1.json` (el catálogo de referencia está definido en el HTML; el JSON es una copia distribuible de ese lanzamiento).
- Previews: `cerco_skin_original.png`, `cerco_skin_void_circuit.png` (generados con el **mismo renderizador de CERCO** que usa el personaje en el tablero).
- Adaptador opcional para la web: `CERCO_SKINS_ATANATUS_ADAPTER.js`.
- La integración previa de partidas, eventos, puntuación y auditorías se mantiene intacta (`protocol:1`, `cerco.audit.v1`, `ruleset:CERCO-0.7.0`).
- Nueva versión del juego `0.8.1` y esquema de skins `cerco.skins.v1`.

## Las dos skins disponibles

| ID **exacto** | Nombre | Inicial | Uso |
|---|---|---|---|
| `cerco.default` | Original | **Gratis** | Aspecto clásico. Disponible para todas las cuentas. |
| `cerco.void_circuit` | Void Circuit | **De pago, precio lo decide ATANATUS** | Cubo oscuro, circuitos violetas y pulsos cian. |

**No hay tienda ni compra de skins dentro de CERCO.** La tienda de equipo de las salas seguras es otra mecánica y **no** debe usarse para transacciones de skins. No hay cambios a daño, vida, hitboxes, velocidad, colisiones ni puntos. Ambas skins son solo apariencia.

## Reparto de responsabilidades

**CERCO** mantiene IDs, dibujos/animaciones, miniaturas y el comando cosmético para equipar la skin solicitada.

**ATANATUS** define precio y moneda de la plataforma, autoriza y registra compras, mantiene el inventario persistente del usuario, decide cuál está equipada, y comprueba en el servidor que se posee esa skin antes de comunicar el cambio a CERCO. **No confiar en un evento del navegador como comprobante de propiedad.**

Esquema de datos sugerido para ATANATUS, sin imponer motor SQL ni endpoint:

- `skin_catalog`: `skin_id` (PK), `game_id`, `price`, `currency`, `is_active`.
- `user_skins`: clave única (`user_id`,`skin_id`), `acquired_at`, `source`.
- `user_game_settings`: (`user_id`,`game_id`) único, `equipped_skin_id`.
- Todas las cuentas tienen acceso a `cerco.default` por regla del servidor, sin precisar insertarlo como compra.

En la tienda: obtener catálogo, mostrar preview y precio gestionado por ATANATUS, comprar en servidor, agregar a inventario. En el botón **Skins**: listar `user_skins`, mostrar `Original` disponible, equipar una skin propia, persistir en backend y enviar un solo comando al iframe. Al recargar, cuando el iframe esté listo, volver a comunicar la skin equipada.

## Integración con iframe: contrato exacto

El juego mantiene la envoltura `source:'CERCO',protocol:1`. Se añaden consultas de solo lectura mediante `cerco_query`:

| `query` | Respuesta `event:'query_result'`, `detail` |
|---|---|
| `skin_catalog` | `{schema:'cerco.skins.v1',gameVersion:'0.8.1',skins:[...]}` |
| `skin_state` | `{schema:'cerco.skins.v1',skinId:'cerco.default',cosmeticOnly:true,serverEntitlementVerified:false}` |
| `skin_preview` | `{skinId,mimeType:'image/png',width,height,dataUrl}` con entrada `skinId` y `size` (64–512) |

**Comando nuevo** `action:'cerco_set_skin'` (solo apariencia):

```js
const iframe = document.getElementById('cercoFrame');
const origin = new URL(iframe.src, location.href).origin;
const requestId = crypto.randomUUID();
// SOLO DESPUÉS de verificar la propiedad en el servidor de ATANATUS:
iframe.contentWindow.postMessage({
  source:'ATANATUS', protocol:1, action:'cerco_set_skin',
  requestId, skinId:'cerco.void_circuit'
}, origin);
```

Respuesta enviada directamente a la ventana original:

```js
{
  source:'CERCO', protocol:1, event:'skin_set_result', requestId,
  detail:{ok:true,skinId:'cerco.void_circuit',changed:true,cosmeticOnly:true}
}
```

También se emite `cerco:skin_changed` y el paquete `event:'skin_changed'` por los canales existentes si el aspecto ha cambiado realmente. **Ese evento no significa que la compra esté validada.** Un ID inexistente devuelve `ok:false,error:'unknown_skin'`.

### Ejemplo de consumo con el adaptador opcional

```html
<iframe id="cercoFrame" src="/games/cerco_expedition_v081_skins.html"></iframe>
<script src="/assets/CERCO_SKINS_ATANATUS_ADAPTER.js"></script>
<script>
const skins = new CercoSkinsAdapter(document.getElementById('cercoFrame'));
// Una vez el iframe emita bridge_ready o esté cargado:
async function showSkinShop() {
  const catalog = await skins.catalog();
  for (const skin of catalog.skins) {
    const preview = await skins.preview(skin.id, 256);
    // Tu UI crea una tarjeta, con <img src=preview.dataUrl>, y pone el
    // precio obtenido de TU backend; no lo trae CERCO.
  }
}
async function equipAfterServerAuthorization(skinId) {
  // Tu API autentica al usuario, comprueba user_skins,
  // y persiste user_game_settings.equipped_skin_id.
  const response = await fetch('/YOUR-ENDPOINT-TO-EQUIP', {
    method:'POST', headers:{'Content-Type':'application/json'},
    credentials:'include', body:JSON.stringify({game:'cerco',skinId})
  });
  if (!response.ok) throw new Error('Not owned or authorization failed');
  const body = await response.json(); // {equippedSkinId:'cerco.void_circuit'}
  await skins.equip(body.equippedSkinId);
}
</script>
```

`/YOUR-ENDPOINT-TO-EQUIP` es **una dirección ilustrativa**, no un endpoint creado por CERCO. Añadir protección CSRF y comprobaciones de permisos según la infraestructura real de ATANATUS. El adaptador valida `event.source`, `event.origin` y `requestId` para las respuestas.

### Seguridad del origen

CERCO acepta `cerco_set_skin` **solo desde su parent iframe** y desde un origen incluido en el `<meta name="cerco-trusted-parent-origins">` del HTML, o del mismo origen que el juego. Los valores de lanzamiento son `https://atanatus.com`, `https://www.atanatus.com` y `https://cerco.atanatus.com`. Si se utiliza un dominio de pruebas distinto, **debe añadirse al meta** antes de desplegar; no usar `*` para órdenes de cambio. Las consultas de catálogo/estado siguen disponibles desde el parent, igual que las consultas originales del conector.

La consola del navegador puede alterar su propia apariencia local, como cualquier juego web. **No es una vulnerabilidad de compras** mientras ATANATUS verifique la propiedad y guarde inventario/equipo en el servidor. Ningún cambio cosmético local debe otorgar bienes, puntos ni privilegios.

## Usar la skin desde el HTML local

Al abrir CERCO sin ATANATUS siempre comienza con `cerco.default`. La API de desarrollo del propio juego acepta:

```js
CERCO_BRIDGE.getSkinCatalog();
CERCO_BRIDGE.getSkinPreview('cerco.void_circuit', 256);
CERCO_BRIDGE.setSkin('cerco.void_circuit');
CERCO_BRIDGE.setSkin('cerco.default');
```

Esto es una interfaz visual local, no una forma de comprar ni de acreditar propiedad. Cuando CERCO vive bajo iframe cross-origin, usar los mensajes de arriba, no `iframe.contentWindow.CERCO_BRIDGE`.

## Validación que debe completar ATANATUS

1. Una cuenta nueva ve Original como disponible y Void Circuit como bloqueada con el precio configurado.
2. Una compra válida crea un único registro de propiedad en el servidor (evitar dobles cargos).
3. Tras equipar Void Circuit, CERCO cambia **sin recargar y también durante una partida**; estadísticas y hitbox permanecen iguales.
4. Al refrescar la página, ATANATUS consulta `equipped_skin_id` y lo vuelve a enviar cuando cargue el iframe.
5. Si hay una devolución/revocación, el backend deja de autorizar esa skin y equipa Original en la cuenta.
6. Enviar IDs desconocidos debe devolver error. Enviar desde un parent no autorizado no debe producir cambios.
7. El frontend no debe escribir precios ni posesiones en CERCO, solo consumir las definiciones visuales.

**CERCO 0.8.1 NO implementa pagos, backend, perfil ni botón «Skins» de ATANATUS.** Todos ellos siguen siendo responsabilidad exclusiva del chat de la plataforma.
