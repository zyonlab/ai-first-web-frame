FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-home... build
ENV NODE_ENV=production
EXPOSE 4101
CMD ["node", "apps/page-home/.next/standalone/apps/page-home/server.js"]
