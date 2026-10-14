import { ConfigService } from '@nestjs/config';
import { buildStorefrontUrl } from './storefront-url';

const cfg = (base?: string) => ({ get: () => base }) as unknown as ConfigService;

describe('buildStorefrontUrl', () => {
  it('B2C conserva {base}/{slug}', () => {
    expect(buildStorefrontUrl(cfg('https://pide.aelika.com/tienda'), 'cafe', 'RETAIL_B2C')).toBe('https://pide.aelika.com/tienda/cafe');
    expect(buildStorefrontUrl(cfg('https://pide.aelika.com/tienda'), 'cafe')).toBe('https://pide.aelika.com/tienda/cafe');
  });

  it('B2B usa solo el origen: {origen}/{slug}, sin /tienda ni /mayoreo', () => {
    for (const base of ['https://pide.aelika.com/tienda', 'https://pide.aelika.com/tienda/', 'https://pide.aelika.com', 'https://pide.aelika.com/mayoreo']) {
      expect(buildStorefrontUrl(cfg(base), 'banetto', 'RETAIL_B2B')).toBe('https://pide.aelika.com/banetto');
    }
  });

  it('B2B con el default local y con un valor sin esquema', () => {
    expect(buildStorefrontUrl(cfg(undefined), 'banetto', 'RETAIL_B2B')).toBe('http://localhost:3000/banetto');
    expect(buildStorefrontUrl(cfg('pide.aelika.com/tienda'), 'banetto', 'RETAIL_B2B')).toBe('pide.aelika.com/banetto');
  });
});
