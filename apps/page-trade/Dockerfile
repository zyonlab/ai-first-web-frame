FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-trade... build
# Next `output: "standalone"` does NOT copy `.next/static` (client JS chunks) or
# `public` into the standalone tree; the standalone server serves them from
# alongside server.js, so copy them in or every /_next/static request 404s and
# no island hydrates.
RUN cp -r apps/page-trade/.next/static apps/page-trade/.next/standalone/apps/page-trade/.next/static \
  && { [ -d apps/page-trade/public ] && cp -r apps/page-trade/public apps/page-trade/.next/standalone/apps/page-trade/public || true; }
ENV NODE_ENV=production
EXPOSE 4103
CMD ["node", "apps/page-trade/.next/standalone/apps/page-trade/server.js"]
