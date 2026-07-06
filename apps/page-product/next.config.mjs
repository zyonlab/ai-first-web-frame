/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  experimental: {
    // Run middleware on the Node.js runtime so the recently-viewed cookie can be
    // signed with node:crypto via @mvp/storage (unavailable in the Edge runtime).
    nodeMiddleware: true,
  },
};

export default nextConfig;
