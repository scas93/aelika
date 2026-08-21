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
  // rawBody: true preserves the unparsed request body as req.rawBody on
  // every request (needed by POST /webhooks/stripe to verify Stripe's
  // signature) without disabling the global JSON body-parser for the rest
  // of the app — see StripeWebhookController.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
