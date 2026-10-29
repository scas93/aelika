# Banetto — Diseño de la operación de pedidos

Oct 7, 2026 · @santiago

*Actualizado el 29 oct 2026: la Parte I refleja las decisiones de producto tomadas sobre las divergencias con el código (sección 9 de la Parte II).*

## Principios y alcance

La operación se diseña para ser lo más simple posible: reglas claras para el cliente y libertad para el equipo. Hoy todo se pide por WhatsApp sin sistema; el objetivo es que un sistema controle la recepción y operación de los pedidos.

- **Clientes:** cafeterías con entregas programadas. Hoy son \~30; la operación debe soportar 4X (\~120 clientes).
- **Regla de oro:** las restricciones de tiempo aplican solo al cliente. El equipo puede crear y modificar libremente.
- **Fuera de alcance en esta versión:** cobranza en sistema, facturación, cupo de capacidad por día, pedidos recurrentes automáticos, disponibilidad de productos por día, registro de cambios de pedidos.

## Datos

Estos son los datos que guarda el sistema. El **negocio** es el tenant (Banetto); el **cliente** es quien le compra (cada cafetería o cada sucursal de una cafetería).

### Negocio

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| Nombre comercial | Sí |  |
| Código de negocio | Sí | Slug del nombre comercial (ej. banetto), único. Es el prefijo de los códigos de sus clientes |
| Dirección | Sí | Instalaciones donde está el mostrador |
| Parámetros de operación | Sí | Ver Parámetros configurables por negocio |

### Producto

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| Nombre | Sí |  |
| Precio | Sí | Con IVA incluido |
| Categoría | Sí |  |
| Foto | No |  |
| ID del producto en el ERP | No | Para integraciones futuras |
| Activo | Sí | Inactivo lo oculta del catálogo sin borrarlo, para no romper pedidos históricos |

### Cliente

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| Nombre comercial | Sí |  |
| Dirección | Sí | Dirección fija de entrega: cada cuenta de cliente es una sucursal |
| Código de cliente | Sí | Código del negocio + slug del cliente (ej. banetto-matriz, banetto-americas, banetto-providencia). Único. **Dato heredado, ya no se usa en la operación.** Se genera solo, a partir del nombre comercial, y se conserva por compatibilidad (columna del Excel, seeds y scripts). El panel no lo muestra ni lo captura, no se busca por él y el cliente no lo escribe al entrar al portal. No se puede editar |
| Descuento | No | % sobre el total del pedido. Aplica solo dentro de su negocio |
| Modalidad de pago | No | Si no se define, usa la del negocio |
| Teléfonos autorizados y número principal | Sí, al menos 1 | Un mismo teléfono puede estar registrado en varios clientes, del mismo negocio o de negocios distintos |
| Favoritos por día de la semana | No | Un favorito por cada día de la semana («tu lunes favorito», «tu miércoles favorito»), todos dentro de un mismo registro del cliente que comparten sus teléfonos. Cada uno guarda productos y cantidades de ese día, no precios. El cliente los guarda y los usa desde el paso de cada día al crear un pedido (ver Canales) |

Una cafetería con 3 sucursales se da de alta como 3 clientes, cada uno con sus teléfonos, descuento y pedidos.

Un cliente está **activo** mientras no esté dado de baja. La baja es lógica: el cliente ya no puede entrar ni pedir, sus pedidos activos siguen hasta completarse y su historial se conserva.

### Pedido

| Campo | Notas |
| --- | --- |
| Folio | P- + consecutivo de 6 dígitos por negocio (ej. P-000001). Aplica solo a pedidos B2B nuevos; los pedidos B2C conservan su consecutivo simple |
| Cliente | Uno por pedido |
| Semana | Fecha de inicio (lunes) y fin (domingo) |
| Estado operativo | Por confirmar, Confirmado, En proceso, Completado, Cancelado |
| Estado de pago | Pendiente o Pagado, con la fecha en que se marcó |
| Nota del cliente | Opcional, texto libre. Visible en el panel lateral y en el Excel |
| Modificado por el cliente | Marca que se enciende cuando el cliente modifica el pedido en el portal y se apaga cuando el equipo lo vuelve a confirmar o lo marca como revisado |
| Origen | Se guarda quién creó el pedido: el cliente en el portal o el equipo en el panel. No se muestra. Uso futuro: medir la adopción del portal frente al panel |
| Descuento aplicado | % que tenía el cliente al crear el pedido. Si después cambia, no afecta este pedido |
| Subtotal, descuento y total | En pesos, IVA incluido |
| Fechas | Creación y confirmación (la confirmación solo se guarda en pedidos creados desde el corte `CONFIRMADO_AT_DESDE`). **Fecha de completado: diferida**, todavía no se guarda |

### Entrega

| Campo | Notas |
| --- | --- |
| Fecha y hora | La hora sale del parámetro del negocio (Banetto: 8am) |
| Estado | Pendiente, Entregada, No recogida, Cancelada. Cancelada solo aparece al cancelar el pedido; no se cancela una entrega suelta |
| Líneas | Producto, cantidad, precio unitario (del catálogo al crear; al editar el pedido, todas sus líneas toman el precio actual), subtotal |
| Cierre | Fecha y hora en que se cerró |

### Usuarios

| Tipo | Datos | Cómo entra |
| --- | --- | --- |
| Equipo del negocio (admin, operativo) | Nombre, correo, contraseña, rol | Correo y contraseña. Sin recuperación por correo en esta versión |
| Cliente | Teléfono autorizado en uno o más clientes | Teléfono + código por WhatsApp; elige cliente si su teléfono está en varios |

## Clientes y acceso

Cada cliente tiene varios teléfonos autorizados, y un mismo teléfono puede estar en varios clientes. El acceso es sin contraseña: teléfono y código por WhatsApp.

**Modelo de cliente:**

- El admin da de alta a cada cliente. No hay autorregistro.
- Cada sucursal de una cafetería es un cliente distinto.
- Cada cliente tiene código de cliente, dirección, descuento (si aplica) y sus teléfonos autorizados. Los campos están en la sección Datos.
- Uno de los teléfonos se marca como **principal**; ahí llegan las notificaciones.
- Si el encargado se va, el admin quita su número y agrega el del nuevo. El cliente y su historial se conservan.

**Flujo de acceso al portal:**

El negocio se identifica por la dirección del portal (/mayoreo/[slug]); el cliente no escribe ningún código de cliente.

1. El cliente escribe su teléfono.
2. Si el teléfono está autorizado en al menos un cliente activo del negocio, recibe un código por WhatsApp.
3. Escribe el código.
4. Si su teléfono está en un solo cliente, entra directo. Si está en varios, elige con cuál entrar, y puede cambiar de cliente dentro del portal.

Al escribir su teléfono, el cliente ve **siempre el mismo mensaje**, esté o no autorizado: "Si tu número está dado de alta, recibirás un código por WhatsApp. Si no te llega en unos minutos, contáctanos", con el botón para contactar al negocio cuando el número de atención esté configurado. El portal nunca revela qué teléfonos son clientes del negocio; quien no está autorizado no recibe código y no puede seguir.

**Límite de envíos:** cada envío de código cuesta un mensaje de WhatsApp, así que los envíos tienen límite: 3 por hora y 10 por día por teléfono, 10 por día por dispositivo, 30 por día por conexión (IP) y un tope diario por negocio. El código es de 6 dígitos, vale 10 minutos, se usa una sola vez y admite 5 intentos. Los teléfonos que no son clientes cuentan igual contra los límites. Si el servicio de límites no responde, nadie puede pedir código.

**Para que sea super sencillo desde el teléfono:**

- La sesión dura 60–90 días en el dispositivo. Después de la primera vez, el link del bot lleva directo al catálogo.
- Si la sesión expira, el teléfono queda guardado en el dispositivo y solo se pide de nuevo el código de WhatsApp.
- El link personal de un solo uso desde el bot queda como mejora futura, sujeta a validación técnica.

## Canales

Cada negocio tiene su panel administrativo, su propio portal para clientes (storefront o mostrador digital, con su propia dirección web) y su propio número de WhatsApp con su bot. Los clientes piden desde el portal, al que llegan con el link del bot. Los pedidos que llegan por teléfono los captura el equipo desde el navegador.

**Bot de WhatsApp:** abre con un mensaje inicial y el menú principal.

1. **Hacer un pedido** → envía el link del portal (siempre el mismo URL).
2. **Ver o modificar mis pedidos** → envía el mismo link. En el portal, el cliente ve sus pedidos y puede modificar los que tienen entregas todavía modificables.
3. **Hablar con un humano.**

Lo más común es que el cliente no recorra el menú y vuelva a dar clic al link que el bot le envió antes. Por eso el link debe ser estable y la sesión larga.

**Portal del cliente (mismo storefront actual, con cuenta):**

Al entrar, el portal muestra el menú: **Crear pedido · Modificar pedido activo · Ver mis pedidos**. Si el teléfono está en varios clientes, se muestra en cuál está y puede cambiar de cliente.

- **Crear pedido:** pantalla por pantalla, muy parecido al storefront B2B actual. Los datos del cliente vienen precargados y el descuento ya aplicado. Al terminar, el cliente ve una pantalla de confirmación con el folio y el resumen; no se envía WhatsApp hasta que el equipo lo marca Confirmado. Ver la pestaña Pantallas actuales. Un pedido es de una sola semana: el cliente elige la semana, los días de entrega de esa semana y captura lo que recibe cada día (un paso por día, con catálogo completo). Los precios son siempre los actuales.
  - **Favorito por día de la semana.** En el paso de cada día, una barra de acciones arriba del catálogo ofrece el favorito de ese día de la semana. Con el día **vacío**: «Tu [día] favorito — Usar» llena el día con un toque con las cantidades guardadas; si además aplica «Copiar» (día que no es el primero y el primer día ya tiene productos), «Copiar» es la acción principal y «Usar favorito» la secundaria. Con el día **con productos**: si coincide exactamente con el favorito de ese día de la semana, la barra dice «Tu [día] favorito ✓»; si no, ofrece «¿Siempre pides así los [día]? — Guardar favorito», y si ya había un favorito para ese día pide confirmación antes de reemplazarlo. Guardar el favorito de un día no toca los de los demás días. Al usar un favorito, los productos que ya no están disponibles se omiten y se avisa con su nombre. Si el favorito no carga, el flujo sigue sin esas acciones. Un favorito se aplica a cualquier fecha de ese día de la semana, en la semana que sea.
