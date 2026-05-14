import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real, unique } from 'drizzle-orm/sqlite-core';

const uuid = () => crypto.randomUUID();
const now = () => new Date();

// ============================================================
// Better-Auth tables (singular names, required by Better-Auth)
// ============================================================

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull().default(false),
  name: text('name').notNull(),
  image: text('image'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$defaultFn(now),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$defaultFn(now),
  pushToken: text('pushToken'),
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  ipAddress: text('ipAddress'),
  userAgent: text('userAgent'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$defaultFn(now),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$defaultFn(now),
});

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('accountId').notNull(),
  providerId: text('providerId').notNull(),
  password: text('password'),
  accessToken: text('accessToken'),
  refreshToken: text('refreshToken'),
  idToken: text('idToken'),
  accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
  refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
  scope: text('scope'),
  createdAt: integer('createdAt', { mode: 'timestamp' }).notNull().$defaultFn(now),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull().$defaultFn(now),
});

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
  createdAt: integer('createdAt', { mode: 'timestamp' }).$defaultFn(now),
  updatedAt: integer('updatedAt', { mode: 'timestamp' }).$defaultFn(now),
});

// ============================================================
// Domain tables (plural names)
// ============================================================

export const friendships = sqliteTable(
  'friendships',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    requesterId: text('requester_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    addresseeId: text('addressee_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['pending', 'accepted', 'blocked'] })
      .notNull()
      .default('pending'),
    trustLevel: text('trust_level', { enum: ['manual_accept', 'auto_accept'] })
      .notNull()
      .default('manual_accept'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
    acceptedAt: integer('accepted_at', { mode: 'timestamp' }),
  },
  (t) => ({
    uniquePair: unique('friendships_pair_unique').on(t.requesterId, t.addresseeId),
  }),
);

export const places = sqliteTable('places', {
  id: text('id').primaryKey().$defaultFn(uuid),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  latitude: real('latitude').notNull(),
  longitude: real('longitude').notNull(),
  radiusMeters: integer('radius_meters').notNull().default(150),
  icon: text('icon').default('pin'),
  color: text('color').default('#3B82F6'),
  address: text('address'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
});

export const placeShares = sqliteTable(
  'place_shares',
  {
    id: text('id').primaryKey().$defaultFn(uuid),
    placeId: text('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
    sharedWithUserId: text('shared_with_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
  },
  (t) => ({
    uniqueShare: unique('place_shares_unique').on(t.placeId, t.sharedWithUserId),
  }),
);

export const alarms = sqliteTable('alarms', {
  id: text('id').primaryKey().$defaultFn(uuid),
  ownerId: text('owner_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  creatorId: text('creator_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  notes: text('notes'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  triggerType: text('trigger_type', {
    enum: ['time', 'location', 'time_and_location'],
  }).notNull(),
  timeConfig: text('time_config', { mode: 'json' }).$type<TimeConfig | null>(),
  locationConfig: text('location_config', { mode: 'json' }).$type<LocationConfig | null>(),
  status: text('status', {
    enum: ['pending_acceptance', 'active', 'paused', 'completed'],
  })
    .notNull()
    .default('active'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull().$defaultFn(now),
  lastFiredAt: integer('last_fired_at', { mode: 'timestamp' }),
});

// ============================================================
// JSON column types
// ============================================================

export type TimeConfig = {
  datetime?: string;
  repeat: 'once' | 'daily' | 'weekly';
  weekdays?: number[];
  timeWindow?: { start: string; end: string };
};

export type LocationConfig = {
  mode: 'saved_place' | 'custom_point';
  placeId?: string;
  customPoint?: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
  };
  event: 'enter' | 'exit' | 'nearby';
  repeat?: 'once' | 'always'; // default 'once': se desactiva tras disparar
  activeWindow?: {
    start: string; // "HH:MM"
    end: string; // "HH:MM"
    weekdays?: number[]; // 0=domingo, 6=sábado
  };
};

// ============================================================
// Inferred types
// ============================================================

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Friendship = typeof friendships.$inferSelect;
export type Place = typeof places.$inferSelect;
export type PlaceShare = typeof placeShares.$inferSelect;
export type Alarm = typeof alarms.$inferSelect;
export type NewAlarm = typeof alarms.$inferInsert;
