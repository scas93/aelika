# Aelika — Fase 0

Monorepo: `backend` (NestJS + Prisma) y `frontend` (Next.js).

## Requisitos

- Node 24+
- Docker (o [Colima](https://github.com/abiosoft/colima) como motor sin Docker Desktop: `brew install docker docker-compose colima && colima start`)

## Arranque local

```bash
# 1. Levantar Postgres y Redis
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env   # ya viene precargado para el docker-compose de este repo
npm install
npm run prisma:migrate  # aplica las migraciones (usa `npx prisma migrate dev` si prefieres el nombre completo)
npm run prisma:seed     # crea tenant + usuario demo: demo@aelika.com / demo1234
npm run start:dev       # http://localhost:3001

# 3. Frontend (otra terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev              # http://localhost:3000
```

## Notas

- El cliente de Prisma se genera en `backend/generated/prisma` (no en `node_modules`) con `moduleFormat = "cjs"` — Prisma 7 usa ESM por defecto, que no es compatible con la compilación CommonJS de Nest.
- Prisma 7 requiere un driver adapter explícito (`@prisma/adapter-pg`); ya está configurado en `PrismaService`.
- El aislamiento multi-tenant se hace en dos capas: `JwtAuthGuard` valida el token y `TenantPrismaService` (request-scoped) inyecta automáticamente el filtro `tenantId` en cada query de modelos tenant-owned — ver `backend/src/prisma/tenant-prisma.service.ts`. Al agregar CATEGORY/PRODUCT/ORDERS, hay que sumarlos ahí.
