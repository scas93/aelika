# Impresión de comandas y hardware

## Decisión vigente

La comanda B2C se imprime con **WebUSB y comandos ESC/POS crudos** (Escenario B de la sección 2.9 de `Aelika - Documento de Planeacion.md`): el navegador manda los bytes directo por USB, sin depender de ningún driver del sistema operativo ni de un puente/agente local. `window.print()` se conserva como botón de respaldo secundario, no como ruta principal.

## Por qué (la historia de la GHIA, una sola vez)

Hardware de referencia: impresora térmica **GHIA GTP801** (80 mm, USB + Ethernet, ESC/POS), comprada para pruebas. La ruta de driver de sistema (imprimir vía el spooler del SO) no funcionó en macOS — GHIA no tiene driver de Mac utilizable — así que se saltó directo al plan B ya documentado en la planeación en vez de perder tiempo ahí. No introducir CloudPRNT/impresión en red hasta que se decida esa etapa (en la planeación original, "Fase 4").

## Implementación

- `frontend/lib/thermal-printer.ts`. `@point-of-sale/receipt-printer-encoder` (reemplaza a `esc-pos-encoder`, deprecado; mismo API) arma el ticket (nombre del negocio, folio grande, hora de recogida, productos, notas resaltadas, datos fiscales si aplica, `cut()` al final) y `.encode()` da un `Uint8Array` que se manda con `device.transferOut()`.
- `navigator.usb.getDevices()` reutiliza el permiso ya otorgado (el selector del navegador solo aparece la primera vez por computadora); si viene vacío se llama `requestDevice({filters: []})`.
- **Requiere Chrome o Edge:** `navigator.usb` no existe en Safari/Firefox; la UI lo detecta y deshabilita el botón con un aviso en vez de fallar en silencio. Es aceptable porque el panel se usa desde una computadora fija del negocio.
- Botón principal "Imprimir ticket" dentro de cada card expandida en `/dashboard/pedidos`; respaldo "Imprimir con el navegador" (`window.print()` + `#comanda-imprimible` oculto + `@media print`), más chico, para máquinas donde WebUSB falle.
- `entregaLinea(order, nombrePuntoEnvio)` se exporta desde `thermal-printer.ts` para que el ticket y el respaldo muestren el mismo texto. El ticket incluye el bloque " DATOS FISCALES " invertido cuando `requiereFactura` (un campo por línea; 80 mm a 42 columnas tiene espacio de sobra).
- **Nota conocida:** si la sesión es de Operador/Gerente, el nombre del negocio puede faltar en el ticket (ver pedidos-b2c.md).

## B2B (Entregas del día)

**Imprimir es solo por el diálogo del navegador** (`frontend/app/dashboard/pedidos-b2b/dia/comanda-b2b-imprimible.tsx`, ticket de 80 mm de esa entrega, sin precios; sirve para cualquier impresora instalada en el sistema, USB o red, y con Chrome en modo kiosk-printing sale sin diálogo). No hay impresión USB ni "Imprimir todo" en esa pantalla. WebUSB queda solo en Pedidos (B2C); `printComandaB2bDiaWebUsb` / `buildComandaB2bDiaBytes` siguen en `thermal-printer.ts` sin uso.

## Pendiente de verificar

El ticket WebUSB nunca se probó contra una impresora física dentro de las sesiones de desarrollo (sin hardware conectado). Antes de darlo por cerrado en producción hace falta una prueba con la GHIA GTP801 real. Estado: por confirmar con Santiago.
