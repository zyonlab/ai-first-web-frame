FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-vaults... build
# Next `output: "standalone"` does NOT copy `.next/static` (client JS chunks) or
# `public` into the standalone tree; the standalone server serves them from
# alongside server.js, so copy them in or every /_next/static request 404s and
# no client asset resolves.
RUN cp -r apps/page-vaults/.next/static apps/page-vaults/.next/standalone/apps/page-vaults/.next/static \
  && { [ -d apps/page-vaults/public ] && cp -r apps/page-vaults/public apps/page-vaults/.next/standalone/apps/page-vaults/public || true; }
ENV NODE_ENV=production
EXPOSE 4106
CMD ["node", "apps/page-vaults/.next/standalone/apps/page-vaults/server.js"]
