// Production backup for Lovable Cloud (no direct Postgres access, so this goes through the API).
// Signs in as an admin user, exports every public table to JSON + CSV and downloads storage files.
//
// Usage:  npm run backup
// Optional env vars: BACKUP_EMAIL, BACKUP_PASSWORD, BACKUP_DIR
//
// Not included: auth passwords (cannot be exported) and the DB schema (already in supabase/migrations).

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BUCKETS = ["test-product-images"];
const PAGE = 1000;

const LOCAL = process.argv.includes("--local");

// Read .env explicitly (never .env.local, which points to the local database) unless --local is passed for testing.
function readProdEnv() {
  const env = {};
  for (const line of readFileSync(join(ROOT, LOCAL ? ".env.local" : ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) env[m[1]] = m[2];
  }
  const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("No encontré VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY en .env");
  if (!LOCAL && /127\.0\.0\.1|localhost/.test(url)) throw new Error(`.env apunta a local (${url}), no a producción`);
  return { url, key };
}

// Table list comes from the migrations so tables added later are picked up automatically.
function tablesFromMigrations() {
  const dir = join(ROOT, "supabase", "migrations");
  const tables = new Set();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(join(dir, file), "utf8");
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z0-9_]+)\1/gi)) tables.add(m[2]);
    for (const m of sql.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?public\.("?)([a-z0-9_]+)\1/gi)) tables.delete(m[2]);
  }
  return [...tables].sort();
}

function ask(question, hidden = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    rl._writeToOutput = (s) => rl.output.write(s.startsWith(question) ? s : "*".repeat(s.length ? 1 : 0));
  }
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(a.trim()); }));
}

function toCsv(rows) {
  if (rows.length === 0) return "";
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // BOM so Excel opens accents correctly.
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}

async function fetchAll(supabase, table) {
  const rows = [];
  // Ordering keeps pagination stable; fall back to unordered for tables without an id column.
  let ordered = true;
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select("*").range(from, from + PAGE - 1);
    if (ordered) q = q.order("id");
    let { data, error } = await q;
    if (error && ordered && from === 0 && /id/.test(error.message)) {
      ordered = false;
      ({ data, error } = await supabase.from(table).select("*").range(from, from + PAGE - 1));
    }
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) return rows;
  }
}

async function listFiles(supabase, bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.id === null) files.push(...(await listFiles(supabase, bucket, path))); // folder
      else files.push(path);
    }
    if (data.length < PAGE) return files;
  }
}

async function main() {
  const { url, key } = readProdEnv();
  const email = process.env.BACKUP_EMAIL || (await ask("Email admin de producción: "));
  const password = process.env.BACKUP_PASSWORD || (await ask("Contraseña: ", true));

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) throw new Error(`No pude iniciar sesión: ${authErr.message}`);
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", auth.user.id);
  if (!roles?.some((r) => r.role === "admin")) {
    console.warn("⚠  Este usuario no es admin: algunas tablas pueden salir incompletas por permisos.");
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  const out = join(process.env.BACKUP_DIR || join(homedir(), "Documents", "Respaldos-BeeClean"), stamp);
  mkdirSync(join(out, "json"), { recursive: true });
  mkdirSync(join(out, "csv"), { recursive: true });
  console.log(`\nRespaldando ${url}\n→ ${out}\n`);

  const manifest = { created_at: new Date().toISOString(), source: url, user: email, tables: {}, storage: {}, errors: [] };

  for (const table of tablesFromMigrations()) {
    try {
      const rows = await fetchAll(supabase, table);
      writeFileSync(join(out, "json", `${table}.json`), JSON.stringify(rows, null, 2));
      writeFileSync(join(out, "csv", `${table}.csv`), toCsv(rows));
      manifest.tables[table] = rows.length;
      console.log(`  ✓ ${table.padEnd(24)} ${rows.length} filas`);
    } catch (e) {
      manifest.errors.push({ table, error: e.message });
      console.log(`  ✗ ${table.padEnd(24)} ${e.message}`);
    }
  }

  for (const bucket of BUCKETS) {
    let ok = 0;
    try {
      const files = await listFiles(supabase, bucket);
      for (const path of files) {
        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (error) { manifest.errors.push({ bucket, path, error: error.message }); continue; }
        const dest = join(out, "storage", bucket, ...path.split("/"));
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, Buffer.from(await data.arrayBuffer()));
        ok++;
      }
      manifest.storage[bucket] = ok;
      console.log(`  ✓ storage/${bucket.padEnd(16)} ${ok} archivos`);
    } catch (e) {
      manifest.errors.push({ bucket, error: e.message });
      console.log(`  ✗ storage/${bucket.padEnd(16)} ${e.message}`);
    }
  }

  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  await supabase.auth.signOut();
  console.log(manifest.errors.length ? `\nTerminado con ${manifest.errors.length} error(es); revisa manifest.json` : "\n✅ Respaldo completo");
  if (manifest.errors.length) process.exitCode = 1;
}

main().catch((e) => { console.error(`\n❌ ${e.message}`); process.exit(1); });
