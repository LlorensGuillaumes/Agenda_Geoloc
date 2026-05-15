import 'dotenv/config';
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

// El Mercadona vell és el de coordenades 41.350204..., 1.704576...
// Trobem-lo per nom i coordenades aproximades, comprovem que no hi hagi
// alarmes associades, i el borrem.
const res = await client.execute({
  sql: `SELECT id, latitude, longitude FROM places
         WHERE name = 'Mercadona'
           AND ABS(latitude - 41.350204) < 0.0001
           AND ABS(longitude - 1.704576) < 0.0001`,
  args: [],
});

if (res.rows.length === 0) {
  console.log('No s\'ha trobat cap Mercadona antic.');
  process.exit(0);
}
if (res.rows.length > 1) {
  console.error('Múltiples coincidències, abortant per seguretat.');
  process.exit(1);
}

const oldId = res.rows[0].id;
const alarms = await client.execute({
  sql: `SELECT id, title FROM alarms WHERE location_config LIKE '%' || ? || '%'`,
  args: [oldId],
});
if (alarms.rows.length > 0) {
  console.error('Aquest Mercadona té alarmes referenciant-lo:');
  for (const a of alarms.rows) console.error(` - ${a.title} (${a.id})`);
  process.exit(1);
}

await client.execute({ sql: 'DELETE FROM places WHERE id = ?', args: [oldId] });
console.log(`Eliminat Mercadona antic (id=${oldId})`);
await client.close();