- **Modificar pedido activo:** muestra solo los pedidos con alguna entrega todavía modificable; si hay dos, el cliente elige. Reglas en la sección Reglas de pedido. Las entregas a menos de 18h y las ya cerradas se ven bloqueadas, con un botón para contactar al negocio (número de atención configurado en Ajustes).
- **Ver mis pedidos:** pedidos activos e historial, con estado, entregas y estado de pago. Al abrir uno se ve el detalle: información básica del pedido, sus productos, sus entregas con su estado y el estado del pago.
- El cliente **no cancela el pedido completo**: eso se pide por teléfono al negocio.

**Captura por teléfono:** el operativo selecciona al cliente de una lista y captura el pedido o la modificación desde el navegador.

## Catálogo y descuentos

El catálogo tiene un solo precio para todos los clientes.

- 5 clientes tienen descuento del 10% o 20%.
- El descuento es un % fijo que se configura en el detalle del cliente (módulo Clientes), no un código que el cliente escribe. Los códigos de descuento que hoy existen en el storefront no se usan para Banetto. Se aplica solo al total del pedido, incluyendo todos los productos.
- Cada sucursal de una cafetería es un cliente distinto, con su propio descuento. El descuento se aplica al crear el pedido; si después cambia, no afecta pedidos ya creados.

## Entrega

Cada cuenta de cliente B2B es una **sucursal con dirección fija**, así que el pedido B2B no lleva método de entrega ni punto de envío: lo único que cambia de una entrega a otra es su fecha y su distribución (productos y cantidades). La entrega a domicilio con puntos de envío y pedido mínimo es una función del menudeo (B2C), no de este diseño.

## Reglas de pedido

Un pedido es una semana (lunes a domingo) con hasta 7 entregas. Todas las entregas son a las 8am (parámetro del negocio, igual que las 36h y 18h), y cada entrega se evalúa por separado contra las reglas de tiempo.

| Acción | Quién | Límite | Ejemplo: entrega miércoles 8am |
| --- | --- | --- | --- |
| Crear | Cliente (portal) | Hasta 36h antes de la entrega | Lunes 8pm |
| Modificar (cambiar productos y cantidades, o quitar una entrega) | Cliente (portal) | Hasta 18h antes de esa entrega | Martes 2pm |
| Agregar un día nuevo | Cliente (portal) | Hasta 36h antes, igual que crear | Lunes 8pm |
| Crear o modificar | Operativo o admin | Sin límite de tiempo ni de horizonte, ni hora de corte interna (cualquier fecha, incluso días no laborables) | — |
| Corregir ya entregado | Solo admin | Sin límite | Después de la entrega |

**Calendario de selección:**

- Fecha mínima: ahora + 36h. Fecha máxima: domingo de la semana siguiente.
- Si el cliente elige días de las dos semanas, el sistema genera automáticamente dos pedidos, uno por semana, en un solo checkout.
- Un cliente no puede tener dos pedidos en la misma semana. Un pedido cancelado no cuenta: el cliente puede crear otro para esa misma semana. Si ya tiene uno, ve el mensaje "Ya tienes pedido para esta semana. Para agregar o cambiar entregas, usa Modificar pedido activo". El equipo tampoco crea un segundo pedido: modifica el existente. Como máximo un cliente tiene dos pedidos activos a la vez (semana en curso y siguiente).
- **Modificación por el cliente:** las entregas a menos de 18h y las ya cerradas quedan bloqueadas en el portal. Si el pedido estaba Confirmado y el cliente lo modifica, regresa a Por confirmar y se marca "Modificado por el cliente" en Pedidos activos y en el panel lateral hasta que el equipo lo vuelva a confirmar o lo marque como revisado. El pago no cambia por la modificación.
- **Marcar como revisado:** acción vigente, de los 3 roles, que solo apaga la marca «Modificado por el cliente» (no cambia el estado ni el pago). Existe porque un pedido En proceso o Completado nunca se vuelve a confirmar y su marca no tendría otra forma de apagarse.
- **Mínimo de piezas:** configurable por negocio, por pedido (semana). **0 significa sin mínimo**, y es el valor con el que nace un negocio nuevo (Banetto: sin mínimo). Se edita en Ajustes → Pedidos de mayoreo.

**Incentivo para pedir antes del sábado 8pm:** sábado 8pm es exactamente 36h antes del lunes 8am. Quien pide después pierde la entrega del lunes; después del domingo 8pm, también la del martes. Los recordatorios lo dicen explícitamente.

| Si pide el… | Puede elegir |
| --- | --- |
| Miércoles 10am | Viernes a domingo de esta semana, y lunes a domingo de la siguiente |
| Sábado 7pm | Lunes a domingo de la siguiente semana |
| Domingo 10am | Martes a domingo de la siguiente semana |

**Días sin entrega (festivos; antes «días no laborables») — EN CONSTRUCCIÓN: se implementan en un cambio aparte y hoy no existen en el sistema.** El admin marca en un calendario las fechas sin entrega. El negocio decide cuáles son; si no producir un día afecta la entrega del día siguiente, también marca ese día.

- Solo bloquean la selección del cliente: esas fechas no aparecen en su calendario. El equipo puede programar entregas en cualquier fecha, sin límite de horizonte.
- Al marcar una fecha, el sistema muestra las entregas ya programadas para ese día. El equipo decide con cada cliente si la mueve a otro día o la quita editando el pedido. El sistema no mueve nada en automático.
- Conviene cargar los días no laborables con anticipación (por ejemplo, los del año al iniciar) para que casi nunca choquen con pedidos existentes.
- La regla de 36h se cuenta en horas de calendario, igual que cualquier otro día.
- Prioridad baja: queda fuera del día uno.

**Precios, cambios y avisos:**

- Los precios incluyen IVA. La facturación queda fuera del sistema por ahora.
- El precio de cada línea se toma del catálogo al crear el pedido. Si el pedido se edita (por el equipo o por la corrección del admin), todas sus líneas toman el precio actual del catálogo, no solo las editadas.
- Los cambios del equipo a un pedido se hacen desde Pedidos activos. No se notifican al cliente y no cambian el estado del pedido, salvo que al agregar entregas a un pedido Completado este vuelva solo a En proceso.
- No se notifica al cliente cuando se le cancela un pedido o se le quita un día.

## Flujo operativo y estados

Un pedido tiene dos estados independientes: el operativo, que solo requiere una confirmación manual y después avanza con sus entregas, y el de pago, que se lleva aparte.

&#91;embedded content: estados del pedido y de cada entrega\]

1. El cliente o el equipo crea el pedido; queda **Por confirmar**.
2. El equipo (Gerente o Admin; el Operador no confirma ni cancela, y esto se reevalúa según lo que pida la operación) revisa las entregas y los productos de cada entrega, y lo marca **Confirmado**. Se notifica al cliente. Un pedido se puede cancelar en Por confirmar, Confirmado o En proceso: las entregas ya cerradas se quedan como están y se cobran; las pendientes pasan a Canceladas y no se cobran. No existe cancelar una entrega suelta: quitar un día se hace editando el pedido (el equipo en el panel; el cliente en el portal, hasta 18h antes). El cliente no cancela el pedido completo. Si el cliente modifica un pedido Confirmado, vuelve a Por confirmar hasta que el equipo lo confirme de nuevo.
3. Cada entrega nace **Pendiente** y se cierra como:
   - **Entregada:** el cliente la recibió o la recogió. Se cobra.
   - **No recogida:** el cliente no pasó por ella. Solo queda registrada; se cobra igual.
   - **Cancelada:** solo ocurre al cancelar el pedido, y aplica a las entregas que seguían pendientes. No se cobra.
4. El pedido pasa solo a **En proceso** cuando tiene al menos una entrega cerrada y quedan pendientes, y a **Completado** cuando todas están cerradas. Con una sola entrega, pasa directo de Confirmado a Completado. Se pueden agregar entregas a un pedido En proceso o Completado; como el estado se calcula de las entregas, el pedido vuelve solo a En proceso y a Pedidos activos. Una entrega de un día pasado que sigue Pendiente se muestra como atrasada; no se cierra en automático, el equipo decide si fue Entregada o No recogida.
5. El estado **Lista** ("lista para entregar") es opcional por negocio. Banetto no lo usa por ahora.
6. Si hubo un error en el envío, el admin corrige la entrega ya entregada: puede cambiar productos, cantidades y el estado (Entregada o No recogida); al corregir, todas las líneas del pedido toman el precio actual del catálogo. El admin puede corregir aunque el pedido ya esté marcado como Pagado. La corrección se ve en el portal y en el monto a cobrar; no es un estado.

**Estado de pago:**

- El pago tiene dos estados: **Pendiente** desde que se crea el pedido, y **Pagado**. Sin plazos ni vencimientos: el pago puede llegar el mismo día, a la semana o al mes.
- **Pagado** lo marca solo el admin, en cualquier momento, desde Pedidos activos o desde Históricos. El admin también puede desmarcarlo (por ejemplo, para deshacer un error o si hubo reembolso). Si el módulo de pagos está activo, lo marca el sistema.
- El pago no cambia solo al corregir ni al cancelar. Un pedido Pagado que se cancela sigue como Pagado.
- La modalidad se configura por negocio, con excepción por cliente. **Anticipado:** el pedido no se confirma sin pago. **Crédito:** el pedido opera completo con pago pendiente.
- Con pago anticipado, si el monto cambia después de pagar, el pago no cambia solo: el admin decide si lo desmarca.
- **Banetto:** crédito para todos sus clientes; normalmente se paga después de completar el pedido.

## Cobranza

La cobranza se maneja fuera del sistema, pero el pago se marca en el sistema. El sistema es la fuente del monto correcto: despacho por entrega, cobro por pedido, total con descuento y con las correcciones posteriores a la entrega. Las entregas Entregadas y No recogidas se cobran, aunque el pedido se cancele después; las Canceladas (las que seguían pendientes al cancelar el pedido) no. El estado de pago (Pendiente o Pagado) permite filtrar en Histórico.

