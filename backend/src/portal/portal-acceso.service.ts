import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt } from 'crypto';
import type { Tenant } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizarTelefono } from '../common/telefono';
import { CODIGOS_STORE } from './codigos-store';
import type { CodigosStore } from './codigos-store';
import { EnviarCodigoAccesoService } from './enviar-codigo-acceso.service';
import {
  LIMITES,
  MENSAJE_CODIGO_SOLICITADO,
  SESION_MS,
  codigoVisibleActivo,
  topeDiarioNegocio,
} from './portal-config';

export interface ContextoSolicitud {
  dispositivoId: string;
  ip: string;
  userAgent?: string;
}

export interface ClienteResumen {
  id: string;
  nombre: string;
}

export interface SesionValida {
  tenant: Tenant;
  sesionId: string;
  telefono: string;
  /** Cliente activo, o null si el teléfono (autorizado en varios clientes) todavía no elige. */
  cliente: ClienteResumen | null;
  clientes: ClienteResumen[];
}

const MENSAJE_SERVICIO =
  'No pudimos procesar tu solicitud en este momento, intenta de nuevo más tarde';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function secretoCodigos(): string {
  const s = process.env.PORTAL_OTP_SECRET ?? process.env.JWT_SECRET;
  if (!s) throw new Error('PORTAL_OTP_SECRET/JWT_SECRET no configurado');
  return s;
}

function hmacCodigo(
  tenantId: string,
  telefono: string,
  codigo: string,
): string {
  return createHmac('sha256', secretoCodigos())
    .update(`${tenantId}:${telefono}:${codigo}`)
    .digest('hex');
}

/**
 * Acceso al portal del cliente B2B (Fase 4, 4b): teléfono → código por WhatsApp → sesión.
 * Todo lo de aquí es público (sin JWT del panel); el negocio sale del `slug`.
 */
