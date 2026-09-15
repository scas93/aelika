// Motor de scoring de Aelika Scan (Módulo 5, en definición). Este archivo es
// puro contrato de datos — la lógica de cálculo vive en scoring.ts. Sin
// dependencias externas ni de NestJS a propósito: este módulo no llama APIs,
// no expone HTTP y no persiste nada (eso llega en fases posteriores).

export enum CategoriaId {
  SITIO_WEB = 'SITIO_WEB',
  GOOGLE_MAPS = 'GOOGLE_MAPS',
  INSTAGRAM = 'INSTAGRAM',
  FACEBOOK = 'FACEBOOK',
  NAP = 'NAP',
  WHATSAPP = 'WHATSAPP',
}

// Vocabulario único de resultado para todo check, binario o de 3 niveles.
// Un check binario nunca produce ACEPTABLE (cumple -> OPTIMO, no cumple ->
// NECESITA_ATENCION) — se reutiliza el mismo enum en vez de tener un tipo de
// resultado aparte para binarios, así el output de scoring.ts habla un solo
// idioma sin importar el tipo de check.
export enum NivelCheck {
  OPTIMO = 'OPTIMO',
  ACEPTABLE = 'ACEPTABLE',
  NECESITA_ATENCION = 'NECESITA_ATENCION',
}

// Algunos checks del prompt tienen un umbral descrito en términos
// cualitativos, no numéricos ("responde a la mayoría de comentarios",
// "contenido nativo mayoritario vs. mixto vs. mayoría enlaces", "presencia
// de Reels: mayoría/algunos/ninguno", "horario completo/parcial/ausente").
// Sin una definición numérica de "mayoría" en el prompt, este módulo no
// puede recalcular ese umbral — así que para esos checks específicos recibe
// el nivel ya clasificado como dato crudo, y la clasificación en sí (contar
// posts, comparar contra el total) es trabajo de la fuente de datos, no de
// este motor. El resto de los checks con umbral numérico explícito (rating,
// pagespeed, % reels, días desde última publicación, etc.) sí reciben el
// valor crudo y este módulo aplica el umbral.

// Regla 3 vs. regla 4 (ver CLAUDE.md/prompt): "sin canal" (el negocio no
// tiene ese canal — categoría califica 0 pero SÍ cuenta en el denominador)
// es un caso explícito dentro del input de la categoría, distinto de "no
// aplica a este nivel" (la categoría completa ni siquiera se manda — ver
// DatosEscaneo). Solo aplica a categorías que son, en sí, un canal opcional
// que un negocio puede no tener: sitio web, Instagram, Facebook, WhatsApp.
// Google Maps y NAP no modelan "sin canal" — todo negocio de este producto
// tiene (o debería tener) una ficha de Maps, y NAP es una comparación
// cruzada entre las otras fuentes, no un canal en sí mismo.
export type ConCanal<T> = ({ tieneCanal: true } & T) | { tieneCanal: false };

export interface SitioWebInput {
  sslActivo: boolean;
  // Igual mecanismo de exclusión que GoogleMapsInput.velocidadResenasNuevas/
  // tasaRespuestaResenas (regla 5): PageSpeed Insights es una fuente externa
  // que puede fallar para un escaneo en particular, sin que eso invalide el
  // resto de la categoría — ver la integración de Sitio web en Fase 2.
  // 0-100, resultado crudo de PageSpeed cuando disponible.
  pagespeed: { disponible: false } | { disponible: true; valor: number };
  // Mismo mecanismo, pero acá `disponible: false` es una decisión cerrada,
  // no una degradación por escaneo: Google deprecó "Search the entire web"
  // en Programmable Search Engine, así que la Google Custom Search JSON API
  // ya no puede verificar indexación de un sitio de tercero bajo ningún
  // setup — la integración de Sitio web (Fase 2) siempre regresa
  // `disponible: false` para este campo. El tipo se deja igual que
  // `pagespeed` (mismo mecanismo de la regla 5) en vez de simplificarlo a
  // `boolean | null`, por si en el futuro aparece otra fuente de indexación.
  indexadoGoogle:
    { disponible: false } | { disponible: true; indexado: boolean };
  datosEstructurados: boolean;
  metaPixelInstalado: boolean;
  googleTagInstalado: boolean;
}

export interface GoogleMapsInput {
  perfilReclamado: boolean;
  categoriaPrincipalAsignada: boolean;
  // Clasificación cualitativa (ver nota arriba) — "todos los días" no tiene
  // una regla numérica en el prompt más allá de "completo/parcial/ausente".
  horario: NivelCheck;
  telefonoPresente: boolean;
  sitioWebPresente: boolean;
  fotos: {
    cantidad: number;
    actividadUltimos90Dias: boolean;
  };
  ratingPromedio: number;
  totalResenas: number;
  // Igual mecanismo de exclusión que FacebookInput.madeWithAi (regla 5), pero
  // por una razón distinta: no es que el check "no aplique" conceptualmente,
  // sino que la única fuente de este dato (Outscraper, ver la integración de
  // Google Maps en Fase 2) puede fallar o no responder para un escaneo en
  // particular. `disponible: false` excluye el check de la categoría
  // (numerador y denominador) exactamente igual que un check no aplicable.
  velocidadResenasNuevas:
    | { disponible: false }
    | {
        disponible: true;
        // Promedio de reseñas nuevas por mes, calculado sobre los últimos 6 meses.
        promedioMensualUltimos6Meses: number;
        // Total de reseñas nuevas en los últimos 6 meses — necesario aparte del
        // promedio porque "Aceptable" (al menos 1 en 6 meses) no es equivalente
        // a "promedio >= 1/mes": un negocio con 1 reseña nueva en todo el
        // semestre tiene promedio ~0.17 (no Óptimo) pero sí cumple Aceptable.
        totalUltimos6Meses: number;
      };
  // Ver comentario de velocidadResenasNuevas — mismo mecanismo, misma fuente.
  tasaRespuestaResenas:
    { disponible: false } | { disponible: true; valor: number };
}