## Notificaciones

El módulo de notificaciones ya existe y es requisito del día uno. Lo que esta operación requiere es que detecte los eventos de abajo y permita configurar, para cada uno, si está activo, el horario (en los programados), el filtro de destinatarios y la plantilla. Los textos de las plantillas los define el negocio. Todas van por WhatsApp, desde el número del negocio, al número principal del cliente. Si un teléfono es el principal de varios clientes, recibe un mensaje por cada uno; por eso toda plantilla debe incluir el nombre del cliente (ej. "Banetto Américas") para distinguir la sucursal.

| Evento | Tipo | Cuándo se dispara | Filtros que debe permitir | Configuración Banetto |
| --- | --- | --- | --- | --- |
| Recordatorio programado | Programado | Día y hora configurables | Todos los clientes activos; clientes sin pedido para la siguiente semana | Viernes 12pm a todos; sábado 12pm a clientes sin pedido |
| Pedido confirmado | Por evento | Cuando el pedido cambia a Confirmado. Se dispara de nuevo cada vez que el equipo lo reconfirma tras una modificación del cliente, sin deduplicación | Cliente del pedido | Activo. Resumen: entregas por día, productos y total con descuento |

- No existe un evento «Entrega entregada» (decisión de producto): al cerrar o corregir una entrega no se envía nada; la versión corregida se ve en el portal.
- Todos los mensajes salen fuera de la ventana de 24h de WhatsApp, así que cada uno necesita una plantilla aprobada por Meta. Los recordatorios son categoría marketing; las operativas son utilidad; el código de acceso es autenticación.

## Roles y permisos

Se usan los tres roles que ya existen en el panel (el Dueño se muestra como «Admin»). Dueño y Gerente funcionan como admin: gestionan clientes, catálogo, correcciones y pagos. Operador es el rol operativo: pedidos y entregas del día.

| Rol en el panel | Función | Quién | Puede |
| --- | --- | --- | --- |
| Dueño / Gerente | Admin | Matías, Anahí | Todo lo del operador. Gestionar clientes: alta y baja, teléfonos autorizados, número principal, descuentos. Catálogo. Corregir pedidos ya entregados, incluso si ya están marcados como Pagados. Marcar y desmarcar Pagado. Confirmar y cancelar pedidos. Configuración y usuarios del equipo (en Ajustes, el Gerente ve Información del negocio y Equipo; el resto de Ajustes es solo del Dueño/Admin) |
| Operador (usuario individual) | Operativo | Mariana, Fernanda | Crear y modificar pedidos sin límite de tiempo antes de la entrega (no confirma ni cancela: se reevalúa según lo que pida la operación). Cerrar entregas y gestionar las entregas del día. Exportar Excel. No tiene acceso al Catálogo (solo ve los productos al capturar un pedido). Un pedido marcado como Pagado queda bloqueado para él |
| Operador (usuario compartido) | Operativo | Resto del equipo | Lo mismo que el operador individual |

En esta versión no hay registro de cambios de los pedidos ni se guarda qué usuario capturó, confirmó, cerró una entrega o marcó como pagado.

## Módulos de la plataforma

El equipo opera desde los módulos del sidebar B2B actual, ajustados. Los detalles de pedidos y entregas se abren en un panel lateral, como hoy. Programa de Lealtad se oculta para Banetto; Notificaciones se queda como módulo propio del sidebar.

| Módulo | Para qué sirve | Quién |
| --- | --- | --- |
| 1. Inicio (dashboard operativo) | Resumen del día: entregas de hoy por estado, entregas atrasadas, pedidos por confirmar, clientes sin pedido para la siguiente semana, consolidado de producción de mañana. Parte del Inicio B2B actual. Requisito del día uno | Todos |
| 2. Pedidos activos | Ver, crear, modificar y gestionar pedidos. Confirmar, cancelar y marcar como pagado (solo admin). Vista semanal (Semana en curso / Próxima semana) | Todos |
| 3. Entregas del día | Listado de entregas de un día, navegando entre días. Marcar cada entrega como Entregada o No recogida. Imprimir comanda. Exportar Excel | Todos |
| 4. Históricos | Todos los pedidos completados y cancelados, con filtros por estado, estado de pago, semana, total y cliente. Marcar como pagado y corregir entregas ya entregadas (solo admin). Exportar Excel | Todos consultan; solo admin corrige y marca pagado |
| 5. Catálogo | Ver, crear, modificar, activar y desactivar productos y sus categorías. Bloqueado del todo para el Operador, que solo ve los productos en la captura de pedidos | Solo admin |
| 6. Clientes | Ver, crear, modificar y dar de baja clientes: código de cliente, teléfonos autorizados, número principal, descuento, dirección | Solo admin |
| 7. Notificaciones | Reglas de los eventos de la sección Notificaciones: activación, horario, filtro y plantilla | Solo admin |
| 8. Ajustes | Parámetros del negocio, número de atención del negocio, días sin entrega (en construcción), usuarios del equipo (alta, baja y rol) | Admin; el Gerente ve Información del negocio y Equipo |

**Detalle por módulo:**

- **Pedidos activos:** como la vista actual. Muestra los pedidos que aún no están completados ni cancelados. Todos los cambios del equipo a un pedido se hacen desde aquí, en el panel lateral. Al completarse o cancelarse, el pedido pasa a Históricos. Si a un pedido Completado se le agregan entregas, vuelve solo a En proceso y a Pedidos activos. Un pedido que el cliente modificó desde el portal regresa a Por confirmar y lleva la marca "Modificado por el cliente" en la lista y en el panel lateral hasta que el equipo lo confirme o lo marque como revisado.
- **Entregas del día:** cada entrega se marca una por una (Entregada o No recogida); no hay cambio de estado en bloque. Una entrega de un día pasado que sigue Pendiente se muestra como atrasada; no se cierra en automático.
- **Los pedidos no se borran:** solo se cancelan.

**Excel de Entregas del día**: archivo Excel real (.xlsx) con dos hojas, Entregas (una fila por producto de cada entrega del día) y Consolidado:

| Hoja | Columnas |
| --- | --- |
| Entregas | Fecha de entrega, folio, cliente, estado de la entrega, categoría, producto, ID ERP, cantidad, precio unitario, subtotal, nota del cliente |
| Consolidado | Fecha, categoría, producto, ID ERP, cantidad total, número de clientes |

**Excel de Históricos** (una fila por pedido, con los filtros aplicados):

| Columnas |
| --- |
| Folio, cliente, semana (inicio y fin), fecha de creación, estado del pedido, estado de pago, fecha de pago, entregas totales, entregadas, no recogidas, canceladas, subtotal, descuento %, descuento $, total (IVA incluido) |

## Parámetros configurables por negocio

Esta operación debe servir a cualquier negocio parecido a Banetto, no solo a Banetto. El modelo base es **pedido con N entregas**: Banetto es un pedido semanal con hasta 7 entregas; un negocio de venta directa es un pedido con 1 entrega. Lo que cambia entre negocios son parámetros, no desarrollo nuevo.

### Pedidos y tiempos

| Parámetro | Valor Banetto | Otro negocio podría… |
| --- | --- | --- |
| Agrupación del pedido | Por semana | Por día, o libre |
| Inicio de semana | Lunes | Domingo |
| Zona horaria | Ciudad de México, fija en esta versión (las 36h y 18h se cuentan en esta hora) | Otra zona horaria (versión futura) |
| Moneda | Pesos (MXN), fija en esta versión | Otra moneda (versión futura) |
| Máximo de entregas por pedido | 7 | 1 |
| Un solo pedido por periodo | Sí | No |
| Horario de entrega | 8am (parámetro configurable) | Varias ventanas (mañana, tarde) |
| Días de entrega habilitados | Todos los días, excepto días no laborables | Sin domingos |
| Anticipación mínima para crear | 36h | 2h, o mismo día |
| Anticipación para que el cliente modifique | 18h | Otra, o no permitir |
| Modificación por el cliente | Directa en el portal | Solo solicitándola por teléfono |
| Horizonte máximo de selección | Fin de la semana siguiente | 1 día, 1 mes |
| Mínimo de piezas por pedido | 0 (sin mínimo; valor de un negocio nuevo) | Un mínimo de piezas |

### Catálogo, clientes y operación

| Parámetro | Valor Banetto | Otro negocio podría… |
| --- | --- | --- |
| Descuento por cliente | % fijo sobre el total, aplicado al crear el pedido | Sin descuentos |
| Módulo de pagos | Apagado (el admin marca el pago a mano) | Cobrar en línea |
| Modalidad de pago (con excepción por cliente) | Crédito | Anticipado |
| Alta de clientes | Solo admin | Autorregistro con aprobación |
| Pedir código de cliente al entrar | No | Sí |
| Duración de sesión | 60–90 días | Más corta |
| Confirmación manual del pedido | Sí | Confirmación automática |
| Estados de entrega en uso | Pendiente, Entregada, No recogida, Cancelada | Con "Lista"; sin "No recogida" |
| Notificaciones | Los eventos de la sección Notificaciones (3 envíos: recordatorio del viernes, recordatorio del sábado y pedido confirmado) | Cada una con su activación, horario, filtro y plantilla |
| Menú del bot | 3 opciones | Opciones propias |
| Número de atención del negocio | Configurado en Ajustes; el portal lo usa en el botón de contacto de las entregas bloqueadas | — |

### Reglas fijas del producto

Estas no se configuran, porque son las que hacen confiable al sistema:

- Las restricciones de tiempo aplican solo al cliente; el equipo opera libremente, sin límite de tiempo ni hora de corte interna para producción.
- Corregir algo ya entregado y marcar como pagado es solo del admin.
- Los pedidos no se borran; solo se cancelan.
- Las notificaciones van al número principal del cliente.
- Los roles son Dueño, Gerente y Operador. Cada negocio asigna personas a cada rol, pero no edita los permisos.

### Fuera de esta versión

