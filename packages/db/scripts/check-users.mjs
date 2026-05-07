import 'dotenv/config';
import { createClient } from '@libsql/client';

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;

if (!url) {
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

const client = createClient({ url, authToken });

const fmtDate = (v) => {
  if (v == null) return 'null';
  const n = Number(v);
  // Drizzle mode:timestamp stores Unix seconds
  return new Date(n * 1000).toISOString();
};

console.log('\n=== USERS ===');
const users = await client.execute(
  'SELECT id, email, name, emailVerified, createdAt FROM user ORDER BY createdAt DESC',
);
console.log(`(${users.rows.length} rows)`);
for (const u of users.rows) {
  console.log(
    `- ${u.email} | name="${u.name}" | id=${u.id} | created=${fmtDate(u.createdAt)} | verified=${u.emailVerified}`,
  );
}

console.log('\n=== ACCOUNTS (provider/password presence) ===');
const accounts = await client.execute(
  'SELECT userId, providerId, accountId, password, createdAt FROM account ORDER BY createdAt DESC',
);
console.log(`(${accounts.rows.length} rows)`);
for (const a of accounts.rows) {
  const pwd = a.password;
  const hasPwd = pwd != null && String(pwd).length > 0;
  const pwdHint = hasPwd
    ? `${String(pwd).slice(0, 10)}...(len ${String(pwd).length})`
    : 'NULL/empty';
  console.log(
    `- userId=${a.userId} | provider=${a.providerId} | accountId=${a.accountId} | password=${pwdHint} | created=${fmtDate(a.createdAt)}`,
  );
}

console.log('\n=== SESSIONS (last 5) ===');
const sessions = await client.execute(
  'SELECT userId, token, ipAddress, userAgent, expiresAt, createdAt FROM session ORDER BY createdAt DESC LIMIT 5',
);
console.log(`(${sessions.rows.length} rows)`);
for (const s of sessions.rows) {
  console.log(
    `- userId=${s.userId} | token=${String(s.token).slice(0, 12)}... | ip=${s.ipAddress} | ua="${String(s.userAgent ?? '').slice(0, 40)}..." | expires=${fmtDate(s.expiresAt)} | created=${fmtDate(s.createdAt)}`,
  );
}

await client.close();
