# Panel administrativo: estilo y convenciones de frontend

Aplica a `/dashboard/*` y `/login`. **No aplica a `/tienda/[slug]`** (tiene su propia paleta, ver [pedidos-b2c.md](pedidos-b2c.md)). Componentes compartidos en `frontend/app/dashboard/_components/`.

## Shell y colores

- Shell: **sidebar** fija de 210 px (`frontend/app/dashboard/nav.tsx`) con un solo bloque arriba (negocio + rol · usuario, y el menú: cambiar contraseña, cerrar sesión) + topbar blanca con el título de la sección. Los items del menú y los títulos salen de una sola lista (`frontend/app/dashboard/nav-items.ts`). El wrapper `<main>` (`max-w-[920px] p-5`) vive una sola vez en `layout.tsx`; cada página no repite contenedor ni `<h1>` (el título lo da la topbar), salvo el saludo "Hola, {nombre}" de `/dashboard`.
- Tokens `admin-*` en `frontend/app/globals.css` (`--color-admin-green`, `--color-admin-green-dark`, `--color-admin-bg`, `--color-admin-ink`, `--color-admin-sidebar`). **Nombres deliberadamente separados** de los tokens `whatsapp`/`chat-*` del storefront aunque el verde sea el mismo hex; pueden divergir. `.input` (compartida con `/tienda`) no se tocó.
- Paleta clara fija con sidebar oscura: **no hay modo oscuro** en el panel (sin variantes `dark:`).
- `GET /auth/me` incluye `tenant: { nombre }` para que el sidebar muestre el nombre del negocio sin otra llamada.
- Rol "Dueño" = "Admin" en pantalla (`frontend/lib/roles.ts`, `ROLE_LABEL`). **Ajustes:** el Gerente ve solo Información del negocio y Equipo; `frontend/app/dashboard/ajustes/acceso.ts` centraliza quién ve qué y el mensaje por rol.
- Catálogo: categorías/productos son cards individuales por fila; "Marcar (no) disponible" es un `ToggleSwitch` que llama al mismo `updateProduct(token, id, {disponible: !disponible})`.
- Badges de pedido B2C: pills sólidos con texto blanco; `LISTO_ENTREGA` usa `admin-green-dark` (el verde brillante no pasa contraste con texto blanco a ese tamaño); `DESPACHADO` usa `admin-ink`.

## Badges de estado (`Badge`)

Color = significado en todo el panel: ámbar `advertencia` = requiere acción, azul `info` = en curso, verde `exito` = terminado bien, rojo `peligro` = terminado mal, gris `neutro` = normal, gris oscuro `oscuro` = solo «Reembolsado». El teal (acento) NO se usa en badges. Altura 20 px, texto 12 px medio, punto de 6 px antes del texto (solo variantes de estado, no los categóricos con `color`). `ancho` (`pedidoB2c`/`pedidoB2b`/`pago`/`pagoB2b`/`entrega`) fija un ancho mínimo por tipo SOLO en columnas de tabla (calibrado en `ch` contra el texto más largo; recalibrar si cambian textos o fuente). Un solo mapeo de `EstadoPago` (`pedidos/estado.ts`) para B2C, B2B y Pagos.

## Tamaños de control

Solo dos, en `globals.css`: `--control-barra` 40 px y `--control-tabla` 32 px (en teléfono sube a 40 px); utilidades `h-barra`/`w-barra`/`h-tabla`/`w-tabla`.
- `barra` = fila de controles de la página (selector de periodo, buscador, Filtros, exportar, Imprimir todo, Nuevo pedido, Hoy/Esta semana), campos de formulario (`input.admin-input`/`select.admin-input` miden 40 px) y botones de envío de formularios/modales.
- `tabla` = botones dentro de tablas y paneles (Entregada, Confirmar pedido, ⋯, Editar, Ver cliente, Marcar pagado, paginación).
- `Button` solo tiene `size="barra"|"tabla"` (xs/sm → tabla, md/lg → barra, por compatibilidad). Los botones de solo ícono (`BotonExportar`, `MenuAcciones`) son cuadrados con la altura de su grupo. **No usar alturas sueltas** (`h-8`, `py-1.5`…) en controles.
- Botones: `secondary` = borde neutro, fondo blanco, texto oscuro (también `xs`, 20 px, con ícono: «Editar», «Ver cliente», «Marcar pagado»); `primary` es el único relleno de color. En teléfono todo botón mide ≥ 40 px.