- Matriz de permisos editable.
- Anticipación distinta por producto.
- Listas de precio por cliente.
- Estados personalizados (cada negocio solo apaga los que no usa).
- Registro de cambios de los pedidos y de qué usuario hizo cada acción (el origen del pedido sí se guarda; ver Pedido).
- Zona horaria y moneda configurables por negocio (en esta versión son fijas: Ciudad de México y pesos).
- Recuperación de contraseña por correo para el equipo del negocio (hoy no existe ni hay proveedor de correo).
- Modo de cliente configurable por negocio: storefront B2B sin cuenta (formulario por pedido) o mixto (el cliente elige entrar con su cuenta o pedir sin cuenta).

### Plantillas de operación

Para no configurar todo desde cero, cada negocio arranca de una plantilla con valores precargados y ajusta lo necesario:

- **Entregas programadas B2B:** los valores de Banetto.
- **Pedido único:** 1 entrega por pedido. En el storefront B2B el cliente siempre entra con cuenta; el storefront de menudeo (pickup) no usa cuentas.

## Métricas y cómo se ve el éxito

El éxito es que los clientes pidan antes del sábado y que cada entrega salga completa y a tiempo. Las metas son referencias iniciales para ajustar con datos reales.

| Métrica | Qué mide | Meta inicial |
| --- | --- | --- |
| % de pedidos antes del sábado 8pm | Efecto de los recordatorios y del corte | Más de 80% |
| OTIF por entrega | Entregas a tiempo y completas | 98% o más |
| Correcciones post-entrega | Errores de despacho | Menos de 2% de entregas |
| Merma | Producción no vendida | Menos de 3% |
| Utilización de capacidad por día | Qué tan llena está la planta y qué tan parejo | 80–85%, sin días arriba de 95% |
| Clientes activos | Crecimiento de 30 hacia \~120 | Al ritmo de la capacidad |

## Estado actual y brechas

El estado actual frente a este diseño, las auditorías de Claude Code y el avance por fases se llevan en el documento 'Banetto — Plan de trabajo'. Este documento solo define el qué.

## Validaciones técnicas y pendientes

Se hacen al inicio del plan de trabajo, antes de construir.

- [ ] Probar en iPhone y Android que la sesión del portal sobrevive a varios clics al link del bot (el navegador interno de WhatsApp puede no guardar la sesión).
- [ ] Confirmar que Botpress expone el número de WhatsApp del usuario, y si es viable que el bot envíe un link personal de un solo uso (token firmado y con expiración, nunca el teléfono en la URL).
- [ ] Verificar cómo se vincula hoy el número y el bot de cada negocio (webhook por negocio) para cumplir "un número y un bot por negocio".
- [ ] Solicitar a Meta las plantillas: autenticación (código de acceso), utilidad (pedido confirmado, entrega entregada) y marketing (recordatorios).
- [ ] Confirmar con producción que 36h de anticipación alcanzan para todo el catálogo.
- [ ] Dar de alta los \~30 clientes actuales (cada sucursal como cliente distinto) con sus teléfonos autorizados y su número principal.
- [x] Obtener con Claude Code capturas del panel y del storefront actuales (pestaña Pantallas actuales).
- [ ] Borrar los negocios de prueba "banetto" y "banetto-mayorista" en la base local y crear uno nuevo desde cero, con código de negocio "banetto", como parte del plan, con un seed reproducible. Confirmado: no existe un tenant "banetto" en producción.

---

# Parte II — Implementación vigente del módulo B2B

*Agregada al consolidar el contexto del repo. La Parte I (arriba) es el diseño funcional: define el QUÉ y se actualizó el 29 oct 2026 con las decisiones de producto sobre las divergencias que había con el código. Esta parte recoge cómo está implementado hoy el módulo B2B (antes vivía en `CLAUDE.md`) y las divergencias conocidas respecto al diseño.*

**Precedencia:** ante una duda de comportamiento B2B manda la Parte I sobre el código y sobre suposiciones. Si la Parte I choca con el código o es ambigua, repórtalo antes de implementar. La sección 9 lista solo las divergencias que siguen abiertas; para esos casos manda lo que dice esa lista. No modifiques la Parte I salvo que el cambio lo pida explícitamente (decisión de producto).

**Estado de despliegue (verificado con git):** todo lo descrito aquí está en `main` (portal 4b–4g y estados por entrega: merge `fdc0b69`, 2026-10-14; clientes B2B, Entregas del día, Adopción y observabilidad: `e192ca6` y `dc7e0f8`, 2026-10-19; modalidades de cobro: `44fe3dd`, 2026-10-26; avisos internos: `533a119`, 2026-10-28). Que las migraciones y los **scripts de datos** (Etapa 2, estados B2B, modalidades) ya se hayan corrido en producción, y los valores de entorno como `CONFIRMADO_AT_DESDE`, no se pueden verificar desde el repo: ver "Por confirmar" al final.

## 1. Pedidos B2B sobre la orden centralizada (Etapa 2)

Un pedido B2B es `Order` (`tipo = B2B`) + `DetalleB2B` + `OrderItem` + `Entrega` + `EntregaItem` (modelo en [modelo-datos.md](modelo-datos.md)). `PedidoB2b` y sus tablas dejaron de escribirse y se retirarán en una etapa posterior. Migración de datos, auditoría y reversa: `backend/src/scripts/etapa2-b2b.ts` + `backend/scripts/etapa2/MIGRACION.md`. Se desplegó en dos releases (esquema + aislamiento B2C + script; luego el módulo B2B) para no dejar el panel B2B vacío.

- La API B2B conserva rutas y forma de respuesta: `aRespuestaPedidoB2b` reconstruye la forma plana de `PedidoB2b` (lista explícita de campos; `distribucion` se deriva de las entregas).
- **Cambios de comportamiento deliberados:** un producto repetido en un carrito se consolida en un ítem; los endpoints de pedidos B2B (panel 403, públicos 404) exigen tenant `RETAIL_B2B` (el CRUD de códigos de descuento y el checkout B2C quedan abiertos); cancelar marca las entregas `CANCELADA`.
- Pruebas: `etapa2-dorados` (salida HTTP idéntica a los dorados `backend/test/characterization/__dorados__/etapa2-b2b.json`, generados con el código previo — **no se regeneran** para arreglar un fallo), `etapa2-migracion`, `etapa2-ordenes-b2b`. Los cambios deliberados posteriores están enumerados en `backend/test/characterization/etapa2-excepciones.ts` (incluida la excepción 12: el CSV B2B muestra el nombre de la modalidad, y la 10: lecturas públicas cerradas).

## 2. Estados por entrega

Estados del pedido: Por confirmar (`PENDIENTE_CONFIRMACION`) → Confirmado (`CONFIRMADO_SURTIENDO`, manual: `PATCH /pedidos-b2b/:id/avanzar`, único uso que queda de `avanzar`) → En proceso (`EN_PROCESO`) → Completado (`COMPLETADO`). Los dos últimos se CALCULAN de las entregas y se guardan en `Order.estadoPedido` (`recalcularEstadoB2b`, `pedidos-b2b-estados.ts`, dentro de la transacción que cambió las entregas y bajo `FOR UPDATE`).

- **"Cancelado" no es un valor del enum: es `Order.cancelado`** (única fuente). "Despachar" ya no existe para B2B; `DESPACHADO` solo sobrevive en B2C y, en B2B, como dato heredado que el código lee como `COMPLETADO` (`estadoB2bVisible`; el filtro `estado=COMPLETADO` también abarca `DESPACHADO`) hasta que corra `src/scripts/b2b-estados.ts` (guía: `backend/scripts/b2b-estados/MIGRACION.md`).
- **Cierre por entrega:** `PATCH /pedidos-b2b/:id/entregas/:entregaId/cerrar` `{estado: ENTREGADA | NO_RECOGIDA}`, uno por uno, **abierto a los 3 roles** (el resto de las escrituras B2B es Gerente/Dueño). Solo en pedidos Confirmados o En proceso; guarda `estadoCambiadoAt` y ya no escribe `estadoCambiadoPorId`. `NO_RECOGIDA` se cobra igual que `ENTREGADA`. No existe cancelar una entrega suelta.
- **Cancelar** (Gerente/Dueño): en Por confirmar, Confirmado y En proceso; las entregas cerradas se conservan, las pendientes pasan a `CANCELADA`, y subtotal/descuento/total se recalculan solo con las entregas no canceladas (`recalcularTotalesB2b`; el % de descuento del pedido no cambia). No se cancela un Completado.
- **Edición:** como diff (`sincronizarOrdenB2b`; 409 si toca una entrega cerrada) y también en En proceso y Completado; agregar una entrega a un Completado lo regresa a En proceso. **Entregas atrasadas:** `fecha < hoy` (America/Mexico_City) y `PENDIENTE`; se calcula al leer (`entregaAtrasada`), nunca se guarda ni se cierra sola.
- **Lecturas:** solo `GET /pedidos-b2b/:id` y el cierre devuelven `entregas` (id, fecha, día, estado, `cerradaAt`, `atrasada`). `GET /pedidos-b2b/dia/:fecha` devuelve una fila por pedido con su entrega (`entregaId`, `entregaEstado`, `cerradaAt`, `atrasada`, `cancelado`); incluye entregas cerradas y excluye las `CANCELADA`. "Activos" = Por confirmar + Confirmado + En proceso (y no cancelado).
- **Notificaciones:** sin eventos nuevos; el único evento B2B es Confirmado. Las reglas `PEDIDO_B2B/DESPACHADO` ya no disparan (ver [notificaciones.md](notificaciones.md)).
- `EstadoPedido` es compartido con B2C; lo B2C usa `ESTADOS_B2C`.
- Comportamiento nuevo probado en `b2b-estados-entrega.char-spec.ts`; el helper `cerrarEntregasB2b` reemplaza al antiguo "segundo avanzar" para dejar un pedido Completado.

## 3. Pago y corrección del admin

