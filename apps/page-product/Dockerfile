FROM node:22-alpine
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/page-product... build
ENV NODE_ENV=production
EXPOSE 4102
CMD ["node", "apps/page-product/.next/standalone/apps/page-product/server.js"]
