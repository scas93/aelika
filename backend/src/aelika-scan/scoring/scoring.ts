import {
  CategoriaId,
  DatosEscaneo,
  FacebookInput,
  GoogleMapsInput,
  InstagramInput,
  NapInput,
  NivelCheck,
  ResultadoCategoria,
  ResultadoDetalleCheck,
  ResultadoEscaneo,
  SitioWebInput,
  WhatsappInput,
} from './types';

// Peso de tabla de cada categoría — usado únicamente como el máximo íntegro
// de una categoría "sin canal" (regla 3). Cuando el canal sí existe, el
// máximo real de la categoría se calcula sumando los checks efectivamente
// evaluados (ver construirCategoria) para que la regla 5 (checks
// condicionales excluidos) no necesite un caso especial en el total global.
const PESOS_TABLA: Record<CategoriaId, number> = {
  [CategoriaId.SITIO_WEB]: 20,
  [CategoriaId.GOOGLE_MAPS]: 25,
  [CategoriaId.INSTAGRAM]: 20,
  [CategoriaId.FACEBOOK]: 15,
  [CategoriaId.NAP]: 10,
  [CategoriaId.WHATSAPP]: 10,
};

const ORDEN_NIVEL: Record<NivelCheck, number> = {
  [NivelCheck.NECESITA_ATENCION]: 0,
  [NivelCheck.ACEPTABLE]: 1,
  [NivelCheck.OPTIMO]: 2,
};

function nivelMasBajo(a: NivelCheck, b: NivelCheck): NivelCheck {
  return ORDEN_NIVEL[a] <= ORDEN_NIVEL[b] ? a : b;
}

// Umbral donde "mayor es mejor" (rating, velocidad, % reels, volumen de
// reseñas, etc.) — Óptimo si valor >= umbralOptimo, Aceptable si
// valor >= umbralAceptable, si no Necesita atención.
function nivelPorUmbralAscendente(
  valor: number,
  umbralOptimo: number,
  umbralAceptable: number,
): NivelCheck {
  if (valor >= umbralOptimo) return NivelCheck.OPTIMO;
  if (valor >= umbralAceptable) return NivelCheck.ACEPTABLE;
  return NivelCheck.NECESITA_ATENCION;
}

// Umbral donde "menor es mejor" (días desde la última publicación) — Óptimo
// si valor <= umbralOptimo, Aceptable si valor <= umbralAceptable, si no
// Necesita atención.
function nivelPorUmbralDescendente(
  valor: number,
  umbralOptimo: number,
  umbralAceptable: number,
): NivelCheck {
  if (valor <= umbralOptimo) return NivelCheck.OPTIMO;
  if (valor <= umbralAceptable) return NivelCheck.ACEPTABLE;
  return NivelCheck.NECESITA_ATENCION;
}

// Para checks que combinan N señales booleanas ("los 3 presentes / 1-2 /
// ninguno", "ambos / uno / ninguno"): todas presentes = Óptimo, ninguna =
// Necesita atención, cualquier cantidad intermedia = Aceptable.
function nivelPorConteo(presentes: number, total: number): NivelCheck {
  if (presentes === total) return NivelCheck.OPTIMO;
  if (presentes === 0) return NivelCheck.NECESITA_ATENCION;
  return NivelCheck.ACEPTABLE;
}

// Regla 2: Óptimo = puntos completos, Aceptable = mitad (sin redondear —
// regla 8), Necesita atención = 0.
function puntosPorNivel(nivel: NivelCheck, puntosMaximos: number): number {
  switch (nivel) {
    case NivelCheck.OPTIMO:
      return puntosMaximos;
    case NivelCheck.ACEPTABLE:
      return puntosMaximos / 2;
    case NivelCheck.NECESITA_ATENCION:
      return 0;
  }
}

function checkBinario(
  nombre: string,
  puntosMaximos: number,
  cumple: boolean,
): ResultadoDetalleCheck {
  return checkNivel(
    nombre,
    puntosMaximos,
    cumple ? NivelCheck.OPTIMO : NivelCheck.NECESITA_ATENCION,
  );
}

function checkNivel(
  nombre: string,
  puntosMaximos: number,
  resultado: NivelCheck,
): ResultadoDetalleCheck {
  return {
    nombre,
    puntosMaximos,
    puntosObtenidos: puntosPorNivel(resultado, puntosMaximos),
    resultado,
  };
}