- `DetalleB2B.pagadoAt` (fecha y hora del pago, sin usuario; los pagados antes de este campo quedan en `null` → el panel muestra "Fecha no registrada").
- `PATCH /pedidos-b2b/:id/marcar-pagado` y `/desmarcar-pagado` (Gerente/Dueño, 403 al Operador) funcionan en **cualquier estado, incluso Cancelado**; el pago nunca cambia solo (ni al corregir, editar ni cancelar). Modalidad `AL_INICIO`: marcar pagado un pedido Por confirmar (no cancelado) valida el mínimo y lo confirma; si ya pasó de Por confirmar solo marca el pago; **desmarcar solo toca el pago, nunca regresa el estado**.
- `PATCH /pedidos-b2b/:id/entregas/:entregaId/corregir` (Gerente/Dueño): sobre una entrega ya cerrada cambia líneas, cantidades y el estado Entregada↔No recogida, en pedidos Pagados, Completados o Cancelados; recalcula con el precio **actual del catálogo en todas las líneas** y reaplica el % de descuento del pedido, **no cambia el estado del pedido, no avisa a nadie y conserva la hora del cierre**. Un pedido Pagado ya no bloquea la edición de Gerente/Dueño (`puedeEditarPedidoPagado` deja lista la regla de que al Operador sí le queda bloqueado).
- `GET /pedidos-b2b` y `/export` aceptan `estadoPago=PENDIENTE|PAGADO`, `soloHistorico=true` (solo Completados y Cancelados; **Históricos lo manda siempre**, y su filtro de estado ofrece solo esos dos), `semanaAntesDe=YYYY-MM-DD` (semanaInicio estrictamente anterior) y, en el listado, `estados=A,B`. Excepción deliberada a los dorados: `lista?estados=…` ahora sí filtra por `estados` (antes lo ignoraba).
- **Panel:** Marcar/Desmarcar pagado piden confirmación (modal con folio y total; en `AL_INICIO` el de desmarcar avisa que el pedido conserva su estado). En la edición, los días con entrega cerrada salen bloqueados con su estado; el 409 dice la fecha ("mar 6 de oct"), el estado real y que se use «Corregir» (una entrega `LISTA` sigue editable). En «Corregir», una línea vacía/0 bloquea Guardar ("Indica una cantidad o usa Quitar"). Pedidos activos muestra aparte, siempre que existan, la sección "De semanas anteriores" (activos con `semanaInicio` anterior a la semana en curso, marcados "Semana anterior"); el export sigue siendo de la semana seleccionada.
- **Limitación conocida:** una entrega cuyas líneas incluyen un producto **borrado** del catálogo (`productId = null`, el snapshot sigue) **no se puede corregir** desde el panel (el botón se deshabilita con aviso): la corrección reenvía el conjunto completo de líneas y necesita un producto vivo. Un producto **desactivado** (`disponible = false`, lo normal en Banetto) sí funciona (probado en `b2b-pagos-correccion`).

## 4. Clientes B2B

Un cliente B2B es un `Cliente` con `canal = B2B`, dado de alta por un admin (`crearClienteB2b`, `clientes/cliente-b2b.ts`). Columnas y reglas en [modelo-datos.md](modelo-datos.md).

- **API `/clientes-b2b`** (`backend/src/clientes-b2b/`, solo tenants RETAIL_B2B vía `TenantB2bPanelGuard`; Gerente/Dueño, salvo `GET /clientes-b2b/selector`, abierto a los 3 roles): lista (búsqueda por nombre/teléfono, `estado=ACTIVOS|BAJA|TODOS`), alta, detalle, edición (el código no se edita), baja/reactivación y teléfonos (agregar/editar/quitar/`POST …/principal`, siempre ≥1 y exactamente 1 principal bajo `FOR UPDATE`). `GET /clientes-b2b/config` (Gerente/Dueño) da `modalidadCobroNegocio` y `modalidadesActivas`. `POST /clientes-b2b` acepta `sufijo` solo como opcional (seeds/scripts): sin él, el código sale del nombre comercial (`{slug}-{nombre-slugificado}`, con `-2`, `-3`… si ya existe). Filtros de reglas: solo clientes del canal del negocio y nunca de baja; `GET /clientes/activos` y Top clientes filtran por canal (`canalDeNegocio`).
- **Crear pedido desde el panel:** `POST /pedidos-b2b` (los 3 roles) recibe `clienteId` + `semanaInicio` + `items` + `notaCliente?` y ya NO crea ni actualiza clientes (`sincronizarDesdePedido` solo queda en B2C). Del cliente toma, como snapshot: nombre comercial (`negocioNombre`), contacto (nombre + teléfono principal), `descuentoPorcentajeAplicado` (el % vigente; sin código, `codigoDescuentoId/Texto` null) y la modalidad de cobro (la del cliente o, si no tiene, la del negocio); editar el pedido usa siempre el % guardado. Rechaza con 404 al cliente de otro negocio/no B2B, 409 al de baja y 409 (con `folio` y `pedidoId` en el cuerpo) si ya tiene un pedido no cancelado esa semana — seguro ante capturas simultáneas (`FOR UPDATE` del cliente, luego folio). Lo comparten el panel y el portal (`pedidos-b2b/pedidos-b2b-crear.ts`, `crearPedidoB2bDeCliente`).
- `POST /public/pedidos-b2b/tenants/:slug/pedidos` está CERRADO: siempre 409 «Los pedidos en línea de mayoreo se habilitan con tu cuenta de cliente. Contáctanos.».
- **Panel** (`/dashboard/clientes`, solo Gerente/Dueño; el Operador no lo ve): en un negocio RETAIL_B2B es el módulo de clientes de mayoreo (`clientes-b2b.tsx`, `cliente-b2b-form.tsx` alta, `cliente-b2b-panel.tsx` detalle/teléfonos/baja); en menudeo, el directorio de siempre (`clientes-menudeo.tsx`). «Nuevo pedido» en Pedidos activos (`nuevo-pedido-panel.tsx`, los 3 roles) usa `GET /clientes-b2b/selector`, `GET /pedidos-b2b/existente?clienteId&semanaInicio` (aviso previo de «ya tiene pedido esa semana», con enlace) y la cuadrícula compartida `cuadricula-dias.tsx`. `GET /pedidos-b2b/:id` suma `notaCliente` y `clienteCodigo` (excepción 9 de los dorados).
- **Código del cliente: dato heredado.** Se sigue generando (único por negocio) y se usa en el Excel y en seeds/scripts, pero ya no se usa en la operación: el panel no lo muestra ni lo captura y no se busca por él.
- **Mínimo de piezas:** el negocio acepta 0 (`PATCH /tenant/me`, `@Min(0)`) y se edita en Ajustes → «Pedidos de mayoreo» (solo Admin, `minimo-piezas-b2b-section.tsx`); con mínimo 0 no se muestra barra/leyenda de mínimo. **Un negocio nuevo nace con mínimo 0** (`@default(0)` en `Tenant.pedidoB2bMinimoPiezas`, migración `20261029120000_minimo_piezas_b2b_default_cero`, que solo cambia el DEFAULT: los negocios existentes conservaron su valor). El pedido guarda el mínimo vigente al crearlo (`minimoPiezasAplicado`).
- **Historial de pedidos y entregas del cliente** (solo lectura): en el `SidePanel` del cliente (`cliente-b2b-panel.tsx`), la sección «Pedidos» (`clientes/historial-pedidos-cliente.tsx`) lista TODOS los pedidos B2B del cliente —cancelados y completados incluidos, cualquier estado de pago, también si está de baja— y, al expandir uno, sus entregas. Sin botones de cerrar/corregir/editar. `GET /clientes-b2b/:id/pedidos?page&limit` (default 20, máx. 100; lista ligera: `id`, `folio`, `semanaInicio`, `estado` con `estadoB2bVisible`, `estadoPago`, `cancelado`, `canceladoAt`, `totalPiezas`, `total`, `createdAt`; orden `semanaInicio desc, createdAt desc, id desc`; «Cargar más») y `GET /clientes-b2b/:id/pedidos/:pedidoId/entregas` (solo las del pedido expandido; 404 si el pedido no es de ese cliente; `fecha`, `dia`, `estado`, `cerradaAt`, `atrasada` y `productos[{nombreProducto, cantidad, precioUnitario}]`, sin nota/hora/destino). Consulta `Order` (tipo B2B, por `clienteId`), nunca `Cliente.pedidosB2b`. El total de un pedido cancelado se muestra tal cual (recalculado solo con lo entregado antes de cancelar). La lista NO se cuadra con `totalPedidos`/`pedidosActivos`/`ultimoPedidoAt` (incluye cancelados). Pruebas: `clientes-b2b-historial.char-spec.ts`.
- Datos B2B de prueba: se limpian con `src/scripts/limpiar-b2b-prueba.ts` (ver [seeds-y-datos-demo.md](seeds-y-datos-demo.md)).

## 5. Panel lateral del pedido y Entregas del día

**Panel lateral** (`pedidos-b2b/detalle-panel.tsx`, usado por Pedidos activos e Históricos). De arriba abajo: encabezado (título = nombre del negocio, badge de estado a la derecha, línea «Semana del 19 oct · contacto · teléfono» y el correo como segunda línea si existe; sin folio, bloque gris de cliente ni tarjeta de Pago — `SidePanel` tiene `headerRight`/`subtitle`); aviso de cancelado («Cancelado el … · Pedido original $X · A cobrar $Y», original = Σ precio × cantidad de todas las líneas, a cobrar = `total`); «Modificado por el cliente»; franja de resumen (total en grande, «Pago: … · Al inicio/Al final», «Marcar pagado» para Gerente/Dueño; ya pagado muestra el badge con fecha y un enlace discreto «Desmarcar pago»); nota del cliente; **Entregas** (una fila plegable por entrega: «Mié 21 oct · 30 piezas · $1,253» + badge de estado/«Atrasada»; al abrir, productos con importe de la línea ANTES del descuento, que va solo en los totales; abierta por defecto la atrasada o, si no, la próxima Pendiente/Lista; las canceladas en gris); subtotal/descuento/total; «Resumen por producto» plegado (excluye entregas canceladas); **pie fijo** (prop `footer` de `SidePanel`): Por confirmar → «Confirmar pedido» + «Cancelar pedido»; Confirmado/En proceso → solo «Cancelar pedido» como texto; Completado/Cancelado → sin pie.

