FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-trade... build
ENV NODE_ENV=production
EXPOSE 4103
CMD ["node", "apps/page-trade/.next/standalone/apps/page-trade/server.js"]
