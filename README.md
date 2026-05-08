# Agenda_Geoloc

App móvil de agenda con dos tipos de disparador:

- **Por hora** — alarma clásica (ej: "pon la lavadora a las 18:00")
- **Por ubicación** — geofencing (ej: "cuando llegue a casa", "cuando salga de la autopista")

…y combinables (ej: "cuando llegue a casa **entre las 18-22h**, recuérdame poner la lavadora").

Feature diferencial: sistema de amigos donde una persona puede crear alarmas en la agenda de otra (ej: tu pareja te añade "compra leche cuando llegues al Mercadona"). La ubicación nunca se comparte; solo la definición de la alarma.

## Stack

| Capa | Tecnología |
|---|---|
| Mobile | React Native + Expo SDK 54 (managed) + expo-router + NativeWind v4 + i18n (es/en/ca) |
| State | Zustand (auth) + React Query (server cache) + SecureStore (token) |
| Forms | react-hook-form + zod resolver |
| Mapas | react-native-maps + expo-location |
| Notifs | expo-notifications (locales en Fase 3, geofence triggers en Fase 4) |
| Backend | Node 20 + Express + Better-Auth + Drizzle ORM + Zod |
| DB | Turso (libSQL/SQLite serverless) |
| Repo | pnpm workspaces + TypeScript |
| Hosting | Render (api), local APK (mobile dev) |

## Estructura

```
apps/
├── mobile/        Expo app (3 tabs: Agenda, Lugares, Ajustes)
└── api/           Express + Drizzle + Better-Auth, /api/auth, /api/me, /api/places, /api/alarms

packages/
├── shared/        Zod schemas y tipos compartidos
└── db/            Schema Drizzle + migraciones (drizzle-kit)
```

## Setup local

### Requisitos

- Node 20+
- pnpm (instalar con `npm i -g pnpm` si no lo tienes)
- Cuenta Turso con una database creada
- Para dev móvil: Expo Go (Fase 3) o development build local con Android Studio (Fase 4+)

### Variables de entorno

Copia los `.env.example` y rellena tus credenciales:

```sh
cp apps/api/.env.example apps/api/.env
cp packages/db/.env.example packages/db/.env
cp apps/mobile/.env.example apps/mobile/.env
```

| Archivo | Variables clave |
|---|---|
| `apps/api/.env` | `DATABASE_URL` (libsql://...), `DATABASE_AUTH_TOKEN`, `BETTER_AUTH_SECRET` (32 bytes hex), `BETTER_AUTH_URL` |
| `packages/db/.env` | Mismas vars de DB (drizzle-kit las usa para migraciones) |
| `apps/mobile/.env` | `EXPO_PUBLIC_API_URL` apuntando a la IP LAN del PC para que Expo Go en el móvil alcance la api |

> **Genera el secret de auth** con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Instalar dependencias

```sh
pnpm install
```

### Migrar la DB

Una vez configurado `packages/db/.env` con tu Turso:

```sh
pnpm db:generate    # solo si tocas el schema
pnpm db:migrate     # aplica las migraciones a Turso
```

## Workflow de desarrollo

Necesitas **dos terminales abiertas en la raíz del proyecto**:

```sh
# Terminal 1 — backend
pnpm dev:api
# Express en http://0.0.0.0:4000

# Terminal 2 — mobile
pnpm dev:mobile
# Metro bundler + QR para Expo Go (Fase 3)
```

Para que el móvil físico (Expo Go o dev build) alcance al api, ambos deben estar **en la misma WiFi** y `apps/mobile/.env` debe apuntar a la IP LAN del PC, p.ej.:

```env
EXPO_PUBLIC_API_URL=http://192.168.1.103:4000
```

Si cambias de red WiFi, actualiza la IP.

## Comandos útiles

```sh
pnpm dev:api              # arranca el backend con tsx watch
pnpm dev:mobile           # arranca Metro + QR
pnpm dev:mobile -- --clear  # arranca limpiando caché Metro (necesario tras añadir deps)
pnpm typecheck            # tsc --noEmit en todos los workspaces
pnpm db:generate          # nueva migración desde el schema
pnpm db:migrate           # aplica migraciones pendientes
pnpm db:studio            # abre Drizzle Studio (UI web para inspeccionar la DB)
```

### Inspeccionar la DB

```sh
node packages/db/scripts/check-users.mjs
```

Muestra users, accounts (con presencia de password) y sesiones recientes en Turso. Útil para depurar problemas de auth.

## Despliegue

### API (Render)

El backend está pensado para desplegar en Render como Web Service:

- Build command: `pnpm install && pnpm --filter @agenda/api build`
- Start command: `node apps/api/dist/index.js`
- Variables: las mismas del `.env` (Turso URL/token, secret, BETTER_AUTH_URL apuntando al dominio Render)

### Mobile

- **Fase 3 (actual)**: Expo Go — escanea QR de Metro
- **Fase 4 en adelante**: dev build local con `cd apps/mobile && npx expo run:android` (necesita Android Studio + SDK + USB debugging)
- **Producción**: EAS Build → Play Store / App Store

## Gotchas conocidos

### pnpm + Expo + monorepo

Combinación con fricciones específicas. Resumen de qué hicimos:

- `apps/mobile/metro.config.js` mantiene `disableHierarchicalLookup` en `false` (no `true` como en monorepos npm/yarn). pnpm necesita que Metro escale el árbol porque las deps transitivas viven en `node_modules/.pnpm/{pkg}/node_modules` como symlinks.
- Si Metro falla con `Unable to resolve "X" from "apps/mobile/app/..."`, normalmente es una dep transitiva que hay que **promover a direct dep**. Casos resueltos: `@expo/metro-runtime`, `react-native-css-interop`, `intl-pluralrules`.
- `packages/shared` usa imports sin `.js` para que Metro los resuelva como `.ts`. `packages/db` mantiene `.js` (drizzle-kit lo ejecuta con NodeNext).
- Tras añadir/cambiar deps, lanza con `pnpm dev:mobile -- --clear`.

### Auth desde móvil

React Native fetch no envía header `Origin` (los browsers sí). Better-Auth tiene un check anti-CSRF que rechaza POST sin Origin. Solución: el cliente RN siempre envía `Origin: http://localhost:8081` (en `lib/api/client.ts`), valor que ya está en `trustedOrigins` del backend.

### Notificaciones

- Locales (`scheduleNotificationAsync` con `DATE` trigger) **funcionan en Expo Go**
- Push remotas y geofencing en background **NO funcionan en Expo Go** — requieren development build (Fase 4)

### Puerto 4000

El backend escucha en `0.0.0.0:4000`. Si tienes otro servicio en ese puerto, edita `PORT` en `apps/api/.env`. Los puertos 3000 y 3001 estaban tomados por servicios del usuario en este proyecto, por eso fuimos a 4000.

## Estado del proyecto

### Fase 1 — Setup ✅
Monorepo, esquema DB inicial, deploy local en marcha.

### Fase 2 — Auth ✅
Better-Auth con email/password, bearer tokens, SecureStore, login/register/logout end-to-end probado en móvil físico contra Turso.

### Fase 3 — CRUD lugares y alarmas ✅
- Backend: endpoints REST con validación Zod
- Mobile: tabs (Agenda / Lugares / Ajustes), formulario de lugar con mapa + búsqueda por dirección, asistente de alarma (3 tipos), notificaciones locales para alarmas de hora

### Fase 4 — Geofencing en background ⏳
En desarrollo. Requiere dev build (no Expo Go).

### Fase 5 — Amigos + sharing 📋
Pendiente.

## Licencia

Privado. Sin licencia pública aún.
