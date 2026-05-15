import 'dotenv/config';
import { createClient } from '@libsql/client';

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;

if (!url) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const client = createClient({ url, authToken });

console.log('\n=== PLACES ===');
const places = await client.execute(
  `SELECT p.name, p.latitude, p.longitude, p.radius_meters, p.address,
          u.email AS owner_email
     FROM places p
     JOIN user u ON u.id = p.owner_id
   ORDER BY u.email, p.name`,
);
console.log(`(${places.rows.length} rows)`);
for (const p of places.rows) {
  console.log(
    `- "${p.name}" | lat=${p.latitude}, lng=${p.longitude} | radius=${p.radius_meters}m | owner=${p.owner_email}${p.address ? ` | addr=${p.address}` : ''}`,
  );
}

console.log('\n=== ALARMS (location-based, active) ===');
const alarms = await client.execute(
  `SELECT a.title, a.trigger_type, a.is_active, a.status,
          a.location_config, u.email AS owner_email
     FROM alarms a
     JOIN user u ON u.id = a.owner_id
    WHERE a.trigger_type IN ('location', 'time_and_location')
      AND a.is_active = 1
    ORDER BY u.email, a.created_at`,
);
console.log(`(${alarms.rows.length} rows)`);
for (const a of alarms.rows) {
  const cfg = a.location_config ? JSON.parse(a.location_config) : null;
  const where =
    cfg?.mode === 'saved_place'
      ? `placeId=${cfg.placeId}`
      : cfg?.mode === 'custom_point'
        ? `custom @${cfg.customPoint?.latitude},${cfg.customPoint?.longitude} r=${cfg.customPoint?.radiusMeters}m`
        : '(no cfg)';
  console.log(
    `- "${a.title}" | event=${cfg?.event ?? '?'} | repeat=${cfg?.repeat ?? 'once'} | status=${a.status} | ${where} | owner=${a.owner_email}`,
  );
}

await client.close();
