# Banetto — Diseño de la operación de pedidos

Oct 7, 2026 · @santiago

## Principios y alcance

La operación se diseña para ser lo más simple posible: reglas claras para el cliente y libertad para el equipo. Hoy todo se pide por WhatsApp sin sistema; el objetivo es que un sistema controle la recepción y operación de los pedidos.

- **Clientes:** cafeterías con entregas programadas. Hoy son \~30; la operación debe soportar 4X (\~120 clientes).
- **Regla de oro:** las restricciones de tiempo aplican solo al cliente. El equipo puede crear y modificar libremente.
- **Fuera de alcance en esta versión:** cobranza en sistema, facturación, cupo de capacidad por día, pedidos recurrentes automáticos, disponibilidad de productos por día, registro de cambios de pedidos, mínimo de piezas.

## Datos

Estos son los datos que guarda el sistema. El **negocio** es el tenant (Banetto); el **cliente** es quien le compra (cada cafetería o cada sucursal de una cafetería).

### Negocio

| Campo | Obligatorio | Notas |
| --- | --- | --- |
| Nombre comercial | Sí |  |
| Código de negocio | Sí | Slug del nombre comercial (ej. banetto), único. Es el prefijo de los códigos de sus clientes |
| Dirección | Sí | Instalaciones donde está el mostrador |
| Puntos de envío | No | Cada uno con nombre, dirección y monto mínimo para domicilio. Sin puntos de envío, no se puede pedir a domicilio |
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
| Dirección | Sí | Donde se entrega si el pedido es a domicilio |
| Código de cliente | Sí | Código del negocio + slug del cliente (ej. banetto-matriz, banetto-americas, banetto-providencia). Único. Identificador interno: se usa en el panel y en el Excel; el cliente no lo escribe al entrar al portal. No se puede editar después de crearlo, por ahora |
| Descuento | No | % sobre el total del pedido. Aplica solo dentro de su negocio |
| Modalidad de pago | No | Si no se define, usa la del negocio |
| Teléfonos autorizados y número principal | Sí, al menos 1 | Un mismo teléfono puede estar registrado en varios clientes, del mismo negocio o de negocios distintos |
| Pedido favorito | No | Uno por cliente. Lo marca el cliente desde Mis pedidos y lo usa al crear un pedido (ver Canales). Guarda productos y cantidades por día de la semana, no precios |

Una cafetería con 3 sucursales se da de alta como 3 clientes, cada uno con sus teléfonos, descuento y pedidos.

Un cliente está **activo** mientras no esté dado de baja. La baja es lógica: el cliente ya no puede entrar ni pedir, sus pedidos activos siguen hasta completarse y su historial se conserva.

### Pedido

| Campo | Notas |
| --- | --- |
| Folio | P- + consecutivo de 6 dígitos por negocio (ej. P-000001). Aplica solo a pedidos B2B nuevos; los pedidos B2C conservan su consecutivo simple |
| Cliente | Uno por pedido |
| Semana | Fecha de inicio (lunes) y fin (domingo) |
| Método de entrega | Mostrador o a domicilio. Uno por pedido |
| Punto de envío | Uno por pedido, solo si el negocio tiene puntos de envío |
| Estado operativo | Por confirmar, Confirmado, En proceso, Completado, Cancelado |
| Estado de pago | Pendiente o Pagado, con la fecha en que se marcó |
| Nota del cliente | Opcional, texto libre. Visible en el panel lateral y en el Excel |
| Modificado por el cliente | Marca que se enciende cuando el cliente modifica el pedido en el portal y se apaga cuando el equipo lo vuelve a confirmar |
| Descuento aplicado | % que tenía el cliente al crear el pedido. Si después cambia, no afecta este pedido |
| Subtotal, descuento y total | En pesos, IVA incluido |
| Fechas | Creación, confirmación y completado |

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

Si el número no está autorizado en ningún cliente del negocio, ve "Tu número no está dado de alta, contáctanos" y no puede seguir.

**Límite de envíos:** cada envío de código cuesta un mensaje de WhatsApp, así que los envíos tienen límite por teléfono y por dispositivo.

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