function construirCategoria(
  categoria: CategoriaId,
  checks: ResultadoDetalleCheck[],
): ResultadoCategoria {
  const puntosMaximos = checks.reduce((suma, c) => suma + c.puntosMaximos, 0);
  const puntosObtenidos = checks.reduce(
    (suma, c) => suma + c.puntosObtenidos,
    0,
  );
  const checksCumplidos = checks.filter((c) => c.puntosObtenidos > 0).length;
  return {
    categoria,
    puntosObtenidos,
    puntosMaximos,
    checksCumplidos,
    checksTotal: checks.length,
    checks,
  };
}

// Regla 3: el negocio no tiene este canal — la categoría califica 0 sobre
// su peso íntegro de tabla, sin detalle de checks (no hay nada que auditar).
function categoriaSinCanal(categoria: CategoriaId): ResultadoCategoria {
  return {
    categoria,
    puntosObtenidos: 0,
    puntosMaximos: PESOS_TABLA[categoria],
    checksCumplidos: 0,
    checksTotal: 0,
    checks: [],
  };
}

function evaluarSitioWeb(input: SitioWebInput): ResultadoDetalleCheck[] {
  const checks: ResultadoDetalleCheck[] = [
    checkBinario('SSL/HTTPS activo', 2, input.sslActivo),
  ];

  // Regla 5: PageSpeed Insights no respondió para este escaneo — se omite
  // en vez de penalizar con 0.
  if (input.pagespeed.disponible) {
    checks.push(
      checkNivel(
        'Velocidad (PageSpeed)',
        5,
        nivelPorUmbralAscendente(input.pagespeed.valor, 90, 50),
      ),
    );
  }

  // Regla 5: Custom Search no está configurada o falló para este escaneo.
  if (input.indexadoGoogle.disponible) {
    checks.push(
      checkBinario(
        'Sitio indexado en Google',
        3,
        input.indexadoGoogle.indexado,
      ),
    );
  }

  checks.push(
    checkBinario(
      'Datos estructurados schema.org LocalBusiness',
      3,
      input.datosEstructurados,
    ),
    checkBinario('Meta Pixel instalado', 4, input.metaPixelInstalado),
    checkBinario(
      'Google Tag / Analytics instalado',
      3,
      input.googleTagInstalado,
    ),
  );

  return checks;
}

function evaluarGoogleMaps(input: GoogleMapsInput): ResultadoDetalleCheck[] {
  // Regla 9: dos señales evaluadas por separado, se toma la más baja
  // (conservador) — no es una sola escala combinada.
  const nivelCantidad = nivelPorUmbralAscendente(input.fotos.cantidad, 20, 5);
  const nivelRecencia = input.fotos.actividadUltimos90Dias
    ? NivelCheck.OPTIMO
    : NivelCheck.NECESITA_ATENCION;
  const nivelFotos = nivelMasBajo(nivelCantidad, nivelRecencia);

  const checks: ResultadoDetalleCheck[] = [
    checkBinario('Perfil reclamado/verificado', 3, input.perfilReclamado),
    checkBinario(
      'Categoría principal asignada',
      5,
      input.categoriaPrincipalAsignada,
    ),
    checkNivel('Horario completo', 2, input.horario),
    checkNivel(
      'Teléfono y sitio web presentes en la ficha',
      2,
      nivelPorConteo(
        Number(input.telefonoPresente) + Number(input.sitioWebPresente),
        2,
      ),
    ),
    checkNivel('Fotos: cantidad y recencia', 3, nivelFotos),
    checkNivel(
      'Rating',
      2,
      nivelPorUmbralAscendente(input.ratingPromedio, 4.5, 4.0),
    ),
    checkNivel(
      'Volumen de reseñas',
      3,
      nivelPorUmbralAscendente(input.totalResenas, 100, 20),
    ),
  ];

  // Regla 5: si la fuente de reseñas no estuvo disponible para este escaneo
  // (ver comentario en el tipo), el check se omite por completo en vez de
  // penalizar con 0 — igual que "Made with AI" en Facebook.
  if (input.velocidadResenasNuevas.disponible) {
    const { promedioMensualUltimos6Meses, totalUltimos6Meses } =
      input.velocidadResenasNuevas;
    checks.push(
      checkNivel(
        'Velocidad de reseñas nuevas',
        3,
        // Aceptable no es "promedio >= algo" sino "al menos 1 reseña nueva en
        // los 6 meses" — ver comentario en el tipo.
        promedioMensualUltimos6Meses >= 1
          ? NivelCheck.OPTIMO
          : totalUltimos6Meses >= 1
            ? NivelCheck.ACEPTABLE
            : NivelCheck.NECESITA_ATENCION,
      ),
    );
  }

  if (input.tasaRespuestaResenas.disponible) {
    checks.push(
      checkNivel(
        'Tasa de respuesta a reseñas',
        2,
        nivelPorUmbralAscendente(input.tasaRespuestaResenas.valor, 80, 40),
      ),
    );
  }

  return checks;
}

