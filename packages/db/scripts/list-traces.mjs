/**
 * Llistat de traces de test (mode test activat al mobile).
 * Uso: node packages/db/scripts/list-traces.mjs [email]
 */
import 'dotenv/config';
import { createClient } from '@libsql/client';

const client = createClient({
  url: process.env.DATABASE_URL,
  authToken: process.env.DATABASE_AUTH_TOKEN,
});

const email = process.argv[2] ?? 'jllorensguillaumes@gmail.com';

const userRes = await client.execute({
  sql: 'SELECT id FROM user WHERE email = ?',
  args: [email],
});
if (userRes.rows.length === 0) {
  console.error(`No user with email ${email}`);
  process.exit(1);
}
const userId = userRes.rows[0].id;

const res = await client.execute({
  sql: `SELECT
          datetime(ts, 'unixepoch', '+2 hours') AS local_ts,
          lat, lng, accuracy, alarm_title, alarm_event, alarm_repeat,
          outer_radius, distance, inside_outer, last_distance,
          outside_streak, did_fire, source, note
        FROM geofence_traces
        WHERE user_id = ?
        ORDER BY ts DESC
        LIMIT 200`,
  args: [userId],
});

console.log(`=== ${res.rows.length} traces (most recent first) ===\n`);
for (const r of res.rows.reverse()) {
  const fired = r.did_fire ? ' 🔔FIRE' : '';
  const inside = r.inside_outer ? 'IN ' : 'OUT';
  const alarm = r.alarm_title
    ? `[${r.alarm_title}/${r.alarm_event}/${r.alarm_repeat}]`
    : `[${r.source}]`;
  const dist = r.distance != null ? `${r.distance}m` : '-';
  const last = r.last_distance != null ? `(prev ${r.last_distance}m)` : '';
  const radius = r.outer_radius != null ? `r=${r.outer_radius}m` : '';
  const streak = r.outside_streak != null ? `streak=${r.outside_streak}` : '';
  const acc = r.accuracy != null ? `±${Math.round(r.accuracy)}m` : '';
  console.log(
    `${r.local_ts} ${inside} ${alarm} dist=${dist} ${last} ${radius} ${streak} ${acc}${fired}` +
      (r.note ? ` // ${r.note}` : ''),
  );
}

await client.close();
