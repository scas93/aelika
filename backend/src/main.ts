import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

const DEFAULT_DEV_ORIGINS = ['http://localhost:3000', 'http://pide.localhost:3000'];

function corsOrigins(): string[] {
  const raw = process.env.CORS_ORIGINS;
  if (!raw) return DEFAULT_DEV_ORIGINS;
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