function evaluarInstagram(input: InstagramInput): ResultadoDetalleCheck[] {
  const bioPresentes =
    Number(input.bio.categoriaPresente) +
    Number(input.bio.contactoPresente) +
    Number(input.bio.linkPresente);

  const checks: ResultadoDetalleCheck[] = [
    checkBinario(
      'Cuenta profesional (Business/Creator)',
      3,
      input.cuentaProfesional,
    ),
    checkNivel(
      'Bio completa (categoría + contacto + link)',
      2,
      nivelPorConteo(bioPresentes, 3),
    ),
    checkNivel(
      'Frecuencia de publicación',
      5,
      nivelPorUmbralAscendente(input.postsPorSemana, 6, 1),
    ),
    checkNivel(
      '% Reels sobre posts recientes',
      3,
      nivelPorUmbralAscendente(input.porcentajeReels, 50, 20),
    ),
  ];

  // Regla 5: ningún scraper conocido expone una señal confiable de marca de
  // agua/reposteo.
  if (input.contenidoSinMarcaAgua.disponible) {
    checks.push(
      checkNivel(
        'Contenido sin marca de agua/reposteo',
        2,
        input.contenidoSinMarcaAgua.nivel,
      ),
    );
  }

  // Regla 5: el actor de Apify no expone contenido de comentarios (solo el
  // conteo), así que no se puede saber si el negocio respondió sin una
  // llamada adicional costosa.
  if (input.interaccionComentarios.disponible) {
    checks.push(
      checkNivel(
        'Interacción con comentarios (públicos)',
        3,
        input.interaccionComentarios.nivel,
      ),
    );
  }

  // Regla 5: el actor no expone ningún campo de shopping/catálogo.
  if (input.catalogoConectado.disponible) {
    checks.push(
      checkBinario('Catálogo conectado', 2, input.catalogoConectado.conectado),
    );
  }

  return checks;
}

function evaluarFacebook(input: FacebookInput): ResultadoDetalleCheck[] {
  const paginaPresentes =
    Number(input.pagina.categoriaPresente) +
    Number(input.pagina.infoPresente) +
    Number(input.pagina.ctaPresente);

  const checks: ResultadoDetalleCheck[] = [
    checkNivel(
      'Página completa (categoría + info + botón CTA)',
      3,
      nivelPorConteo(paginaPresentes, 3),
    ),
  ];

  // Regla 5: estos tres dependen del actor de posts (distinto al de la
  // página) — si no trajo datos para este escaneo, se excluyen sin afectar
  // el resto de la categoría.
  if (input.contenidoNativo.disponible) {
    checks.push(
      checkNivel(
        'Contenido nativo (no solo enlaces externos)',
        3,
        input.contenidoNativo.nivel,
      ),
    );
  }
  if (input.presenciaReels.disponible) {
    checks.push(
      checkNivel('Presencia de Reels/video', 3, input.presenciaReels.nivel),
    );
  }
  if (input.diasDesdeUltimaPublicacion.disponible) {
    checks.push(
      checkNivel(
        'Recencia de publicaciones',
        3,
        nivelPorUmbralDescendente(input.diasDesdeUltimaPublicacion.dias, 7, 30),
      ),
    );
  }

  // Regla 5: el actor de la página no expone ningún campo de catálogo.
  if (input.catalogoConectado.disponible) {
    checks.push(
      checkBinario('Catálogo conectado', 2, input.catalogoConectado.conectado),
    );
  }

  // Regla 5: si el negocio nunca publicó contenido con AI, el check se
  // omite por completo — no se agrega a la lista, así que ni sus puntos
  // máximos ni obtenidos entran a construirCategoria. La categoría pesa 14
  // en vez de 15 para este escaneo en particular.
  if (input.madeWithAi.aplica) {
    checks.push(
      checkBinario(
        'Etiquetado "Made with AI" correcto',
        1,
        input.madeWithAi.etiquetadoCorrectamente,
      ),
    );
  }

  return checks;
}

