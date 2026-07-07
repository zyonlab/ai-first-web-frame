FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-markets... build
# Next `output: "standalone"` does NOT copy `.next/static` (client JS chunks) or
# `public` into the standalone tree; the standalone server serves them from
# alongside server.js, so copy them in or every /_next/static request 404s and
# no client asset resolves.
RUN cp -r apps/page-markets/.next/static apps/page-markets/.next/standalone/apps/page-markets/.next/static \
  && { [ -d apps/page-markets/public ] && cp -r apps/page-markets/public apps/page-markets/.next/standalone/apps/page-markets/public || true; }
ENV NODE_ENV=production
EXPOSE 4104
CMD ["node", "apps/page-markets/.next/standalone/apps/page-markets/server.js"]
