import { calcularScoreEscaneo } from './scoring';
import {
  CategoriaId,
  DatosEscaneo,
  FacebookInput,
  GoogleMapsInput,
  InstagramInput,
  NapInput,
  NivelCheck,
  SitioWebInput,
  WhatsappInput,
} from './types';

// Insumos "todo Óptimo" para cada categoría — usados para verificar que el
// peso máximo de tabla de cada categoría (y por lo tanto la normalización
// Lite=90 / Pro=100) sale exactamente de sumar los checks, sin casos
// especiales.
const sitioWebOptimo: SitioWebInput = {
  sslActivo: true,
  pagespeed: { disponible: true, valor: 95 },
  indexadoGoogle: { disponible: true, indexado: true },
  datosEstructurados: true,
  metaPixelInstalado: true,
  googleTagInstalado: true,
};

const googleMapsOptimo: GoogleMapsInput = {
  perfilReclamado: true,
  categoriaPrincipalAsignada: true,
  horario: NivelCheck.OPTIMO,
  telefonoPresente: true,
  sitioWebPresente: true,
  fotos: { cantidad: 25, actividadUltimos90Dias: true },
  ratingPromedio: 4.8,
  totalResenas: 150,
  velocidadResenasNuevas: {
    disponible: true,
    promedioMensualUltimos6Meses: 2,
    totalUltimos6Meses: 12,
  },
  tasaRespuestaResenas: { disponible: true, valor: 90 },
};

const instagramOptimo: InstagramInput = {
  cuentaProfesional: true,
  bio: { categoriaPresente: true, contactoPresente: true, linkPresente: true },
  postsPorSemana: 8,
  porcentajeReels: 60,
  contenidoSinMarcaAgua: { disponible: true, nivel: NivelCheck.OPTIMO },
  interaccionComentarios: { disponible: true, nivel: NivelCheck.OPTIMO },
  catalogoConectado: { disponible: true, conectado: true },
};

const facebookOptimo: FacebookInput = {
  pagina: { categoriaPresente: true, infoPresente: true, ctaPresente: true },
  contenidoNativo: NivelCheck.OPTIMO,
  presenciaReels: NivelCheck.OPTIMO,
  diasDesdeUltimaPublicacion: 2,
  catalogoConectado: true,
  madeWithAi: { aplica: true, etiquetadoCorrectamente: true },
};

const napOptimo: NapInput = {
  nombreConsistente: true,
  direccionConsistente: true,
  telefonoConsistente: true,
};

const whatsappOptimo: WhatsappInput = {
  perfilCompleto: { descripcionPresente: true, horarioPresente: true },
  catalogoVisible: true,
};

