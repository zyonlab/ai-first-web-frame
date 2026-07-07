FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-product... build
# Next `output: "standalone"` does NOT copy `.next/static` (client JS chunks) or
# `public` into the standalone tree; copy them in or /_next/static 404s and no
# island hydrates.
RUN cp -r apps/page-product/.next/static apps/page-product/.next/standalone/apps/page-product/.next/static \
  && { [ -d apps/page-product/public ] && cp -r apps/page-product/public apps/page-product/.next/standalone/apps/page-product/public || true; }
ENV NODE_ENV=production
EXPOSE 4102
CMD ["node", "apps/page-product/.next/standalone/apps/page-product/server.js"]
