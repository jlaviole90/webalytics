import path from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // In development, transpile from source so "use client" boundaries are
  // preserved per-file. The bundled dist merges them into one file and
  // loses the directives. Only active in development; prod uses dist.
  transpilePackages:
    process.env.NODE_ENV === "development" ? ["@jlaviole90/dashboard-react"] : [],
  webpack(config, { isServer }) {
    // In development, resolve @jlaviole90/dashboard-react directly from
    // source so Next.js processes each file individually and correctly
    // identifies "use client" boundaries (the bundled dist loses them).
    if (process.env.NODE_ENV === "development") {
      config.resolve.alias["@jlaviole90/dashboard-react"] = path.resolve(
        __dirname,
        "../../packages/dashboard-react/src/index.ts",
      );
      // The package source uses .js extensions in imports (ESM convention),
      // but the real files are .ts/.tsx. Tell webpack to resolve both.
      config.resolve.extensionAlias = {
        ".js": [".ts", ".tsx", ".js"],
      };
    }
    return config;
  },
};
export default nextConfig;
