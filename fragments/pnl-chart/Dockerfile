FROM node:22-alpine
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @mvp/fragment-pnl-chart... build
ENV NODE_ENV=production
EXPOSE 4214
CMD ["pnpm", "--filter", "@mvp/fragment-pnl-chart", "start"]
