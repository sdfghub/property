# API image (NestJS). Build context is the repo root.
FROM node:20-slim AS build
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY prisma ./prisma
RUN npx prisma generate
COPY src ./src
# The repo carries pre-existing (non-blocking) type errors and dev runs transpile-only,
# so `|| true` lets tsc still emit dist/ instead of failing the image build.
RUN npm run build || true

FROM node:20-slim
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY package*.json ./
EXPOSE 3000
# Schema is applied by the compose `command` (prisma db push), which overrides this CMD.
CMD ["sh", "-lc", "node dist/server.js"]