describe('calcularScoreEscaneo', () => {
  it('checks binarios: cumple da puntos completos, no cumple da 0', () => {
    const resultado = calcularScoreEscaneo({
      sitioWeb: { tieneCanal: true, ...sitioWebOptimo, sslActivo: false },
    });
    const ssl = resultado.categorias[0].checks.find(
      (c) => c.nombre === 'SSL/HTTPS activo',
    )!;
    expect(ssl.resultado).toBe(NivelCheck.NECESITA_ATENCION);
    expect(ssl.puntosObtenidos).toBe(0);

    const indexado = resultado.categorias[0].checks.find(
      (c) => c.nombre === 'Sitio indexado en Google',
    )!;
    expect(indexado.resultado).toBe(NivelCheck.OPTIMO);
    expect(indexado.puntosObtenidos).toBe(3);
  });

  it('check de 3 niveles: Óptimo, Aceptable y Necesita atención (velocidad PageSpeed, peso 5)', () => {
    const optimo = calcularScoreEscaneo({
      sitioWeb: {
        tieneCanal: true,
        ...sitioWebOptimo,
        pagespeed: { disponible: true, valor: 95 },
      },
    });
    const aceptable = calcularScoreEscaneo({
      sitioWeb: {
        tieneCanal: true,
        ...sitioWebOptimo,
        pagespeed: { disponible: true, valor: 70 },
      },
    });
    const necesitaAtencion = calcularScoreEscaneo({
      sitioWeb: {
        tieneCanal: true,
        ...sitioWebOptimo,
        pagespeed: { disponible: true, valor: 30 },
      },
    });

    const checkDe = (resultado: ReturnType<typeof calcularScoreEscaneo>) =>
      resultado.categorias[0].checks.find(
        (c) => c.nombre === 'Velocidad (PageSpeed)',
      )!;

    expect(checkDe(optimo).resultado).toBe(NivelCheck.OPTIMO);
    expect(checkDe(optimo).puntosObtenidos).toBe(5);

    expect(checkDe(aceptable).resultado).toBe(NivelCheck.ACEPTABLE);
    expect(checkDe(aceptable).puntosObtenidos).toBe(2.5);

    expect(checkDe(necesitaAtencion).resultado).toBe(
      NivelCheck.NECESITA_ATENCION,
    );
    expect(checkDe(necesitaAtencion).puntosObtenidos).toBe(0);
  });

  it('regla 9: "Fotos" toma el nivel más bajo entre cantidad y recencia', () => {
    const muchasFotosSinActividad = calcularScoreEscaneo({
      googleMaps: {
        ...googleMapsOptimo,
        fotos: { cantidad: 25, actividadUltimos90Dias: false },
      },
    });
    const pocasFotosConActividad = calcularScoreEscaneo({
      googleMaps: {
        ...googleMapsOptimo,
        fotos: { cantidad: 3, actividadUltimos90Dias: true },
      },
    });
    const ambasAltas = calcularScoreEscaneo({
      googleMaps: {
        ...googleMapsOptimo,
        fotos: { cantidad: 25, actividadUltimos90Dias: true },
      },
    });

    const checkDe = (resultado: ReturnType<typeof calcularScoreEscaneo>) =>
      resultado.categorias[0].checks.find(
        (c) => c.nombre === 'Fotos: cantidad y recencia',
      )!;

    expect(checkDe(muchasFotosSinActividad).resultado).toBe(
      NivelCheck.NECESITA_ATENCION,
    );
    expect(checkDe(pocasFotosConActividad).resultado).toBe(
      NivelCheck.NECESITA_ATENCION,
    );
    expect(checkDe(ambasAltas).resultado).toBe(NivelCheck.OPTIMO);
  });

  it('regla 3: categoría sin canal califica 0 pero cuenta en el denominador, sin detalle de checks', () => {
    const resultado = calcularScoreEscaneo({
      sitioWeb: { tieneCanal: false },
      googleMaps: googleMapsOptimo,
    });

    const sitio = resultado.categorias.find(
      (c) => c.categoria === CategoriaId.SITIO_WEB,
    )!;
    expect(sitio.puntosObtenidos).toBe(0);
    expect(sitio.puntosMaximos).toBe(20);
    expect(sitio.checks).toEqual([]);
    expect(sitio.checksTotal).toBe(0);

    // Sí cuenta en el denominador global (20 de sitio web + 25 de maps).
    expect(resultado.puntosMaximosTotal).toBe(45);
    expect(resultado.puntosObtenidosTotal).toBe(25);
  });

  it('regla 4: una categoría no enviada no cuenta ni en numerador ni en denominador', () => {
    // Escaneo Lite: WhatsApp Business ni siquiera se manda.
    const resultado = calcularScoreEscaneo({
      sitioWeb: { tieneCanal: true, ...sitioWebOptimo },
    });

    expect(
      resultado.categorias.find((c) => c.categoria === CategoriaId.WHATSAPP),
    ).toBeUndefined();
    expect(resultado.puntosMaximosTotal).toBe(20);
  });

  it('regla 5: "Made with AI" se excluye de Facebook cuando no aplica (categoría pesa 14, no 15)', () => {
    const noAplica = calcularScoreEscaneo({
      facebook: {
        tieneCanal: true,
        ...facebookOptimo,
        madeWithAi: { aplica: false },
      },
    });
    const facebookNoAplica = noAplica.categorias[0];
    expect(facebookNoAplica.puntosMaximos).toBe(14);
    expect(facebookNoAplica.checksTotal).toBe(5);
    expect(
      facebookNoAplica.checks.find((c) => c.nombre.includes('Made with AI')),
    ).toBeUndefined();
    // Todo lo demás Óptimo -> puntos obtenidos = puntos máximos (14/14).
    expect(facebookNoAplica.puntosObtenidos).toBe(14);

    const siAplica = calcularScoreEscaneo({
      facebook: {
        tieneCanal: true,
        ...facebookOptimo,
        madeWithAi: { aplica: true, etiquetadoCorrectamente: false },
      },
    });
    const facebookSiAplica = siAplica.categorias[0];
    expect(facebookSiAplica.puntosMaximos).toBe(15);
    expect(facebookSiAplica.checksTotal).toBe(6);
    // Etiquetado incorrecto -> ese check da 0, pero sí cuenta en el máximo.
    expect(facebookSiAplica.puntosObtenidos).toBe(14);
  });

  it('regla 5: "Velocidad de reseñas nuevas" y "Tasa de respuesta" se excluyen de Google Maps cuando la fuente no estuvo disponible', () => {
    const sinDatosDeResenas = calcularScoreEscaneo({
      googleMaps: {
        ...googleMapsOptimo,
        velocidadResenasNuevas: { disponible: false },
        tasaRespuestaResenas: { disponible: false },
      },
    });
    const maps = sinDatosDeResenas.categorias[0];
    // 25 (peso de tabla) - 3 (velocidad) - 2 (tasa de respuesta) = 20.
    expect(maps.puntosMaximos).toBe(20);
    expect(maps.checksTotal).toBe(7);
    expect(
      maps.checks.find((c) => c.nombre === 'Velocidad de reseñas nuevas'),
    ).toBeUndefined();
    expect(
      maps.checks.find((c) => c.nombre === 'Tasa de respuesta a reseñas'),
    ).toBeUndefined();
    // Todo lo demás Óptimo -> puntos obtenidos = puntos máximos (20/20).
    expect(maps.puntosObtenidos).toBe(20);
  });

  it('regla 5: "Velocidad (PageSpeed)" y "Sitio indexado en Google" se excluyen de Sitio web cuando la fuente no estuvo disponible', () => {
    const sinDatosExternos = calcularScoreEscaneo({
      sitioWeb: {
        tieneCanal: true,
        ...sitioWebOptimo,
        pagespeed: { disponible: false },
        indexadoGoogle: { disponible: false },
      },
    });
    const sitio = sinDatosExternos.categorias[0];
    // 20 (peso de tabla) - 5 (velocidad) - 3 (indexación) = 12.
    expect(sitio.puntosMaximos).toBe(12);
    expect(sitio.checksTotal).toBe(4);
    expect(
      sitio.checks.find((c) => c.nombre === 'Velocidad (PageSpeed)'),
    ).toBeUndefined();
    expect(
      sitio.checks.find((c) => c.nombre === 'Sitio indexado en Google'),
    ).toBeUndefined();
    // Todo lo demás Óptimo -> puntos obtenidos = puntos máximos (12/12).
    expect(sitio.puntosObtenidos).toBe(12);
  });

  it('regla 5: "Contenido sin marca de agua", "Interacción" y "Catálogo" se excluyen de Instagram cuando la fuente no estuvo disponible', () => {
    const sinDatosDeApify = calcularScoreEscaneo({
      instagram: {
        tieneCanal: true,
        ...instagramOptimo,
        contenidoSinMarcaAgua: { disponible: false },
        interaccionComentarios: { disponible: false },
        catalogoConectado: { disponible: false },
      },
    });
    const ig = sinDatosDeApify.categorias[0];
    // 20 (peso de tabla) - 2 (marca de agua) - 3 (interacción) - 2 (catálogo) = 13.
    expect(ig.puntosMaximos).toBe(13);
    expect(ig.checksTotal).toBe(4);
    expect(
      ig.checks.find(
        (c) => c.nombre === 'Contenido sin marca de agua/reposteo',
      ),
    ).toBeUndefined();
    expect(
      ig.checks.find(
        (c) => c.nombre === 'Interacción con comentarios (públicos)',
      ),
    ).toBeUndefined();
    expect(
      ig.checks.find((c) => c.nombre === 'Catálogo conectado'),
    ).toBeUndefined();
    // Todo lo demás Óptimo -> puntos obtenidos = puntos máximos (13/13).
    expect(ig.puntosObtenidos).toBe(13);
  });

  it('normalización: escaneo Lite (5 categorías, 90 pts posibles) con todo Óptimo da score 100', () => {
    const datos: DatosEscaneo = {
      sitioWeb: { tieneCanal: true, ...sitioWebOptimo },
      googleMaps: googleMapsOptimo,
      instagram: { tieneCanal: true, ...instagramOptimo },
      facebook: { tieneCanal: true, ...facebookOptimo },
      nap: napOptimo,
    };
    const resultado = calcularScoreEscaneo(datos);

    expect(resultado.puntosMaximosTotal).toBe(90);
    expect(resultado.puntosObtenidosTotal).toBe(90);
    expect(resultado.scoreGlobal).toBe(100);
  });

  it('normalización: escaneo Pro (6 categorías, 100 pts posibles) con todo Óptimo da score 100', () => {
    const datos: DatosEscaneo = {
      sitioWeb: { tieneCanal: true, ...sitioWebOptimo },
      googleMaps: googleMapsOptimo,
      instagram: { tieneCanal: true, ...instagramOptimo },
      facebook: { tieneCanal: true, ...facebookOptimo },
      nap: napOptimo,
      whatsapp: { tieneCanal: true, ...whatsappOptimo },
    };
    const resultado = calcularScoreEscaneo(datos);

    expect(resultado.puntosMaximosTotal).toBe(100);
    expect(resultado.puntosObtenidosTotal).toBe(100);
    expect(resultado.scoreGlobal).toBe(100);
  });

  it('normalización con puntaje mixto: calcula el score global exacto sobre categorías parciales', () => {
    const datos: DatosEscaneo = {
      sitioWeb: {
        tieneCanal: true,
        sslActivo: false, // 0/2
        pagespeed: { disponible: true, valor: 70 }, // Aceptable: 2.5/5
        indexadoGoogle: { disponible: true, indexado: true }, // 3/3
        datosEstructurados: false, // 0/3
        metaPixelInstalado: true, // 4/4
        googleTagInstalado: true, // 3/3
      },
      googleMaps: {
        perfilReclamado: true, // 3/3
        categoriaPrincipalAsignada: false, // 0/5
        horario: NivelCheck.ACEPTABLE, // 1/2
        telefonoPresente: true,
        sitioWebPresente: false, // Aceptable: 1/2
        fotos: { cantidad: 10, actividadUltimos90Dias: false }, // min(Aceptable, Necesita atención): 0/3
        ratingPromedio: 4.2, // Aceptable: 1/2
        totalResenas: 50, // Aceptable: 1.5/3
        velocidadResenasNuevas: {
          disponible: true,
          promedioMensualUltimos6Meses: 0.5,
          totalUltimos6Meses: 2,
        }, // Aceptable: 1.5/3
        tasaRespuestaResenas: { disponible: true, valor: 50 }, // Aceptable: 1/2
      },
    };

    const resultado = calcularScoreEscaneo(datos);

    const sitio = resultado.categorias.find(
      (c) => c.categoria === CategoriaId.SITIO_WEB,
    )!;
    expect(sitio.puntosObtenidos).toBe(12.5);
    expect(sitio.puntosMaximos).toBe(20);
    expect(sitio.checksCumplidos).toBe(4); // pagespeed, indexado, pixel, tag (ssl y datos estructurados en 0)

    const maps = resultado.categorias.find(
      (c) => c.categoria === CategoriaId.GOOGLE_MAPS,
    )!;
    expect(maps.puntosObtenidos).toBe(10);
    expect(maps.puntosMaximos).toBe(25);

    expect(resultado.puntosObtenidosTotal).toBe(22.5);
    expect(resultado.puntosMaximosTotal).toBe(45);
    expect(resultado.scoreGlobal).toBe(50);
  });
});
