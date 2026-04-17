/** @type {import('next').NextConfig} */
const nextConfig = {
  // The docker image runs `next start` against a prebuilt output. Setting
  // output=standalone keeps the runtime image small by only copying the
  // files Next actually needs.
  output: "standalone",
  // Transpile the local tracker packages so they work in the app router
  // bundler without a separate build step on every dev reload.
  transpilePackages: ["@jlaviole90/tracker", "@jlaviole90/tracker-next"],
  reactStrictMode: true,
};
export default nextConfig;