- **Crear pedido:** pantalla por pantalla, muy parecido al storefront B2B actual. Los datos del cliente vienen precargados y el descuento ya aplicado. Al terminar, el cliente ve una pantalla de confirmación con el folio y el resumen; no se envía WhatsApp hasta que el equipo lo marca Confirmado. Ver la pestaña Pantallas actuales. Si el cliente tiene pedido favorito, puede pulsar **Usar mi favorito**: llena el carrito y la distribución por día de la semana, y el cliente puede editarlo antes de enviar. Los días que ya no cumplen las 36h se quitan con un aviso. Los precios son siempre los actuales.
- **Modificar pedido activo:** muestra solo los pedidos con alguna entrega todavía modificable; si hay dos, el cliente elige. Reglas en la sección Reglas de pedido. Las entregas a menos de 18h y las ya cerradas se ven bloqueadas, con un botón para contactar al negocio (número de atención configurado en Ajustes).
- **Ver mis pedidos:** pedidos activos e historial, con estado, entregas y estado de pago. Al abrir uno se ve el detalle: información básica del pedido, sus productos, sus entregas con su estado y el estado del pago. Desde aquí el cliente marca un pedido como su **favorito** (uno por cliente).
- El cliente **no cancela el pedido completo**: eso se pide por teléfono al negocio.

**Captura por teléfono:** el operativo selecciona al cliente de una lista y captura el pedido o la modificación desde el navegador.

## Catálogo y descuentos

El catálogo tiene un solo precio para todos los clientes.

- 5 clientes tienen descuento del 10% o 20%.
- El descuento es un % fijo que se configura en el detalle del cliente (módulo Clientes), no un código que el cliente escribe. Los códigos de descuento que hoy existen en el storefront no se usan para Banetto. Se aplica solo al total del pedido, incluyendo todos los productos.
- Cada sucursal de una cafetería es un cliente distinto, con su propio descuento. El descuento se aplica al crear el pedido; si después cambia, no afecta pedidos ya creados.

## Métodos de entrega y puntos de envío

Cada pedido tiene un método de entrega y, si el negocio tiene puntos de envío, un punto de envío; lo único que cambia de una entrega a otra es su fecha y su distribución (productos y cantidades). Banetto arranca con solo mostrador.

| Nivel | Qué contiene |
| --- | --- |
| Negocio | Métodos de entrega habilitados, dirección del mostrador y sus puntos de envío (opcionales) |
| Punto de envío | Sucursal del negocio desde donde se hace el envío a domicilio; monto mínimo para envío a domicilio |
| Cliente | Datos, teléfonos autorizados, descuento y dirección de entrega |
| Pedido | Cliente, semana, método de entrega, punto de envío, estado y total |
| Entrega | Fecha y hora, distribución (productos y cantidades) y estado |

- **Mostrador:** el cliente recoge en las instalaciones del negocio. Los puntos de envío no aplican al mostrador.
- **A domicilio:** requiere que el negocio tenga al menos un punto de envío; sin puntos, la opción no aparece. El punto de envío entrega en la dirección del cliente. Cada punto puede tener un monto mínimo, que se valida sobre el total del pedido.
- Si el negocio tiene más de un método o más de un punto de envío, el cliente elige al crear el pedido. Si solo hay una opción, el sistema la asigna sin preguntar.

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
- **Modificación por el cliente:** las entregas a menos de 18h y las ya cerradas quedan bloqueadas en el portal. Si el pedido estaba Confirmado y el cliente lo modifica, regresa a Por confirmar y se marca "Modificado por el cliente" en Pedidos activos y en el panel lateral hasta que el equipo lo vuelva a confirmar. El pago no cambia por la modificación.
- Sin mínimo de piezas por pedido ni por entrega.

**Incentivo para pedir antes del sábado 8pm:** sábado 8pm es exactamente 36h antes del lunes 8am. Quien pide después pierde la entrega del lunes; después del domingo 8pm, también la del martes. Los recordatorios lo dicen explícitamente.

| Si pide el… | Puede elegir |
| --- | --- |
| Miércoles 10am | Viernes a domingo de esta semana, y lunes a domingo de la siguiente |
| Sábado 7pm | Lunes a domingo de la siguiente semana |
| Domingo 10am | Martes a domingo de la siguiente semana |