- **Confirmar (`/avanzar`) y cancelar (`/cancelar`) son solo Gerente/Dueño** (cambio deliberado: el Operador captura, edita —no un Pagado— y cierra entregas, pero no confirma ni cancela; 403 en la API y sin esos botones). Un pedido cancelado en «Por confirmar» ya no ofrece «Confirmar».
- «Editar pedido» (mismo editor de siempre) está en el encabezado de Entregas en todo estado no cancelado donde el servidor deja editar, incluido Completado desde Históricos. En un cancelado, «Marcar pagado» solo aparece si «A cobrar» > $0. En Históricos: Editar solo en Completado no cancelado; en Cancelado solo pago y corrección.
- Cálculos puros en `pedidos-b2b/entregas-vista.ts` (`EntregaVista`, monto, piezas, entrega abierta por defecto, resumen, `fechaCorta`); `entregas-lista.tsx` ES el bloque compartido (con `onCerrar`/`onCorregir`/`encabezadoAccion` opcionales ofrece las acciones dentro de la entrega abierta; sin ellos es solo lectura) y lo usa también el panel del cliente. Pruebas: `entregas-vista.test.ts`, `detalle-panel.test.tsx`.

**Entregas del día** (`/dashboard/pedidos-b2b/dia`): el listado incluye entregas de TODO pedido B2B con una entrega no cancelada ese día (también «Por confirmar», que no se pueden cerrar; su columna Estado muestra el badge ámbar «Sin confirmar»; confirmar se hace solo desde el panel del pedido); las canceladas nunca llegan. Sin «Total por producto» ni contador. Exportar (ícono) va a la derecha de la fila del selector de día. Acciones por fila en computadora: [Entregada][No recogida] (solo entregas abiertas de un pedido confirmado) e Imprimir (ícono) siempre al final; en teléfono todo va en «⋯». Impresión: ver [impresion-hardware.md](impresion-hardware.md). Al desplegar una fila, los productos salen en orden alfabético como líneas de la misma tabla (`Table` `subFilas`).

Convenciones visuales compartidas: [panel-admin-estilo.md](panel-admin-estilo.md).

## 6. Exportaciones en Excel (.xlsx, `exceljs`)

Entregas del día (`GET /pedidos-b2b/dia/:fecha/export-xlsx`: hojas «Entregas» —una fila por producto de cada entrega del día, sin canceladas— y «Consolidado» —por categoría+producto, clientes = negocios distintos—), Históricos y Pedidos activos (`GET /pedidos-b2b/export-xlsx`, mismos filtros que el listado; una fila por pedido, subtotal/descuento/total tal como están guardados). Abiertas a los 3 roles. Todo en español, cantidades y montos numéricos (moneda `$#,##0.00`), fechas como fechas (hora de pared de CDMX), encabezado en negritas, fijo y con autofiltro (`common/xlsx.ts`, `pedidos-b2b/pedidos-b2b-excel.ts`).

- Históricos y Pedidos activos llevan dos hojas, «Pedidos» y «Entregas» (siempre presente, vacía y con encabezados si no hay pedidos): una fila por entrega NO cancelada de los pedidos de la hoja «Pedidos» (las cerradas de un pedido cancelado sí salen), con Folio, Código del cliente, Negocio, Fecha de entrega, Día, Estado de la entrega («Atrasada» = Pendiente con fecha < hoy CDMX), Piezas, Importe antes de descuento, Cerrada el y Nota de la entrega; orden fecha, negocio, folio. Pedidos activos manda al export sus filtros de estado (`estados=[ese estado]`; sin estado, los 3 activos), pago y negocio; «De semanas anteriores» no entra.
- Hoy sí salen el código del cliente, la nota del cliente y el ID del ERP del producto (hojas Entregas y Consolidado). Método de entrega y punto de envío no existen en pedidos B2B (decisión de producto: cada cliente es una sucursal con dirección fija) y se quitaron de la especificación del Excel.
- **Los CSV de B2B** (`GET /pedidos-b2b/export` y `/dia/:fecha/export`) quedan SIN USO (el panel ya no los llama); se conservan solo porque los dorados de la Etapa 2 los cubren. Los CSV de B2C no cambian.

## 7. Portal del cliente B2B (`/mayoreo/[slug]`)

Código en `backend/src/portal/`, pantallas en `frontend/app/mayoreo/[slug]/` (`page.tsx` = acceso/selección/bienvenida), cliente HTTP `frontend/lib/portal-api.ts`.

### 7.1 Acceso y sesión

Flujo: el cliente escribe su teléfono → `POST /portal/acceso/pedir-codigo` → código de 6 dígitos por WhatsApp → `POST /portal/acceso/verificar` → sesión. El negocio sale del `slug` (en el cuerpo; endpoints `@Public()`, solo RETAIL_B2B, 404 si no).

- **Sesión:** token opaco guardado como hash en `sesiones_portal` (`SesionPortal`; NO es tabla de tenant), cookie `__Host-portal_<slug>` (HttpOnly, Secure, SameSite=Lax, Path=/, sin Domain), 90 días renovables en cada uso. Es sesión del TELÉFONO; `clienteId` es el cliente activo (null mientras un teléfono autorizado en varios clientes no elige). Las llamadas van por el mismo dominio del storefront (`/api-portal/*`, rewrite en `frontend/next.config.ts`; `frontend/proxy.ts` excluye esa ruta). **El navegador interno de WhatsApp y Chrome NO comparten cookies** (verificado en teléfono real): el diseño no debe depender de que compartan sesión. Cada petición revalida contra la base (negocio, `ClienteTelefono`, cliente existente y no de baja); si el cliente activo deja de ser válido pero el teléfono sigue autorizado en otro, la sesión sigue y vuelve a la selección sin pedir código; si no queda ninguno, 401 y se borra la cookie. Las escrituras exigen el encabezado `x-portal-request: 1` (anti-CSRF). `GET /portal/acceso/sesion` revalida (y renueva).
- **Códigos y límites** (Redis, `ioredis`, detrás de la interfaz `CodigosStore`; las pruebas usan `MemoriaCodigosStore`): código con HMAC (`PORTAL_OTP_SECRET`, si no `JWT_SECRET`), vigencia 10 min, un solo uso, 5 intentos (Lua atómico). Límites: 3/hora y 10/día por teléfono, 10/día por dispositivo (cookie `__Host-portal_disp`), 30/día por IP (`x-forwarded-for`) y tope diario por negocio (300, `PORTAL_TOPE_DIARIO_NEGOCIO`). Cuentan también los teléfonos que no son clientes. **Falla cerrado:** si Redis no responde, 503 y nadie pide ni verifica códigos. `pedir-codigo` responde SIEMPRE el mismo mensaje exista o no el cliente.
- **Código visible (solo pruebas):** con `PORTAL_CODIGO_EN_LOG=true` el código aparece en el registro del servidor (`[PORTAL_CODIGO] negocio=… telefono=***1234 codigo=…`), nunca en la respuesta HTTP. Se ignora SIEMPRE si `RAILWAY_PROJECT_NAME=aelika-production`. **Sin forma de entregar el código** (ni modo visible ni `portalPlantillaNombre` + `botWebhookUrl`) el acceso queda inerte: misma respuesta, sin generar código ni consumir límites.
- **`PORTAL_OTP_SECRET` propio en producción:** el respaldo con `JWT_SECRET` solo vale para staging.

### 7.2 Envío del código por WhatsApp

`EnviarCodigoAccesoService` (`backend/src/portal/enviar-codigo-acceso.service.ts`, separado del motor de reglas: no hay Regla ni Cliente) hace POST al MISMO webhook de Botpress de siempre (`Tenant.botWebhookUrl` + `x-bp-secret`); Aelika no guarda ni usa el token de Meta. Si el envío falla, el cliente ve el mismo texto genérico y el fallo solo queda en el registro del servidor (sin teléfono completo ni código). Para que un negocio envíe hacen falta los TRES: `Tenant.portalPlantillaNombre`, `Tenant.portalPlantillaIdioma` (sin valor por defecto) y `Tenant.botWebhookUrl`. Plantilla aprobada en la línea de prueba: nombre `auth`, idioma `es`, categoría autenticación, cuerpo `{{1}} es tu código de verificación.`, una variable y botón de copiar código. Timeout de 10 s.

**Para una prueba real en staging:** (1) `portalPlantillaNombre = 'auth'` y `portalPlantillaIdioma = 'es'` en `banetto-mayorista` (el webhook y el secreto ya existen: es el mismo bot compartido que usan las reglas); (2) apagar `PORTAL_CODIGO_EN_LOG` en staging para que el código no aparezca en el registro del servidor; (3) configurar el workflow en Botpress Studio según el contrato de abajo. **Pendiente (4g):** conectar el callback de resultado desde Botpress (hasta entonces el envío queda `EN_CURSO`). Datos de prueba: `backend/src/scripts/portal-cliente-prueba.ts`.

**Contrato que Botpress recibe** (`POST` al webhook del negocio; `Content-Type: application/json` y `x-bp-secret: <Tenant.botWebhookSecret>` si existe):
```json
{
  "correlacionId": "3f6c1c9e-2b0a-4d57-9a43-0d1f6a7e8b21",
  "negocio": "banetto-mayorista",
  "telefono": "+523331006915",
  "categoria": "AUTHENTICATION",
  "plantilla": { "nombre": "auth", "idioma": "es" },
  "variables": ["482915"],
  "boton": { "tipo": "COPIAR_CODIGO", "valor": "482915" }
}
```
`variables` es un ARREGLO posicional (una variable: el código → `{{1}}`). `boton` es OPCIONAL para Botpress, pero Meta exige el código también en el parámetro del botón de copiar código (componente `button`, `sub_type: url`, índice 0, texto = `boton.valor`), así que el flujo debe mandarlo ahí o el mensaje se rechaza. `negocio` es el slug (el bot es compartido). `correlacionId` identifica el envío y debe volver tal cual en el callback. De la respuesta del webhook solo importa el código HTTP: 2xx = aceptado (el envío sigue «en curso»); cualquier otro o más de 10 s sin respuesta = `FALLO`.

