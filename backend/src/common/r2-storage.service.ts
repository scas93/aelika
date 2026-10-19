import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Subida de archivos a Cloudflare R2 (API compatible con S3). Configuración por variables de entorno:
 * R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET y R2_PUBLIC_BASE_URL (dominio público del bucket,
 * sin diagonal final). Sin ellas, subir responde 503 en vez de tronar con un 500.
 */
@Injectable()
export class R2StorageService {
  private client?: S3Client;

  private config() {
    const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE_URL } = process.env;
    if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_BASE_URL) {
      throw new ServiceUnavailableException('La subida de imágenes no está configurada');
    }
    return {
      accountId: R2_ACCOUNT_ID,
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
      bucket: R2_BUCKET,
      publicBaseUrl: R2_PUBLIC_BASE_URL.replace(/\/+$/, ''),
    };
  }

  /** Sube el archivo y regresa su URL pública. */
  async upload(key: string, body: Buffer, contentType: string): Promise<string> {
    const cfg = this.config();
    this.client ??= new S3Client({
      region: 'auto',
      endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: cfg.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
    } catch {
      throw new ServiceUnavailableException('No se pudo subir la imagen, intenta de nuevo');
    }
    return `${cfg.publicBaseUrl}/${key}`;
  }
}