**Días no laborables:** el admin marca en un calendario las fechas sin entrega. El negocio decide cuáles son; si no producir un día afecta la entrega del día siguiente, también marca ese día.

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
2. El equipo revisa las entregas y los productos de cada entrega, y lo marca **Confirmado**. Se notifica al cliente. Un pedido se puede cancelar en Por confirmar, Confirmado o En proceso: las entregas ya cerradas se quedan como están y se cobran; las pendientes pasan a Canceladas y no se cobran. No existe cancelar una entrega suelta: quitar un día se hace editando el pedido (el equipo en el panel; el cliente en el portal, hasta 18h antes). El cliente no cancela el pedido completo. Si el cliente modifica un pedido Confirmado, vuelve a Por confirmar hasta que el equipo lo confirme de nuevo.
3. Cada entrega nace **Pendiente** y se cierra como:
   - **Entregada:** el cliente la recoge en mostrador o la recibe a domicilio. Se cobra y se envía la relación de lo entregado.
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
| Pedido confirmado | Por evento | Cuando el pedido cambia a Confirmado, incluido cuando el equipo lo reconfirma tras una modificación del cliente | Cliente del pedido | Activo. Resumen: entregas por día, productos y total con descuento |
| Entrega entregada | Por evento | Cuando una entrega cambia a Entregada | Cliente del pedido | Activo. Relación de lo entregado en esa entrega |

- Si el admin corrige una entrega ya entregada, no se reenvía la relación. La versión corregida se ve en el portal.
- Todos los mensajes salen fuera de la ventana de 24h de WhatsApp, así que cada uno necesita una plantilla aprobada por Meta. Los recordatorios son categoría marketing; las operativas son utilidad; el código de acceso es autenticación.

## Roles y permisos

Se usan los tres roles que ya existen en el panel. Dueño y Gerente funcionan como admin: gestionan clientes, catálogo, correcciones y pagos. Operador es el rol operativo: pedidos y entregas del día.

| Rol en el panel | Función | Quién | Puede |
| --- | --- | --- | --- |
| Dueño / Gerente | Admin | Matías, Anahí | Todo lo del operador. Gestionar clientes: alta y baja, teléfonos autorizados, número principal, descuentos. Catálogo. Corregir pedidos ya entregados, incluso si ya están marcados como Pagados. Marcar y desmarcar Pagado. Configuración y usuarios del equipo (solo Dueño en Ajustes, como hoy) |
| Operador (usuario individual) | Operativo | Mariana, Fernanda | Crear, modificar y confirmar pedidos sin límite de tiempo antes de la entrega. Gestionar entregas del día. Exportar Excel. No tiene acceso al Catálogo (solo ve los productos al capturar un pedido). Un pedido marcado como Pagado queda bloqueado para él |
| Operador (usuario compartido) | Operativo | Resto del equipo | Lo mismo que el operador individual |

En esta versión no hay registro de cambios de los pedidos ni se guarda qué usuario capturó, confirmó, cerró una entrega o marcó como pagado.

## Módulos de la plataforma

El equipo opera desde los módulos del sidebar B2B actual, ajustados. Los detalles de pedidos y entregas se abren en un panel lateral, como hoy. Programa de Lealtad se oculta para Banetto; Notificaciones se queda como módulo propio del sidebar.

