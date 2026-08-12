const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const migrationsDir = path.join(__dirname, 'migrations');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      run_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function loadMigrations() {
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files.map((file) => ({ name: file, path: path.join(migrationsDir, file) }));
}

async function runMigrations() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const migrations = await loadMigrations();
    for (const migration of migrations) {
      const result = await client.query('SELECT 1 FROM migrations WHERE name = $1', [migration.name]);
      if (result.rowCount > 0) continue;
      const sql = fs.readFileSync(migration.path, 'utf8');
      console.log('Applying', migration.name);
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO migrations (name) VALUES ($1)', [migration.name]);
      await client.query('COMMIT');
    }
    console.log('Migrations complete');
  } catch (err) {
    await pool.query('ROLLBACK');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

async function showStatus() {
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const result = await client.query('SELECT name, run_at FROM migrations ORDER BY run_at');
    console.log('Applied migrations:');
    result.rows.forEach((row) => console.log(row.run_at.toISOString(), row.name));
  } finally {
    client.release();
    await pool.end();
  }
}

const arg = process.argv[2];
if (arg === 'status') {
  showStatus().catch((err) => { console.error(err); process.exit(1); });
} else {
  runMigrations().catch((err) => { console.error(err); process.exit(1); });
}
