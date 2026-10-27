# Operaciones 34 y 35: informes y reintentos

Base inspeccionada: `c3e4bb3`. Copias previas en `.local-recovery/op34/` (ignoradas por Git).

## Contrato de informes

`POST /runs/pending` mantiene la autenticación SHA-256 antes de consultar duplicados.
La primera inserción devuelve 201. Un reenvío con los mismos campos e informe
de auditoría devuelve 200 y `accepted: true`, `status: pending`, `verified: false`.
El orden de claves de objetos JSON no importa; el orden de arrays sí.
Un informe distinto para la misma partida devuelve 409; no modifica la fila ni
las fechas. El trigger existente conserva el cierre atómico. No hay migraciones.

El contador de cambios D1 puede incluir el UPDATE del trigger; una inserción
correcta se reconoce por un contador positivo.

## Reintentos del navegador

Finalizar y abandonar tienen un máximo de cuatro intentos totales por sesión,
con pausas de 1, 3 y 10 segundos y timeout de 10 segundos por petición.
Se reintenta ante fallo de red, timeout, respuesta exitosa incompleta y HTTP
408, 429, 500, 502, 503 y 504. Los demás errores detienen los reintentos.
No hay peticiones simultáneas de cierre para una misma sesión.

En esta etapa las credenciales y los reintentos vivían en memoria. La recuperación
posterior y sus límites se describen en [OPERATIONS_36_RECOVERY.md](OPERATIONS_36_RECOVERY.md).
La creación de sesión no se reintenta: ese endpoint no es idempotente.
Los informes siguen siendo datos del cliente sin verificar; no crean resultados
oficiales ni vinculan cuentas.

## Validación local

Ejecutar desde la raíz con Node 24:

```powershell
node --test tests/sessions.test.cjs
git diff --check
```

El arnés usa Miniflare instalado localmente o el incluido en Wrangler global.
La D1 es efímera y aislada, creada desde el esquema y migraciones locales;
no utiliza la configuración ni el identificador de producción.
Las pruebas cubren autenticación, manipulación, duplicados, concurrencia,
caducidad, rankings vacíos separados y cliente con red/temporizadores simulados.

## Publicación pendiente

Requiere autorización explícita: push y despliegues del Worker y frontend.
Publicar primero el Worker con idempotencia y después el cliente con reintentos.
No se requiere migración D1. No se ha realizado ninguna escritura en producción.
