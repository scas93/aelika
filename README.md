# Aelika

Plataforma SaaS multi-tenant de pedidos sin comisiones (menudeo, mayoreo y hotel). Monorepo: `backend` (NestJS + Prisma + PostgreSQL) y `frontend` (Next.js).

**Contexto para trabajar en el repo:** [`CLAUDE.md`](CLAUDE.md) (índice, convenciones, comandos de verificación) y la carpeta [`docs/`](docs/) (documentación por área).

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
npm run prisma:migrate  # aplica las migraciones
npm run prisma:seed     # tenant + usuario demo: demo@aelika.com / demo1234
npm run start:dev       # http://localhost:3001

# 3. Frontend (otra terminal)
cd frontend
cp .env.local.example .env.local
npm install
npm run dev              # http://localhost:3000
```

Otros seeds de demo, scripts de datos y sus advertencias: [`docs/seeds-y-datos-demo.md`](docs/seeds-y-datos-demo.md). Estructura del repo y módulos: [`docs/architecture.md`](docs/architecture.md).

## Ramas

`main` → producción, `staging` → staging; el trabajo nuevo se sube primero a `staging`. Detalle en `CLAUDE.md`.