**Callback que Botpress debe llamar** cuando sepa el resultado (idealmente en ambos casos):
```
PATCH https://<api>/internal/portal-codigos/3f6c1c9e-2b0a-4d57-9a43-0d1f6a7e8b21/estado
X-Api-Key: <Tenant.botApiKey del negocio>     (el mismo guard del callback de reglas; NO es x-bp-secret)
Content-Type: application/json
```
Cuerpos: `{ "estado": "EXITO" }` o `{ "estado": "FALLO", "motivo": "Plantilla rechazada por Meta (131026)" }`. Respuestas: `200 { "id": "<correlacionId>", "estado": "EXITO" | "FALLO" }`; `401` sin llave o incorrecta; `404` si el id no existe, ya venció (24 h) o es de otro negocio (indistinguibles); `400` si `estado` no es `EXITO`/`FALLO` o `motivo` pasa de 500 caracteres; `503` si Redis no responde (reintentar). Un estado terminal no cambia. El `motivo` se sanea antes de escribirse en el registro (una línea, 200 caracteres, secuencias de 6+ dígitos → `***`): aun así, no mandar teléfonos ni códigos ahí (`portal-codigos-callback.controller.ts`).

**Registro del envío:** solo en Redis (`portal:envio:<correlacionId>`, TTL 24 h) con `{ tenantId, estado, motivo?, creadoAt, actualizadoAt }`; sin teléfono ni código, y SIN usar `ReglaEnvioLog`. El portal no lee este estado: es para el equipo técnico. Si Botpress nunca llama al callback, el envío se queda `EN_CURSO` hasta que venza el registro.

### 7.3 Parámetros y calendario

Parámetros del negocio en `Tenant` (Ajustes → Pedidos de mayoreo, solo Admin, `PATCH /tenant/me`): `portalHoraEntrega` ("HH:mm", default 08:00), `portalHorasAgregarDia` (36), `portalHorasModificar` (18), `portalHorizonteSemanas` (1 = semana en curso + siguiente; 0–4) y `numeroAtencion` (10 dígitos, vacío = el portal oculta «Contactar al negocio»).

`GET /portal/calendario?slug=` (requiere sesión; 401 sin ella, 409 si el teléfono está en varios clientes y no ha elegido) es la ÚNICA fuente de verdad: lógica pura en `backend/src/portal/portal-calendario.ts`, zona fija `America/Mexico_City` (instante de entrega por `Intl`, horas transcurridas, borde exacto válido). Estado por día: `AGREGABLE` (sin entrega y cumple las horas de agregar), `MODIFICABLE` (entrega Pendiente/Lista que cumple las de modificar), `CERRADO` (motivos `ENTREGA_CERRADA`, `ANTICIPACION_MODIFICAR`, `PEDIDO_PAGADO`) y `NO_DISPONIBLE` (`PASADO`, `ANTICIPACION_AGREGAR`), con `limiteAt` y `accion` (`CREAR_PEDIDO`/`AGREGAR_A_PEDIDO`). **Pedido Pagado: toda su semana queda CERRADO con `PEDIDO_PAGADO`**, incluidos días sin entrega y pasados. Una semana «tiene pedido» si existe uno no cancelado en cualquier estado; «activo» = Por confirmar, Confirmado o En proceso; **sin tope aparte**: `maximoActivos` = semanas del horizonte. La ventana de recepción `pedidoB2bVentana*` no interviene. Para probar horas distintas en staging basta cambiar los parámetros en Ajustes.

### 7.4 Crear pedido (`/mayoreo/[slug]/portal/crear/`)

Menú del portal: **Crear pedido · Modificar pedido activo · Ver mis pedidos**. Flujo: días (del calendario; solo días `AGREGABLE` de semanas sin pedido) → productos y cantidad total → reparto por fecha real → resumen (totales por semana, nota opcional, «guardar como favorito») → confirmación con folio(s). Modelo puro en `frontend/lib/portal-pedido-modelo.ts`. Backend: `GET /portal/catalogo` (con sesión y cliente activo; precio de lista, `descuentoPorcentaje` del cliente, mínimo; sin `erpId`), `POST /portal/pedidos`, `GET`/`PUT /portal/favorito`.

- **`POST /portal/pedidos`:** el cliente es SIEMPRE el de la sesión (un `clienteId`, precio o descuento en el cuerpo se ignora). Hasta dos semanas en UNA transacción (todo o nada; folios consecutivos); revalida cada fecha con la función del calendario DENTRO de la transacción, con el cliente bloqueado (`bloquearClienteB2b` → `crearPedidoB2bDeCliente`). Rechaza con 409 y una lista legible `fechas[{fecha,motivo,mensaje}]` (semana con pedido —incluida la Pagada—, menos de las horas para pedir, día pasado, fuera del horizonte), mínimo de piezas **por pedido (semana)**, producto no disponible. Idempotencia: encabezado `Idempotency-Key` (Redis 24 h; el segundo envío devuelve el mismo resultado; en curso → 409; si Redis no responde se sigue sin ella y la regla «un pedido por semana» evita duplicados). Descuento = % del cliente sobre el total.
- **Crear un pedido NO dispara ninguna notificación** (el único evento B2B es Confirmado); un test lo verifica.
- **Favorito:** `Cliente.favoritoB2b` (Json, uno por cliente, plantilla por día de la semana sin precios, nombre del producto como snapshot), compartido por todos los teléfonos del cliente. «Usar mi favorito» lo aplica al primer periodo sin pedido y quita con aviso los días que ya no cumplen y los productos no disponibles; guardar toma la distribución de la primera semana elegida y reemplaza al anterior. No aparece en `GET /clientes` ni en la API de clientes B2B.
- **Catálogo público cerrado:** `GET /public/pedidos-b2b/tenants/:slug/catalog` y `.../codigos-descuento/:codigo` ya no existen (404). Siguen públicos `GET /public/pedidos-b2b/tenants/:slug` (nombre y logo para la pantalla de acceso) y el `POST .../pedidos` (409 documentado).

### 7.5 Ver mis pedidos (`/mayoreo/[slug]/portal/pedidos`, `…/pedidos/[folio]`)

Solo lectura, siempre del cliente de la sesión. `GET /portal/pedidos?slug=&cursor=` (activos = Por confirmar/Confirmado/En proceso y no cancelado, todos, en la primera página; anteriores = Completado + Cancelado, de 20 en 20, paginación por offset en `cursor`; semana descendente), `GET /portal/pedidos/:folio?slug=` y `POST /portal/pedidos/:folio/favorito` (con `x-portal-request`). `PortalMisPedidosService` usa `select` explícito (lista blanca: nunca `Entrega.nota/hora/destino`, usuarios, factura, códigos de descuento, `erpId`, ids internos); todas las consultas filtran tenant + cliente de la sesión + `tipo = B2B`, así que folio de otro cliente, de otro negocio, B2C, inexistente o mal formado dan el mismo 404 (no 403). Estados en español desde el servidor (`estado.etiqueta`: Por confirmar, Confirmado, En proceso, Completado, Cancelado; entregas: Pendiente, Lista, Entregada, No recogida, Cancelada; las canceladas SÍ se muestran). Pago: «Pago pendiente»/«Pagado» + fecha. Detalle por línea con precio unitario (snapshot) y subtotal; descuento % y monto; `notaCliente`; `modificadoPorCliente` (oculto en pedidos cancelados). Favorito desde el detalle: mismas líneas por día de la semana que el de la creación (sin precios ni folio de origen), sin entregas canceladas; omite y nombra productos no disponibles/borrados y da 409 si no queda ninguno; `esFavorito` compara contenido con el favorito guardado. `useSesionPortal` redirige a la raíz del portal sin sesión; la base de ruta se toma del pathname para funcionar con y sin el prefijo `/mayoreo` del host público. Pruebas: `portal-mis-pedidos.char-spec.ts` y `portal/pedidos/pedidos-ui.test.tsx`.

### 7.6 Modificar pedido (`/mayoreo/[slug]/portal/modificar`, `…/pedidos/[folio]/modificar`)

`PATCH /portal/pedidos/:folio` (`PortalModificarPedidoService`, con `x-portal-request`), `GET /portal/pedidos/:folio/modificar` (estado de cada día) y `GET /portal/pedidos-modificables`. Siempre el pedido del cliente de la sesión (404 uniforme). Todo se revalida DENTRO de la transacción con el cliente y el pedido bloqueados (cliente → pedido, mismo orden que crear): pago, versión, calendario (cambiar o quitar una entrega ≥ `portalHorasModificar` antes, agregar un día ≥ `portalHorasAgregar`, bordes exactos válidos), mínimo de piezas del pedido, productos no disponibles (no se pueden agregar ni aumentar, sí reducir). Cuerpo: `{slug, version, entregas: [{fecha, items}], notaCliente?}`: cada elemento es el estado deseado de esa fecha, `items: []` la quita, las fechas no mencionadas no cambian; un día no modificable con contenido distinto → 409 con `fechas[{fecha,motivo,mensaje}]` y `codigo`. `version` es el `updatedAt` del pedido (409 `PEDIDO_CAMBIO` si cambió).

- Quitar una entrega la BORRA (no queda Cancelada); no se puede dejar el pedido sin entregas (409 `ULTIMA_ENTREGA`, el cliente no cancela el pedido completo; si quedan entregas cerradas y se quitan todas las pendientes el estado se recalcula solo → Completado); Confirmado → Por confirmar SOLO si cambiaron entregas; En proceso conserva su estado (salvo el recálculo por entregas); Pagado y Cancelado no se modifican (409 `PEDIDO_PAGADO`/`PEDIDO_CANCELADO`); el pago nunca cambia; todas las líneas toman el precio actual del catálogo y el % de descuento es el guardado (`recalcularTotalesB2b`); un pedido con una línea de producto borrado no se modifica desde el portal (409 `PRODUCTO_FUERA_DE_CATALOGO`). **La nota sola también enciende la marca**, sin regresar el estado; un PATCH sin cambios reales responde 200 `cambio:false` sin marca ni tocar `updatedAt`.
- **Marca «Modificado por el cliente»:** `Order.modificadoPorClienteAt` (null = sin marca). La enciende el portal; la apagan `avanzar`, `marcarPagado` cuando confirma (AL_INICIO) y la acción de abajo; editar desde el panel NO la apaga. El portal la ve como `modificadoPorCliente` y el panel como `modificadoPorClienteAt` en Pedidos activos (lista y panel lateral). `PATCH /pedidos-b2b/:id/marcar-revisado` (los 3 roles, idempotente, solo apaga la marca) y el botón «Marcar como revisado» existen porque un pedido En proceso o Completado nunca se vuelve a confirmar. Documentada en la Parte I como acción vigente (decisión de producto del 2026-10-29).
- Un aviso interno por WhatsApp sale al equipo cuando se enciende la marca (ver [notificaciones.md](notificaciones.md)); el aviso «Pedido confirmado» al cliente sale cuando el equipo reconfirma.
- **Concurrencia panel/portal:** `PATCH /pedidos-b2b/:id/items` acepta `version` OPCIONAL (el `updatedAt` que cargó el panel); si no coincide → 409 «El cliente modificó este pedido mientras lo editabas, recárgalo». El panel lo manda siempre y, tras un 409, recarga el pedido y sale de la edición. Nota de pruebas: el reloj de la suite está congelado, así que `updatedAt` no cambia solo; los tests de versión adelantan el reloj con `jest.setSystemTime`.
- **Frontend:** una tarjeta por día (editable lo que el servidor permite; lo cerrado en solo lectura con el botón de WhatsApp de contexto `dia`), totales estimados (`frontend/lib/portal-modificar-modelo.ts`; el servidor calcula el real), aviso de que se recalculan todos los precios con los de hoy, y confirmación antes de guardar. El detalle del pedido suma `modificable` y `version`.

