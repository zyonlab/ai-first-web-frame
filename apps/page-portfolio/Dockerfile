FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-portfolio... build
# Next `output: "standalone"` does NOT copy `.next/static` (client JS chunks) or
# `public` into the standalone tree; the standalone server serves them from
# alongside server.js, so copy them in or every /_next/static request 404s and
# no client asset resolves.
RUN cp -r apps/page-portfolio/.next/static apps/page-portfolio/.next/standalone/apps/page-portfolio/.next/static \
  && { [ -d apps/page-portfolio/public ] && cp -r apps/page-portfolio/public apps/page-portfolio/.next/standalone/apps/page-portfolio/public || true; }
ENV NODE_ENV=production
EXPOSE 4105
CMD ["node", "apps/page-portfolio/.next/standalone/apps/page-portfolio/server.js"]
