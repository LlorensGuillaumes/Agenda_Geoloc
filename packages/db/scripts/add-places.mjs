import 'dotenv/config';
import { createClient } from '@libsql/client';
import crypto from 'node:crypto';

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;

if (!url) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const client = createClient({ url, authToken });

const TARGET_EMAIL = 'jllorensguillaumes@gmail.com';

const userRes = await client.execute({
  sql: 'SELECT id FROM user WHERE email = ?',
  args: [TARGET_EMAIL],
});
if (userRes.rows.length === 0) {
  console.error(`User not found: ${TARGET_EMAIL}`);
  process.exit(1);
}
const ownerId = userRes.rows[0].id;
console.log(`Owner: ${TARGET_EMAIL} (id=${ownerId})`);

// Radis triats: 50m per llocs urbans (Mercadona); 100m per a un institut
// (edifici gran); 200m per a sortides d'autopista (cal marge a alta velocitat).
const places = [
  {
    name: 'Mercadona',
    lat: 41.35032068737259,
    lng: 1.704550073907842,
    radius: 50,
  },
  {
    name: 'Institut pingu',
    lat: 41.34030350287478,
    lng: 1.69236767216356,
    radius: 100,
  },
  {
    name: 'Sortida autopista Barcelona',
    lat: 41.34938470655336,
    lng: 1.7154663788192956,
    radius: 200,
  },
  {
    name: 'Sortida autopista Tarragona',
    lat: 41.3278123206696,
    lng: 1.6751040472771515,
    radius: 200,
  },
];

const now = Math.floor(Date.now() / 1000);
for (const p of places) {
  const id = crypto.randomUUID();
  await client.execute({
    sql: `INSERT INTO places (id, owner_id, name, latitude, longitude, radius_meters, icon, color, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pin', '#3B82F6', ?, ?)`,
    args: [id, ownerId, p.name, p.lat, p.lng, p.radius, now, now],
  });
  console.log(`+ ${p.name} (radius=${p.radius}m) id=${id}`);
}

await client.close();
console.log('Done.');