export interface InstagramInput {
  cuentaProfesional: boolean;
  bio: {
    categoriaPresente: boolean;
    contactoPresente: boolean;
    linkPresente: boolean;
  };
  postsPorSemana: number;
  // 0-100.
  porcentajeReels: number;
  // Mismo mecanismo de regla 5 que GoogleMapsInput/SitioWebInput — acá la
  // razón es que ningún scraper conocido expone una señal confiable de
  // marca de agua/reposteo (ver la integración de Instagram en Fase 2).
  // Clasificación cualitativa (ver nota arriba) cuando sí está disponible.
  contenidoSinMarcaAgua:
    { disponible: false } | { disponible: true; nivel: NivelCheck };
  // Mismo mecanismo — el actor de Apify usado expone commentsCount pero no
  // el contenido de los comentarios (siempre regresa una lista vacía), así
  // que no hay forma de saber si el negocio respondió sin una llamada
  // adicional costosa (ver la integración de Instagram en Fase 2).
  interaccionComentarios:
    { disponible: false } | { disponible: true; nivel: NivelCheck };
  // Mismo mecanismo — el actor no expone ningún campo de shopping/catálogo.
  catalogoConectado:
    { disponible: false } | { disponible: true; conectado: boolean };
}

export interface FacebookInput {
  pagina: {
    categoriaPresente: boolean;
    infoPresente: boolean;
    ctaPresente: boolean;
  };
  // Mismo mecanismo de regla 5 que las demás integraciones — estos tres
  // dependen de un actor de posts distinto al de la página en sí (ver la
  // integración de Facebook en Fase 2); si ese actor falla o no trae datos
  // para un escaneo en particular, se excluyen sin invalidar el resto de la
  // categoría. Clasificación cualitativa (ver nota arriba) cuando disponible.
  contenidoNativo:
    { disponible: false } | { disponible: true; nivel: NivelCheck };
  presenciaReels:
    { disponible: false } | { disponible: true; nivel: NivelCheck };
  diasDesdeUltimaPublicacion:
    { disponible: false } | { disponible: true; dias: number };
  // Mismo mecanismo — el actor de la página no expone ningún campo de
  // shopping/catálogo (decisión cerrada, no una degradación puntual, ver la
  // integración de Facebook en Fase 2).
  catalogoConectado:
    { disponible: false } | { disponible: true; conectado: boolean };
  // Regla 5: si el negocio nunca publicó contenido generado con AI, el
  // check completo se excluye de la categoría (numerador y denominador),
  // igual que una categoría no aplicable a nivel completo (regla 4). En la
  // práctica también cubre "no se puede detectar si hay contenido con AI"
  // (ningún actor conocido expone esa señal) — ver la integración de
  // Facebook en Fase 2, que declara esta desviación de la semántica
  // original ("nunca publicó" vs. "no se puede saber").
  madeWithAi:
    { aplica: false } | { aplica: true; etiquetadoCorrectamente: boolean };
}

export interface NapInput {
  nombreConsistente: boolean;
  direccionConsistente: boolean;
  telefonoConsistente: boolean;
}

export interface WhatsappInput {
  perfilCompleto: {
    descripcionPresente: boolean;
    horarioPresente: boolean;
  };
  catalogoVisible: boolean;
}

// Una categoría ausente por completo (key undefined) es la regla 4: no
// aplica a este nivel de escaneo (Lite/Pro), no cuenta ni en numerador ni en
// denominador. El módulo no asume qué nivel es el escaneo — solo reacciona
// a qué categorías vienen presentes en este objeto.
export interface DatosEscaneo {
  sitioWeb?: ConCanal<SitioWebInput>;
  googleMaps?: GoogleMapsInput;
  instagram?: ConCanal<InstagramInput>;
  facebook?: ConCanal<FacebookInput>;
  nap?: NapInput;
  whatsapp?: ConCanal<WhatsappInput>;
}

export interface ResultadoDetalleCheck {
  nombre: string;
  puntosMaximos: number;
  puntosObtenidos: number;
  resultado: NivelCheck;
}

export interface ResultadoCategoria {
  categoria: CategoriaId;
  puntosObtenidos: number;
  // Suma de los puntos máximos de los checks realmente evaluados en esta
  // categoría para este escaneo — no siempre es el peso de tabla: cuando
  // "Made with AI" no aplica (regla 5), Facebook pesa 14 en vez de 15 para
  // ese escaneo en particular. En el caso "sin canal" sí es el peso íntegro
  // de tabla (ver categoriaSinCanal en scoring.ts).
  puntosMaximos: number;
  // Cuenta como "cumplido" cualquier check con puntosObtenidos > 0 — es
  // decir, Óptimo o Aceptable, no solo Óptimo. No hay una definición más
  // precisa de "cumplido" en el prompt para checks de 3 niveles, y este
  // criterio (algún punto obtenido) es el que tiene sentido de negocio.
  checksCumplidos: number;
  checksTotal: number;
  // Vacío cuando la categoría es "sin canal" (regla 3) — no hay checks
  // individuales que auditar si el negocio no tiene el canal.
  checks: ResultadoDetalleCheck[];
}

export interface ResultadoEscaneo {
  // Redondeado al entero más cercano (regla 8) — es el único valor
  // redondeado de todo el resultado, y solo para mostrarse.
  scoreGlobal: number;
  puntosObtenidosTotal: number;
  puntosMaximosTotal: number;
  categorias: ResultadoCategoria[];
}
