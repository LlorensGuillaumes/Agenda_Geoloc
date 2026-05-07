# Agenda_Geoloc

App móvil de agenda con alarmas temporales y disparadores por geofencing, además de un sistema de amigos que pueden añadir alarmas en agendas ajenas.

## Stack

- **Mobile**: React Native + Expo + NativeWind + expo-router + i18n (es/en/ca)
- **Backend**: Node.js + Express + Drizzle ORM + Turso (libSQL)
- **Auth**: Better-Auth
- **Realtime**: Expo Push Notifications + refetch
- **Repo**: Monorepo con pnpm workspaces

## Estructura

```
agenda/
├── apps/
│   ├── mobile/       → React Native + Expo
│   └── api/          → Node + Express (deploy en Render)
└── packages/
    ├── shared/       → Zod schemas + tipos compartidos
    └── db/           → Drizzle schema + migraciones
```

## Setup local

```sh
pnpm install
pnpm db:generate           # genera migraciones desde el schema
pnpm db:migrate            # aplica migraciones a la DB local
pnpm dev:api               # arranca el backend en :3000
pnpm dev:mobile            # arranca Expo
```

## Variables de entorno

Copia `apps/api/.env.example` a `apps/api/.env` y rellena:

```
DATABASE_URL=file:./local.db          # local dev (libSQL local)
DATABASE_AUTH_TOKEN=                  # vacío en local; valor de Turso en prod
PORT=3000
```