## Encabezado de página y fila de controles

El encabezado (`PageHeader`) es solo el título. Debajo va UNA sola fila con todos los controles (`BarraBusqueda`: `izquierda` = selector de periodo, buscador, `filtros`, `acciones`, `crear`), que nunca se parte en dos líneas. Si no cabe, se degrada por niveles (se mide el desborde en `useLayoutEffect`; se reinicia al cambiar el ancho o el contenido): 1) etiqueta corta del selector («19–25 oct», «Hoy · 19 oct»), 2) Filtros/crear/acciones solo con ícono («+» para crear), 3) acciones secundarias (exportar, Imprimir todo, «Hoy»/«Esta semana») dentro de un «⋯» al final, 4) Filtros también dentro del «⋯». Siempre visibles: selector (o buscador) y crear. El «⋯» solo aparece si hay algo escondido. Ya no existe `PageActions`.

- **Buscador y filtros:** el botón de exportar (cuadrado, solo ícono, prop `exportar`) va en la misma fila, a la derecha de «Filtros»; en teléfono exportar sigue en el menú «⋯». Buscador con lupa que busca mientras escribes (espera 300 ms), botón «Filtros» con un panel (listas que aplican al elegir, Total con mínimo/máximo, fecha o semana con calendario desde/hasta), chips de filtros activos con ✕ y «Limpiar filtros». Un solo estilo de chip. Sin «Ordenar por».
- **Orden fijo por tabla:** Pedidos activos y Históricos B2B (`semanaInicio desc, createdAt desc, id desc`), Histórico B2C y Pagos (`createdAt desc`), Clientes B2C (`ultimoPedidoAt desc`), Clientes B2B (alfabético), Entregas del día (pendientes/listas, luego entregadas y no recogidas; dentro por negocio), Adopción (habituales sin pedir primero).
- **Navegar periodos** (`SelectorPeriodo`, `modo="dia"|"semana"`): un solo grupo con borde `[ ‹ | etiqueta | › ]` de 44 px, etiqueta de ancho fijo («Hoy · lun 19 oct»; «Esta semana · 19–25 oct», «Próxima semana · …», «Semana pasada · …»), clic en la etiqueta abre un calendario de un solo clic (en semana toma la semana completa) y «Hoy»/«Esta semana» junto al grupo solo fuera del periodo actual. `min`/`max` limitan flechas y calendario; una flecha sin destino se ve desactivada con tooltip (Pedidos activos B2B: «Las semanas anteriores están en el aviso de arriba»). Lo usan Entregas del día y Pedidos activos.

## Tablas, avisos y teléfono

- **`Table`:** columnas con `truncate` (absorbe el ancho y recorta con «…»), `compact` (solo lo que necesita) y `movil` (en teléfono solo se muestran las columnas marcadas); `expandedRow` para filas desplegables y `subFilas` (líneas de la misma tabla). La paginación lleva conteo abajo («1–20 de 46 resultados») con flechas — nunca un contador arriba (excepción: contadores de trabajo como el de Entregas del día). Fechas en tablas: solo fecha (`formatFechaSola`); se conserva la hora donde opera (Pedidos B2C, Adopción › Interno, ticket).
- **`Aviso`:** una línea, fondo suave sin borde marcado, ícono, texto y acción como enlace; ámbar = requiere acción, rojo = cancelación/error, neutro = informativo. `Tabs` no se pinta con una sola pestaña.
- **Teléfono (< 768 px, `useEsMovil`):** barra fija con ☰ + negocio; el menú lateral es un cajón; acciones del título como «+» y «⋯»; tablas a dos columnas; `SidePanel`/`Modal` a pantalla completa con ✕ arriba y acciones fijas abajo a lo ancho. Ninguna página debe tener scroll horizontal (la columna principal del layout lleva `min-w-0`).
- Cada archivo de sección de Ajustes repite sus propias constantes `CARD`/`BTN_*`/`ToggleSwitch` en vez de centralizarlas (convención establecida).
- **Cantidad de piezas:** todo input de cantidad usa `frontend/components/cantidad-input.tsx` (puede quedar vacío mientras se escribe; vacío = 0 al guardar; el 0 es solo placeholder; al enfocar se selecciona el contenido).
