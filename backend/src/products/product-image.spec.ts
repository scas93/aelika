import { BadRequestException } from '@nestjs/common';
import { detectarImagen, validarImagen } from './product-image';

const archivo = (buffer: Buffer) => ({ buffer }) as Express.Multer.File;

describe('product-image', () => {
  it('detecta JPG, PNG y WebP por sus bytes', () => {
    expect(detectarImagen(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.mime).toBe('image/jpeg');
    expect(detectarImagen(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.mime).toBe('image/png');
    expect(detectarImagen(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))?.mime).toBe('image/webp');
  });

  it('rechaza lo que no es imagen aunque se llame .jpg', () => {
    expect(() => validarImagen(archivo(Buffer.from('<svg onload=alert(1)>')))).toThrow(BadRequestException);
    expect(() => validarImagen(undefined)).toThrow(BadRequestException);
  });
});
