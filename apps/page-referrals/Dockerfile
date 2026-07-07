FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-referrals... build
# Next `output: "standalone"` does NOT copy `.next/static` (client JS chunks) or
# `public` into the standalone tree; the standalone server serves them from
# alongside server.js, so copy them in or every /_next/static request 404s and
# no client asset resolves.
RUN cp -r apps/page-referrals/.next/static apps/page-referrals/.next/standalone/apps/page-referrals/.next/static \
  && { [ -d apps/page-referrals/public ] && cp -r apps/page-referrals/public apps/page-referrals/.next/standalone/apps/page-referrals/public || true; }
ENV NODE_ENV=production
EXPOSE 4107
CMD ["node", "apps/page-referrals/.next/standalone/apps/page-referrals/server.js"]