@Injectable()
export class PortalAccesoService {
  private readonly logger = new Logger(PortalAccesoService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CODIGOS_STORE) private readonly store: CodigosStore,
    private readonly envio: EnviarCodigoAccesoService,
  ) {}

  /** Negocio de mayoreo por slug. Inexistente o no B2B → 404 (el slug ya es público). */
  async resolverTenant(slug: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.tipoStorefront !== 'RETAIL_B2B')
      throw new NotFoundException();
    return tenant;
  }

  private telefonoNormalizado(crudo: string): string {
    const t = normalizarTelefono(crudo);
    if (crudo.replace(/\D/g, '').length < 10 || t.length !== 10) {
      throw new BadRequestException('Escribe tu teléfono a 10 dígitos');
    }
    return t;
  }

  /** Clientes B2B activos del negocio donde el teléfono está autorizado. */
  private async clientesAutorizados(
    tenantId: string,
    telefono: string,
  ): Promise<ClienteResumen[]> {
    return this.prisma.cliente.findMany({
      where: {
        tenantId,
        canal: 'B2B',
        bajaAt: null,
        telefonos: { some: { tenantId, telefono } },
      },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' },
    });
  }

  // ---------------------------------------------------------------- pedir código

  /** Responde SIEMPRE lo mismo (exista o no el cliente). 429 al exceder límites; 503 si Redis no responde. */
  async pedirCodigo(
    slug: string,
    telefonoCrudo: string,
    ctx: ContextoSolicitud,
  ) {
    const tenant = await this.resolverTenant(slug);
    const telefono = this.telefonoNormalizado(telefonoCrudo);
    const respuesta = { ok: true, mensaje: MENSAJE_CODIGO_SOLICITADO };

    // Sin forma de entregar el código (ni "código visible" ni plantilla+webhook), el acceso está inerte: misma
    // respuesta, sin generar código ni consumir límites. Es lo que ocurre en producción hasta que haya plantilla.
    // El idioma es obligatorio: no hay valor por defecto (la plantilla de autenticación es de un idioma concreto).
    const puedeEnviar = Boolean(
      tenant.portalPlantillaNombre &&
      tenant.portalPlantillaIdioma &&
      tenant.botWebhookUrl,
    );
    if (!codigoVisibleActivo() && !puedeEnviar) {
      this.logger.warn(
        `Acceso al portal inerte para ${tenant.slug}: sin plantilla (nombre e idioma)/webhook y sin modo "código visible"`,
      );
      return respuesta;
    }

    // Límites (fallan cerrado). Cuentan igual los teléfonos que no son clientes.
    const dia = new Date().toISOString().slice(0, 10);
    let excedido = false;
    try {
      const cuentas = await Promise.all([
        this.store.incrementar(
          `portal:rl:tel:h:${tenant.id}:${telefono}`,
          3600,
        ),
        this.store.incrementar(
          `portal:rl:tel:d:${tenant.id}:${telefono}`,
          86400,
        ),
        this.store.incrementar(`portal:rl:disp:d:${ctx.dispositivoId}`, 86400),
        this.store.incrementar(`portal:rl:ip:d:${ctx.ip}`, 86400),
        this.store.incrementar(`portal:rl:neg:d:${tenant.id}:${dia}`, 86400),
      ]);
      excedido =
        cuentas[0] > LIMITES.codigosPorTelefonoHora ||
        cuentas[1] > LIMITES.codigosPorTelefonoDia ||
        cuentas[2] > LIMITES.codigosPorDispositivoDia ||
        cuentas[3] > LIMITES.codigosPorIpDia ||
        cuentas[4] > topeDiarioNegocio();
      if (cuentas[4] === topeDiarioNegocio() + 1) {
        this.logger.warn(`Tope diario de códigos alcanzado en ${tenant.slug}`);
      }
    } catch (error) {
      this.logger.error(`Redis no responde al pedir código: ${String(error)}`);
      throw new ServiceUnavailableException(MENSAJE_SERVICIO);
    }
    if (excedido) {
      throw new HttpException(
        'Pediste demasiados códigos. Espera un poco antes de intentar de nuevo o contáctanos',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const autorizados = await this.clientesAutorizados(tenant.id, telefono);
    if (autorizados.length === 0) return respuesta;

    const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0');
    try {
      await this.store.guardarCodigo(
        `portal:otp:${tenant.id}:${telefono}`,
        hmacCodigo(tenant.id, telefono, codigo),
        LIMITES.vigenciaCodigoSegundos,
      );
    } catch (error) {
      this.logger.error(
        `Redis no responde al guardar el código: ${String(error)}`,
      );
      throw new ServiceUnavailableException(MENSAJE_SERVICIO);
    }

    if (codigoVisibleActivo()) {
      // Solo para pruebas en staging; nunca en la respuesta HTTP.
      this.logger.warn(
        `[PORTAL_CODIGO] negocio=${tenant.slug} telefono=***${telefono.slice(-4)} codigo=${codigo}`,
      );
    }

    // El envío no se espera (el tiempo de respuesta no debe delatar si el número era cliente).
    void this.envio
      .enviar({
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        botWebhookUrl: tenant.botWebhookUrl,
        botWebhookSecret: tenant.botWebhookSecret,
        plantillaNombre: tenant.portalPlantillaNombre,
        plantillaIdioma: tenant.portalPlantillaIdioma,
        telefono,
        codigo,
      })
      .then((r) => {
        if (!r.enviado)
          this.logger.warn(
            `Código no enviado por WhatsApp (negocio=${tenant.slug}): ${r.motivo}`,
          );
      })
      .catch((e: unknown) =>
        this.logger.error(`Error al enviar el código: ${String(e)}`),
      );

    return respuesta;
  }

  // ---------------------------------------------------------------- verificar

  /** Valida el código y crea la sesión. Devuelve el token en claro (va solo a la cookie). */
  async verificar(
    slug: string,
    telefonoCrudo: string,
    codigo: string,
    ctx: ContextoSolicitud,
  ) {
    const tenant = await this.resolverTenant(slug);
    const telefono = this.telefonoNormalizado(telefonoCrudo);
    if (!/^\d{6}$/.test(codigo))
      throw new BadRequestException('Escribe el código de 6 dígitos');

    let resultado;
    try {
      resultado = await this.store.verificarCodigo(
        `portal:otp:${tenant.id}:${telefono}`,
        hmacCodigo(tenant.id, telefono, codigo),
        LIMITES.intentosPorCodigo,
      );
    } catch (error) {
      this.logger.error(
        `Redis no responde al verificar el código: ${String(error)}`,
      );
      throw new ServiceUnavailableException(MENSAJE_SERVICIO);
    }
    if (resultado === 'INCORRECTO')
      throw new UnauthorizedException('Código incorrecto');
    if (resultado === 'AGOTADO') {
      throw new UnauthorizedException(
        'Agotaste los intentos de este código. Pide uno nuevo',
      );
    }
    if (resultado === 'NO_EXISTE') {
      throw new UnauthorizedException(
        'El código venció o no existe. Pide uno nuevo',
      );
    }

    const autorizados = await this.clientesAutorizados(tenant.id, telefono);
    if (autorizados.length === 0)
      throw new UnauthorizedException('Código incorrecto o vencido');

    const token = randomBytes(32).toString('hex');
    const ahora = new Date();
    await this.prisma.sesionPortal.create({
      data: {
        tenantId: tenant.id,
        telefono,
        clienteId: autorizados.length === 1 ? autorizados[0].id : null,
        tokenHash: hashToken(token),
        dispositivoId: ctx.dispositivoId,
        userAgent: ctx.userAgent?.slice(0, 300) ?? null,
        creadaAt: ahora,
        ultimoUsoAt: ahora,
        venceAt: new Date(ahora.getTime() + SESION_MS),
      },
    });
    return { token, requiereSeleccion: autorizados.length > 1 };
  }

  // ---------------------------------------------------------------- sesión

  /**
   * Revalida y renueva. null = sin sesión válida (el controlador responde 401 y borra la cookie). Se revalida
   * CONTRA LA BASE en cada petición: negocio, teléfono en ClienteTelefono y cliente existente y no dado de baja.
   * Si el cliente activo dejó de ser válido pero el teléfono sigue autorizado en otro, la sesión sigue y vuelve a
   * la selección (sin pedir otro código); si no queda ninguno, la sesión se elimina.
   */
  async validarSesion(
    slug: string,
    token: string | undefined,
  ): Promise<SesionValida | null> {
    if (!token) return null;
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.tipoStorefront !== 'RETAIL_B2B') return null;

    const sesion = await this.prisma.sesionPortal.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    const ahora = new Date();
    if (!sesion || sesion.tenantId !== tenant.id) return null;
    if (sesion.venceAt <= ahora) {
      await this.prisma.sesionPortal.delete({ where: { id: sesion.id } });
      return null;
    }

    const clientes = await this.clientesAutorizados(tenant.id, sesion.telefono);
    if (clientes.length === 0) {
      await this.prisma.sesionPortal.delete({ where: { id: sesion.id } });
      return null;
    }

    let activo = clientes.find((c) => c.id === sesion.clienteId) ?? null;
    if (!activo && clientes.length === 1) activo = clientes[0];

    await this.prisma.sesionPortal.update({
      where: { id: sesion.id },
      data: {
        ultimoUsoAt: ahora,
        venceAt: new Date(ahora.getTime() + SESION_MS),
        clienteId: activo?.id ?? null,
      },
    });
    return {
      tenant,
      sesionId: sesion.id,
      telefono: sesion.telefono,
      cliente: activo,
      clientes,
    };
  }

  /** Elige (o cambia) el cliente activo entre los autorizados del teléfono. Otro cliente → 404. */
  async elegirCliente(sesion: SesionValida, clienteId: string) {
    const elegido = sesion.clientes.find((c) => c.id === clienteId);
    if (!elegido) throw new NotFoundException();
    await this.prisma.sesionPortal.update({
      where: { id: sesion.sesionId },
      data: { clienteId: elegido.id },
    });
    return elegido;
  }

  async cerrar(token: string | undefined) {
    if (!token) return;
    await this.prisma.sesionPortal.deleteMany({
      where: { tokenHash: hashToken(token) },
    });
  }
}
