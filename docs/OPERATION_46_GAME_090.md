# Operación 46 — CERCO 0.9.0 Beta, integración local

Base: `5206a34`, con 44 y 45B conservadas. Recuperación completa comprobada con `git bundle verify .local-recovery/op46/pre-integration.bundle`. Las versiones 0.8.0, 0.8.1 y 0.8.3 permanecen versionadas y disponibles.

## Fuente y contrato

Se inspeccionó el ZIP de Descargas sin ejecutar contenido ni extraer rutas arbitrarias. CRC correcto, tres entradas regulares con rutas simples. HTML independiente e incluido en ZIP idénticos: SHA-256 `05b55f03e29f3ea130896670af0d0b0805faf9468e2ac7b80bb29447ac090397`. Se conserva byte a byte en `games/CERCO/cerco_expedition_v090.html`; `.gitattributes` impide conversiones CRLF. Originales de Descargas intactos. README y notas completos en `docs/handoff/0.9.0/`.

No se modifica el motor, las reglas, los precios internos, ni se añaden dependencias de red al juego. `0.9.0 / CERCO-0.9.0 / protocol 1 / cerco.audit.v2`, skins y moneda coinciden con el contrato. Las fórmulas de drops se consultaron directamente: el presupuesto restante puede recortar el último valor por debajo del mínimo nominal.

## Plataforma y compatibilidad

El iframe y la etiqueta pública seleccionan 0.9.0. La carga por PLAY ocurre después de instalar los listeners. Las consultas `capabilities`, `skin_catalog` y `skin_state` tras `load` recuperan la inicialización aunque `bridge_ready` haya ocurrido antes. Órdenes con origen exacto, fuente, protocolo y requestId correlacionado; tamaño acotado; cancelación de solicitudes al recargar el iframe. Las capturas detectaron FULLSCREEN solapado con FIRE: el control de la plataforma ocupa ahora una fila propia en flujo, fuera del área del juego, también en pantalla completa. Una prueba geométrica comprueba la separación respecto a los tres controles táctiles.

El cliente invalida las referencias de partidas anteriores al recargar el iframe. Informes terminales ya capturados mantienen su entrega independiente e idempotente. Una partida interrumpida sin informe queda sin recompensa y puede caducar por el Cron existente. Ninguna credencial se transmite al juego.

El Worker acepta los cuatro contratos. No transforma informes en resultados oficiales. `/leaderboards?ruleset=CERCO-0.9.0` selecciona únicamente esa versión. Clientes antiguos sin parámetro conservan `CERCO-0.7.0` (0.8.0/0.8.1); `CERCO-0.8.2` selecciona 0.8.3. No se modifica la vista histórica ni se requieren migraciones. El frontend exige que la respuesta corresponda al ruleset solicitado; conserva los estados de CLAIM THE THRONE.

## Validación

70 pruebas automatizadas aprobadas: hash, artefactos históricos, cuatro contratos, separación efectiva de rankings en D1 local y recarga del iframe. Regresión Chromium de 19 grupos: identidad, chat/moderación/reconexión, Shop, skins, música real, entrega pendiente con respuesta perdida y controles táctiles en vertical/horizontal.

Un escenario Chromium instrumenta únicamente la respuesta HTML en memoria de la prueba para invocar las funciones reales de aparición/eliminación de `seeker` y `blighter`: 505 puntos base, proyectiles guiados, derrota idempotente, abandono y pantalla completa. No es evidencia de juego legítimo, equilibrio validado ni antifraude. El archivo distribuido no contiene hooks de desarrollo. Capturas y logs en `.local-recovery/op46/`.

## Publicación posterior y reversión

No se publica esta operación. Tras autorización independiente: Worker compatible primero, comprobar versiones históricas y 0.9.0, frontend después. Conservar CHAT_ENABLED=true, GUEST_IDENTITY_REQUIRED=false, D1, Durable Object, secreto y Cron. Ante regresión del juego, volver a referenciar 0.8.3 mediante nuevo commit; mantener el Worker ampliado para recibir informes 0.9.0 pendientes. No restaurar D1 ni reescribir historia.

La economía persistente corresponde a 47. Hasta contar con una autoridad suficiente, los eventos cosméticos son declaraciones pendientes, nunca saldo disponible ni resultados verificados.
