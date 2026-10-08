FROM node:20-alpine

RUN corepack enable && corepack prepare pnpm@9 --activate

WORKDIR /app

COPY . .

RUN pnpm install --no-frozen-lockfile

RUN pnpm --filter @workspace/api-server build

EXPOSE 8080

CMD sh -c "cd /app && pnpm --filter @workspace/db exec drizzle-kit push --force || true; cd /app/artifacts/api-server && pnpm start"
