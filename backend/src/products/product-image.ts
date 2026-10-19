import { BadRequestException } from '@nestjs/common';

export const MAX_IMAGEN_BYTES = 5 * 1024 * 1024;

/** Detecta el tipo real por los primeros bytes (no confía en el nombre ni en el Content-Type del cliente). */
export function detectarImagen(buf: Buffer): { ext: string; mime: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

export function validarImagen(file: Express.Multer.File | undefined): { ext: string; mime: string } {
  if (!file) throw new BadRequestException('Selecciona una imagen');
  const tipo = detectarImagen(file.buffer);
  if (!tipo) throw new BadRequestException('Formato no válido: usa JPG, PNG o WebP');
  return tipo;
}
