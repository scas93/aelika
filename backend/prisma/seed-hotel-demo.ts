// Seed de PRUEBA LOCAL de un hotel (tipoStorefront HOTEL) para probar el panel y POST /internal/reservas/amenitiz.
// Idempotente. Uso: npx tsx prisma/seed-hotel-demo.ts
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { horarioSemanaVacio } from '../src/common/horario';

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const SLUG = 'hotel-demo';
const BOT_API_KEY = 'hotel-demo-api-key-local';
const EMAIL = 'dueno@hotel-demo.com';
const PASSWORD = 'hotel1234';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { slug: SLUG },
    update: { tipoStorefront: 'HOTEL', botApiKey: BOT_API_KEY },
    create: {
      slug: SLUG,
      nombre: 'Hotel Demo (prueba local)',
      tipoStorefront: 'HOTEL',
      giroNegocio: 'HOTEL',
      botApiKey: BOT_API_KEY,
      horarioAtencion: horarioSemanaVacio() as any,
    },
  });
  await prisma.user.upsert({
    where: { email: EMAIL },
    update: {},
    create: { tenantId: tenant.id, nombre: 'Dueño Hotel Demo', email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 10), rol: 'DUENO' },
  });
  console.log(`Tenant ${tenant.slug} listo. Login: ${EMAIL} / ${PASSWORD}  ·  X-Api-Key: ${BOT_API_KEY}`);
}
main().finally(() => prisma.$disconnect());
