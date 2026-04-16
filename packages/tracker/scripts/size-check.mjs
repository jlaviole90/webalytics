#!/usr/bin/env node
// Size gate for the UMD bundle. Fails CI if the gzipped size grows past the
// budget set in ARCHITECTURE.md (§8): <2KB for the core.
//
// The ESM/CJS bundles also go through this script but aren't gated — the
// relevant footprint for drop-in <script> users is the UMD build.

import { readFileSync, existsSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = resolve(here, "..");

const BUDGET_UMD_GZIP = 4096; // 4 KB for now; ARCHITECTURE target is 2 KB
// We ship web vitals inline (which ARCHITECTURE counts toward the core
// budget). Once we split vitals into an optional chunk we'll lower this to
// the 2 KB target.

const files = [
  { path: "dist/index.js", type: "ESM", gate: null },
  { path: "dist/index.cjs", type: "CJS", gate: null },
  { path: "dist/tracker.umd.js", type: "UMD", gate: BUDGET_UMD_GZIP },
];

let failed = false;
for (const f of files) {
  const p = resolve(pkgRoot, f.path);
  if (!existsSync(p)) {
    console.error(`MISSING ${f.path}`);
    failed = true;
    continue;
  }
  const raw = readFileSync(p);
  const gz = gzipSync(raw, { level: 9 });
  const sizeKB = (raw.length / 1024).toFixed(2);
  const gzKB = (gz.length / 1024).toFixed(2);
  const gate = f.gate ? `(budget ${(f.gate / 1024).toFixed(1)} KB gzip)` : "";
  const ok = f.gate ? gz.length <= f.gate : true;
  console.log(
    `${ok ? "ok" : "FAIL"} ${f.type.padEnd(3)}  raw=${sizeKB.padStart(6)} KB  gz=${gzKB.padStart(6)} KB  ${gate}`,
  );
  if (!ok) failed = true;
}
if (failed) process.exit(1);
