import { resolveTestDatabaseUrl } from './db-guard';

// Corre en cada worker ANTES de cargar la app. ConfigModule (dotenv) no pisa
// variables ya definidas, así que fijar todo aquí evita que valores de
// desarrollo de backend/.env (Stripe, Telegram, Resend, Redis...) se cuelen.
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'char-test-jwt-secret';
process.env.JWT_EXPIRES_IN = '7d';
process.env.STOREFRONT_BASE_URL = 'https://pide.test/tienda';
process.env.API_BASE_URL = 'https://api.test';
process.env.STRIPE_SECRET_KEY = 'sk_test_characterization';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_char_v1';
process.env.STRIPE_WEBHOOK_SECRET_V2 = 'whsec_char_v2';
// Nunca se conecta: la cola BullMQ se sustituye en el harness.
process.env.REDIS_URL = 'redis://127.0.0.1:1';
for (const key of [
  'TELEGRAM_BOT_TOKEN',
  'TELEGRAM_BOT_USERNAME',
  'TELEGRAM_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'RESEND_FROM_ADDRESS',
  'GOOGLE_PLACES_API_KEY',
  'OUTSCRAPER_API_KEY',
  'APIFY_TOKEN',
  'WALLETWALLET_API_KEY',
  'R2_LOYALTY_BASE_URL',
  'CORS_ORIGINS',
]) {
  process.env[key] = '';
}