### 7.7 Analítica (PostHog, solo frontend)

`frontend/lib/analitica.ts` + `components/analitica-portal.tsx` (montado en `app/mayoreo/[slug]/layout.tsx`; ni `/dashboard` ni `/tienda` lo cargan). Variables públicas: `NEXT_PUBLIC_POSTHOG_KEY` (sin ella no se inicializa y no hay llamadas; solo se carga en producción de Vercel) y `NEXT_PUBLIC_POSTHOG_HOST` (default `https://us.i.posthog.com`). `posthog-js` se carga con import dinámico y cada llamada traga errores. Autocapture, heatmaps, pageview/pageleave, performance y encuestas apagados; grabación con `maskAllInputs`, sin cuerpos ni encabezados de red; `sanitize_properties` cambia el folio de la URL por `:folio`. Eventos (propiedades permitidas: `slug`, `semana`, `dias`, `piezas`; `capturar` descarta cualquier otra): `portal_visto`, `codigo_solicitado`, `otp_verificado`, `otp_fallido`, `cliente_elegido`, `catalogo_visto`, `producto_agregado` (solo el primero por sesión de armado), `resumen_visto`, `pedido_confirmado`, `pedido_modificado` (solo si hubo cambio real). Identidad: `identify(Cliente.id)` + grupo `negocio`=slug; `reset()` al cerrar sesión, al elegir/cambiar de cliente o al cambiar de id. Hoy el portal no muestra los últimos dígitos del teléfono; si algún día se muestran, agregar `maskTextSelector`.

## 8. Observabilidad, origen y modalidades de cobro

- **Datos base de observabilidad (sin exponer en la API).** `DetalleB2B.confirmadoAt`: primera confirmación del pedido B2B (`avanzar` y `marcarPagado` en `AL_INICIO`; helper `confirmadoAtAlConfirmar`). Solo se guarda para pedidos con `createdAt >=` el corte de la variable de entorno `CONFIRMADO_AT_DESDE` (ISO; fijarla al instante del despliegue en cada entorno; sin variable o inválida no se guarda nada), nunca se sobrescribe; null = sin dato. `Cliente.ultimoAccesoAt`: último acceso al portal del cliente ACTIVO — se escribe al verificar el OTP (solo si el teléfono tiene un único cliente), al elegir/cambiar de cliente, y al reanudar sesión a lo más una vez por hora; está en `OMITIR_CAMPOS_B2B` y no sale en ninguna respuesta; escribirlo mueve `Cliente.updatedAt` (nada lo usa para ordenar ni filtrar). Migración `20261019120000_observabilidad_confirmado_ultimo_acceso`. Ningún camino de creación de pedido B2B nace confirmado.
- **Origen del pedido** (`DetalleB2B.origen`, enum `OrigenPedidoB2b`: `PORTAL_CLIENTE` | `PANEL_EQUIPO`): lo fija `crearOrdenB2b` a partir del parámetro obligatorio `origen` de `crearPedidoB2bDeCliente` (el panel pasa `PANEL_EQUIPO`, el portal `PORTAL_CLIENTE`; no hay otro camino de creación). Columna NULL sin relleno: los anteriores quedan «sin dato». No sale en ninguna respuesta. Uso futuro: medir la adopción del portal frente al panel (la sección Adopción hoy ya muestra porcentajes de origen). `Order.canalOrigen` NO sirve para esto (es el canal del chat y siempre es `WEB`). Migración `20261019210000_origen_pedido_b2b`.
- **Modalidades de cobro configurables** (Ajustes → Pagos, solo Admin): cada negocio tiene activas una o dos: «A crédito» (`AL_FINAL`) y «Pago por adelantado» (`AL_INICIO`); los valores internos del enum `PedidoB2bModoCobro` no cambian y los nombres salen de un solo mapa (`frontend/lib/modalidades-cobro.ts`, `backend/src/common/modalidades-cobro.ts`). Se guardan en `Tenant.modalidadesCobroB2b`; al menos una (`validarModalidadesActivas`, también para `PATCH /tenant/me`). **`Cliente.modalidadPago` es obligatoria** en todo alta/edición de cliente B2B (`validarModalidadCliente`): solo se elige entre las activas, pero una edición acepta conservar la actual aunque se haya desactivado; `null` se rechaza. **El pedido usa siempre la modalidad del cliente** (`crearPedidoB2bDeCliente`; sin modalidad → 409 claro + log). `Tenant.pedidoB2bModoCobro` DEJÓ de ser fuente de verdad (no se edita ni se expone). `GET /clientes-b2b/:id` suma `modalidadInactiva`; `GET /tenant/me/modalidades-cobro/uso` cuenta clientes activos por modalidad para el aviso al desactivar. El CSV B2B muestra el nombre (excepción 12 de los dorados). Migración de datos: `src/scripts/modalidades-cobro-b2b.ts` (guía: `backend/scripts/modalidades-cobro/README.md`); el backend endurecido solo funciona bien después de correrla.
- **Módulo Adopción** (`/dashboard/adopcion`, `backend/src/adopcion/`; solo lectura, solo Admin, solo mayoreo): `GET /adopcion/clientes?semana=<lunes>` y `GET /adopcion/interno`, `@Roles(DUENO)` + `TenantB2bPanelGuard`, consultas agregadas por `TenantPrismaService` (sin consulta por cliente); cálculos puros en `adopcion-calculo.ts`. Semana: lunes–domingo en America/Mexico_City; por defecto la PRÓXIMA; el selector va de lunes a lunes. **Tab Clientes:** estado en la semana (`Pidió` = pedido no cancelado y no por confirmar; `Pedido sin confirmar` = no cancelado en `PENDIENTE_CONFIRMACION`; `Cancelado` = solo hay pedidos cancelados; un cancelado que vuelve a pedir cuenta como Pidió; `No ha pedido (habitual)` = pidió sin cancelar en ≥2 de las 4 semanas anteriores); etapa = la más alta alcanzada (`Sin actividad` < `Accedió` [`ultimoAccesoAt`] < `Hizo pedido` [algún pedido no cancelado] < `Pide con regularidad` [≥3 de las 4 semanas anteriores]); los clientes de baja se excluyen salvo que tengan pedido en la semana; origen = porcentajes solo sobre pedidos con `DetalleB2B.origen`, mostrando los casos; «Cancelados después de confirmar» = pedidos de la semana con `cancelado` y `confirmadoAt`. **Tab Interno:** pedidos sin confirmar (todas las semanas), entregas atrasadas, pedidos de semanas anteriores sin completar, recibido→confirmado (mediana y máximo sobre pedidos creados en los últimos 28 días con `confirmadoAt`), puntualidad (solo `ENTREGADA` con `estadoCambiadoAt`: a tiempo = fecha de cierre en CDMX ≤ fecha programada) y no recogidas (aparte). Las listas muestran máximo 100 filas con el total real. Enlaces directos con `?pedido=<id>` en Pedidos activos e Históricos. No se mide «Lista → Entregada» ni quién hizo cada cambio.

## 9. Divergencias abiertas entre la Parte I y el código

El 2026-10-29 Santiago decidió las divergencias que había: la Parte I se actualizó para reflejar el comportamiento actual (confirmar y cancelar solo Gerente/Admin, Ajustes del Gerente, mínimo de piezas configurable con 0 = sin mínimo y default 0, origen del pedido, código del cliente como dato heredado, reconfirmación sin deduplicación, «Marcar como revisado») o se quitó del diseño (evento «Entrega entregada», método de entrega y punto de envío en B2B y sus columnas del Excel). Quedan solo estas diferencias abiertas, que son trabajo pendiente respecto al diseño, no decisiones de producto en contra:

| Tema | Parte I (diseño) | Estado en el código | Situación |
|---|---|---|---|
| Días sin entrega (festivos) | El admin marca fechas sin entrega que bloquean la selección del cliente (prioridad baja) | No existe (sin modelo ni código) | **En construcción**, se implementa en un cambio aparte |
| Fecha de completado del pedido | El pedido guarda su fecha de completado | No se guarda; solo hay `confirmadoAt` (y solo desde el corte `CONFIRMADO_AT_DESDE`) | **Diferido** |

## 10. Por confirmar con Santiago (no verificable desde el repo)

- Si la migración de datos de la Etapa 2 (`etapa2-b2b.ts`) y el script de estados (`b2b-estados.ts`) ya se corrieron en **producción** (el código y el esquema están en `main`; la última noticia en el repo es que en staging se corrieron con auditoría OK).
- Si `modalidades-cobro-b2b.ts` se corrió en cada entorno.
- El valor de `CONFIRMADO_AT_DESDE` en cada entorno.
- Estado de las plantillas de Meta (`auth`, `pedido_modificado_cliente`, recordatorios y reservas) y de los workflows de Botpress que consumen los contratos de 7.2.
- El resto de validaciones de la lista «Validaciones técnicas y pendientes» de la Parte I.
- Valor actual de `pedidoB2bMinimoPiezas` en cada negocio B2B de staging y producción (la migración de default 0 no cambia a ninguno; ver el reporte del cambio del 2026-10-29).
