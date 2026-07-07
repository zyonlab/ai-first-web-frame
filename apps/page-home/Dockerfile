FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-home... build
# Next `output: "standalone"` does NOT copy `.next/static` (client JS chunks) or
# `public` into the standalone tree; copy them in or /_next/static 404s and no
# island hydrates.
RUN cp -r apps/page-home/.next/static apps/page-home/.next/standalone/apps/page-home/.next/static \
  && { [ -d apps/page-home/public ] && cp -r apps/page-home/public apps/page-home/.next/standalone/apps/page-home/public || true; }
ENV NODE_ENV=production
EXPOSE 4101
CMD ["node", "apps/page-home/.next/standalone/apps/page-home/server.js"]