| Módulo | Para qué sirve | Quién |
| --- | --- | --- |
| 1. Inicio (dashboard operativo) | Resumen del día: entregas de hoy por estado, entregas atrasadas, pedidos por confirmar, clientes sin pedido para la siguiente semana, consolidado de producción de mañana. Parte del Inicio B2B actual. Requisito del día uno | Todos |
| 2. Pedidos activos | Ver, crear, modificar, confirmar, cancelar y gestionar pedidos. Marcar como pagado (solo admin). Vista semanal (Semana en curso / Próxima semana) | Todos |
| 3. Entregas del día | Listado de entregas de un día, navegando entre días. Marcar cada entrega como Entregada o No recogida. Imprimir comanda. Exportar Excel | Todos |
| 4. Históricos | Todos los pedidos completados y cancelados, con filtros por estado, estado de pago, semana, total y cliente. Marcar como pagado y corregir entregas ya entregadas (solo admin). Exportar Excel | Todos consultan; solo admin corrige y marca pagado |
| 5. Catálogo | Ver, crear, modificar, activar y desactivar productos y sus categorías. Bloqueado del todo para el Operador, que solo ve los productos en la captura de pedidos | Solo admin |
| 6. Clientes | Ver, crear, modificar y dar de baja clientes: código de cliente, teléfonos autorizados, número principal, descuento, dirección | Solo admin |
| 7. Notificaciones | Reglas de los eventos de la sección Notificaciones: activación, horario, filtro y plantilla | Solo admin |
| 8. Ajustes | Parámetros del negocio, número de atención del negocio, días sin entrega, métodos de entrega y puntos de envío, usuarios del equipo (alta, baja y rol) | Solo admin |

**Detalle por módulo:**

- **Pedidos activos:** como la vista actual. Muestra los pedidos que aún no están completados ni cancelados. Todos los cambios del equipo a un pedido se hacen desde aquí, en el panel lateral. Al completarse o cancelarse, el pedido pasa a Históricos. Si a un pedido Completado se le agregan entregas, vuelve solo a En proceso y a Pedidos activos. Un pedido que el cliente modificó desde el portal regresa a Por confirmar y lleva la marca "Modificado por el cliente" en la lista y en el panel lateral hasta que el equipo lo confirme.
- **Entregas del día:** cada entrega se marca una por una (Entregada o No recogida); no hay cambio de estado en bloque. Una entrega de un día pasado que sigue Pendiente se muestra como atrasada; no se cierra en automático.
- **Los pedidos no se borran:** solo se cancelan.

**Excel de Entregas del día**: archivo Excel real (.xlsx) con dos hojas, Entregas (una fila por producto de cada entrega del día) y Consolidado:

| Hoja | Columnas |
| --- | --- |
| Entregas | Fecha de entrega, folio, cliente, método de entrega, punto de envío, estado de la entrega, categoría, producto, ID ERP, cantidad, precio unitario, subtotal, nota del cliente |
| Consolidado | Fecha, categoría, producto, ID ERP, cantidad total, número de clientes |

**Excel de Históricos** (una fila por pedido, con los filtros aplicados):

| Columnas |
| --- |
| Folio, cliente, método de entrega, punto de envío, semana (inicio y fin), fecha de creación, estado del pedido, estado de pago, fecha de pago, entregas totales, entregadas, no recogidas, canceladas, subtotal, descuento %, descuento $, total (IVA incluido) |

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
| Mínimo por pedido o por entrega | Ninguno | Piezas o monto mínimo |

### Catálogo, clientes y operación

| Parámetro | Valor Banetto | Otro negocio podría… |
| --- | --- | --- |
| Métodos de entrega | Mostrador | Mostrador y a domicilio |
| Puntos de envío | Opcionales; sin puntos no hay domicilio | Varios, el cliente elige por pedido |
| Monto mínimo para domicilio (por punto de envío) | No aplica | Un monto por punto, sobre el total del pedido |
| Descuento por cliente | % fijo sobre el total, aplicado al crear el pedido | Sin descuentos |
| Módulo de pagos | Apagado (el admin marca el pago a mano) | Cobrar en línea |
| Modalidad de pago (con excepción por cliente) | Crédito | Anticipado |
| Alta de clientes | Solo admin | Autorregistro con aprobación |
| Pedir código de cliente al entrar | No | Sí |
| Duración de sesión | 60–90 días | Más corta |
| Confirmación manual del pedido | Sí | Confirmación automática |
| Estados de entrega en uso | Pendiente, Entregada, No recogida, Cancelada | Con "Lista"; sin "No recogida" |
| Notificaciones | Los 3 eventos de la sección Notificaciones (4 envíos) | Cada una con su activación, horario, filtro y plantilla |
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
- Registro de cambios de los pedidos, de qué usuario hizo cada acción y del origen del pedido.
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
