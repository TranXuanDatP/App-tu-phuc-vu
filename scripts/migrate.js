/**
 * Standalone production database migration runner.
 *
 * Applies Drizzle migrations from ./drizzle using the `pg` driver directly
 * (drizzle-orm + pg are production deps) — NOT drizzle-kit (a devDependency,
 * absent from lean/prod build contexts and not meant for production).
 *
 *   npm run db:migrate            # applies pending migrations
 *
 * Loads .env locally; in CI set DATABASE_URL in the environment. Connects via
 * DATABASE_URL — the same string the app uses.
 *
 * Why not drizzle's `migrate()`? In this stack (drizzle-orm 0.45 + node-postgres
 * + node 24) `drizzle()`'s `session.transaction()` does not COMMIT — migrations
 * applied inside it vanish when the connection closes. Raw `pg` transactions on
 * a dedicated client (BEGIN … COMMIT) commit correctly, so we drive those
 * ourselves. Tracking is written to the SAME `drizzle.__drizzle_migrations`
 * table with the SAME sha256(file) hash drizzle uses, so this stays compatible
 * with drizzle-kit / the app's own migrator if that path is fixed later.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { Pool } = require('pg');

const TRACKING_SCHEMA = 'drizzle';
const TRACKING_TABLE = '__drizzle_migrations';

function splitStatements(rawSql) {
  // Drizzle .sql files separate statements with `--> statement-breakpoint`.
  // Files without markers (older/hand-written) fall back to one chunk, which pg
  // executes as multiple semicolon-separated statements in a single query.
  return rawSql
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('✗ DATABASE_URL is not set. Set it in the environment or .env.');
    process.exit(1);
  }

  const folder = path.resolve(process.cwd(), 'drizzle');
  const journalPath = path.join(folder, 'meta', '_journal.json');
  if (!fs.existsSync(journalPath)) {
    console.error(`✗ No meta/_journal.json found under ${folder}`);
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const client = await pool.connect();

  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${TRACKING_SCHEMA}`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${TRACKING_SCHEMA}.${TRACKING_TABLE} (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL UNIQUE,
        created_at bigint
      )`,
    );

    const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));

    // Adopt-an-existing-DB fast path: if nothing is tracked yet but the schema is
    // already present (e.g. the DB was migrated by drizzle-kit / the app's boot
    // migrator / a dump), mark every journal migration as applied WITHOUT running
    // any SQL. Running the generated DDL again isn't safe — some migrations use
    // plain `CREATE TABLE` (would fail "already exists") and others `DROP TABLE
    // IF EXISTS` (would destroy data). This records the hashes so later runs skip.
    const { rows: trackedRows } = await client.query(
      `SELECT count(*)::int AS n FROM ${TRACKING_SCHEMA}.${TRACKING_TABLE}`,
    );
    const { rows: usersRows } = await client.query(
      `SELECT to_regclass('public.users') AS c`,
    );
    if (trackedRows[0].n === 0 && usersRows[0].c) {
      for (const entry of journal.entries) {
        const raw = fs.readFileSync(path.join(folder, `${entry.tag}.sql`), 'utf8');
        const hash = crypto.createHash('sha256').update(raw).digest('hex');
        await client.query(
          `INSERT INTO ${TRACKING_SCHEMA}.${TRACKING_TABLE} (hash, created_at) VALUES ($1, $2)`,
          [hash, entry.when],
        );
      }
      console.log(
        `✓ Adopted existing schema: ${journal.entries.length} migration(s) marked applied (no SQL run).`,
      );
      return;
    }

    let applied = 0;
    let skipped = 0;
    let reconciled = 0;

    for (const entry of journal.entries) {
      const sqlPath = path.join(folder, `${entry.tag}.sql`);
      const raw = fs.readFileSync(sqlPath, 'utf8');
      const hash = crypto.createHash('sha256').update(raw).digest('hex');

      const { rows } = await client.query(
        `SELECT 1 FROM ${TRACKING_SCHEMA}.${TRACKING_TABLE} WHERE hash = $1`,
        [hash],
      );
      if (rows.length) {
        skipped += 1;
        continue;
      }

      // One transaction per migration, driven via raw pg so it actually commits.
      await client.query('BEGIN');
      try {
        for (const stmt of splitStatements(raw)) {
          await client.query(stmt);
        }
        await client.query(
          `INSERT INTO ${TRACKING_SCHEMA}.${TRACKING_TABLE} (hash, created_at) VALUES ($1, $2)`,
          [hash, entry.when],
        );
        await client.query('COMMIT');
        applied += 1;
        console.log(`✓ ${entry.tag}`);
      } catch (err) {
        await client.query('ROLLBACK');
        // 42P07 = duplicate_table, 42710 = duplicate_object (enum/type). The schema
        // object already exists but this migration was never recorded as applied
        // (DB was migrated by another tool, or the app's boot migrator which doesn't
        // commit its tracking write). Reconcile: record the hash so later runs skip,
        // instead of hard-failing on a normal "already migrated" database.
        if (err && (err.code === '42P07' || err.code === '42710')) {
          await client.query(
            `INSERT INTO ${TRACKING_SCHEMA}.${TRACKING_TABLE} (hash, created_at) VALUES ($1, $2)`,
            [hash, entry.when],
          );
          reconciled += 1;
          console.log(`⊘ ${entry.tag} already applied (reconciled)`);
          continue;
        }
        throw new Error(`Failed in ${entry.tag}: ${err.message}`);
      }
    }

    console.log(
      `\n✓ ${applied} applied, ${reconciled} reconciled, ${skipped} already up to date.`,
    );
  } catch (err) {
    console.error('✗ Migration failed:', err && err.message ? err.message : err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
