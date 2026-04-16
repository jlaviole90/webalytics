// Server-only env accessors. Importing this file from a client component
// errors at build time thanks to "server-only" — the bearer token must
// never ship to the browser.
//
// Seed values are randomized per `make seed`, so we read them lazily on
// every request. If the OS env isn't set, we fall back to reading a
// bind-mounted seed file (docker-compose maps ./deploy -> /app/deploy).
import "server-only";
import fs from "node:fs";
import path from "node:path";

function fromSeedFile(name: string): string | undefined {
  const p = process.env.WEBALYTICS_SEED_FILE || path.resolve("/app/deploy/.seeded.env");
  try {
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1).trim();
      if (k === name && v) return v;
    }
  } catch {
    /* file missing is expected until `make seed` runs */
  }
  return undefined;
}

function read(name: string, aliases: string[] = []): string | undefined {
  const ordered = [name, ...aliases];
  for (const k of ordered) {
    const v = process.env[k];
    if (v) return v;
  }
  for (const k of ordered) {
    const v = fromSeedFile(k);
    if (v) return v;
  }
  return undefined;
}

function required(name: string, aliases: string[] = []): string {
  const v = read(name, aliases);
  if (!v) {
    throw new Error(
      `${name} is required but not set. Run \`make seed\` to populate deploy/.seeded.env.`,
    );
  }
  return v;
}

export const env = {
  apiHost: () => required("WEBALYTICS_API_HOST"),
  apiToken: () => required("WEBALYTICS_API_TOKEN", ["WEBALYTICS_TOKEN"]),
  siteUUID: () => required("WEBALYTICS_SITE_UUID", ["WEBALYTICS_ORG_SITE_UUID"]),
};