function evaluarNap(input: NapInput): ResultadoDetalleCheck[] {
  const checks: ResultadoDetalleCheck[] = [];

  // Regla 5: cada campo necesita al menos 2 valores no-nulos entre las
  // fuentes evaluadas para poder comparar — con menos, no hay nada que
  // comparar (ni consistente ni inconsistente).
  if (input.nombreConsistente.disponible) {
    checks.push(
      checkBinario(
        'Nombre exacto igual entre las 4 fuentes',
        3,
        input.nombreConsistente.consistente,
      ),
    );
  }
  if (input.direccionConsistente.disponible) {
    checks.push(
      checkBinario(
        'Dirección exacta igual',
        3,
        input.direccionConsistente.consistente,
      ),
    );
  }
  if (input.telefonoConsistente.disponible) {
    checks.push(
      checkBinario(
        'Teléfono exacto igual',
        4,
        input.telefonoConsistente.consistente,
      ),
    );
  }

  return checks;
}

function evaluarWhatsapp(input: WhatsappInput): ResultadoDetalleCheck[] {
  const perfilPresentes =
    Number(input.perfilCompleto.descripcionPresente) +
    Number(input.perfilCompleto.horarioPresente);

  return [
    checkNivel(
      'Perfil completo (descripción + horario)',
      5,
      nivelPorConteo(perfilPresentes, 2),
    ),
    checkBinario('Catálogo visible', 5, input.catalogoVisible),
  ];
}

/**
 * Calcula la calificación de un escaneo de Aelika Scan a partir de los datos
 * ya obtenidos de cada categoría aplicable. No asume Lite/Pro: una categoría
 * ausente en `datos` (regla 4) simplemente no se evalúa, ni en numerador ni
 * en denominador. Ver types.ts para el contrato completo de entrada/salida
 * y las decisiones de diseño detrás de cada campo.
 */
export function calcularScoreEscaneo(datos: DatosEscaneo): ResultadoEscaneo {
  const categorias: ResultadoCategoria[] = [];

  if (datos.sitioWeb) {
    categorias.push(
      datos.sitioWeb.tieneCanal
        ? construirCategoria(
            CategoriaId.SITIO_WEB,
            evaluarSitioWeb(datos.sitioWeb),
          )
        : categoriaSinCanal(CategoriaId.SITIO_WEB),
    );
  }

  if (datos.googleMaps) {
    categorias.push(
      construirCategoria(
        CategoriaId.GOOGLE_MAPS,
        evaluarGoogleMaps(datos.googleMaps),
      ),
    );
  }

  if (datos.instagram) {
    categorias.push(
      datos.instagram.tieneCanal
        ? construirCategoria(
            CategoriaId.INSTAGRAM,
            evaluarInstagram(datos.instagram),
          )
        : categoriaSinCanal(CategoriaId.INSTAGRAM),
    );
  }

  if (datos.facebook) {
    categorias.push(
      datos.facebook.tieneCanal
        ? construirCategoria(
            CategoriaId.FACEBOOK,
            evaluarFacebook(datos.facebook),
          )
        : categoriaSinCanal(CategoriaId.FACEBOOK),
    );
  }

  if (datos.nap) {
    categorias.push(construirCategoria(CategoriaId.NAP, evaluarNap(datos.nap)));
  }

  if (datos.whatsapp) {
    categorias.push(
      datos.whatsapp.tieneCanal
        ? construirCategoria(
            CategoriaId.WHATSAPP,
            evaluarWhatsapp(datos.whatsapp),
          )
        : categoriaSinCanal(CategoriaId.WHATSAPP),
    );
  }

  const puntosObtenidosTotal = categorias.reduce(
    (suma, c) => suma + c.puntosObtenidos,
    0,
  );
  const puntosMaximosTotal = categorias.reduce(
    (suma, c) => suma + c.puntosMaximos,
    0,
  );
  // Sin categorías evaluadas (DatosEscaneo vacío) no hay score que calcular
  // — 0 en vez de NaN por división entre cero, caso no cubierto por el
  // prompt pero que de otro modo rompería el resultado.
  const scoreGlobal =
    puntosMaximosTotal === 0
      ? 0
      : Math.round((puntosObtenidosTotal / puntosMaximosTotal) * 100);

  return { scoreGlobal, puntosObtenidosTotal, puntosMaximosTotal, categorias };
}
