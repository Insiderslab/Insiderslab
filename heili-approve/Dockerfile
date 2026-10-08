# Approve by Heili — immagine Docker unica per web, worker e cron
#
# Three runtime processes ship from this image (see docker-compose.prod.yml):
#   - web:    `npm run start`  → next start (needs .next + node_modules)
#   - worker: `npm run worker` → tsx worker/approval-worker.ts (runs RAW
#             TypeScript, not a bundled output — needs the generated Prisma
#             client, the source tree under lib/ and worker/, and tsconfig.json
#             for the `@/*` path alias tsx resolves at runtime)
#   - cron:   `sh scripts/cron.sh` → calls /api/cron/sweep every 5 minutes and
#             /api/cron/reminders hourly. Needs wget, which node:24-slim lacks.
#
# Uploaded media live on disk under UPLOAD_DIR (/data/uploads): mount the SAME
# volume in web (serves /media/... and receives uploads) and worker.
#
# next.config.ts does not set `output: "standalone"`, so `next start` needs the
# full node_modules tree at runtime; this Dockerfile does not try to slim it.

FROM node:24-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# `npm run build` = `prisma generate && next build` (see package.json) —
# generates app/generated/prisma AND compiles .next/ in one step.
RUN npm run build

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV UPLOAD_DIR=/data/uploads

# wget for scripts/cron.sh and the compose healthcheck; openssl for Prisma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget ca-certificates openssl ffmpeg \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /data/uploads

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/app/generated ./app/generated
COPY --from=build /app/public ./public
COPY --from=build /app/lib ./lib
COPY --from=build /app/worker ./worker
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
# Default: the web process. The worker overrides it with
# `command: ["npm", "run", "worker"]`, the cron with `["sh", "scripts/cron.sh"]`.
CMD ["npm", "run", "start"]
