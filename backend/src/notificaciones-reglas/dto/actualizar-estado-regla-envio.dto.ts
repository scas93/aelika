import { IsIn } from 'class-validator';

/**
 * Body de `PATCH /internal/reglas-envios/:id/estado` (ver
 * RegistraEnvioCallbackController). Solo EXITO/FALLO — nunca EN_CURSO,
 * que es un estado interno que solo asigna ReglaEnvioService al crear el
 * registro, no algo que Botpress deba poder mandar.
 */
export class ActualizarEstadoReglaEnvioDto {
  @IsIn(['EXITO', 'FALLO'])
  estado: 'EXITO' | 'FALLO';
}
