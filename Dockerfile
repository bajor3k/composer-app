# Composer — container image for Azure App Service / Container Apps.
#
# Node runtime is required, not edge: the app uses node:crypto (cron-secret check) and
# Buffer for attachment decoding. next.config.ts already sets output:"standalone",
# so the runtime stage copies a self-contained server instead of node_modules.

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate`, which writes the client into src/generated.
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build-time env. Supabase's NEXT_PUBLIC_* values are inlined into the client bundle,
# so they must be present here; everything else is read at runtime.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Non-root, matching the image's built-in node user.
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000

# DefaultAzureCredential picks up the managed identity assigned to the container, so
# no AI credential needs to be baked in or passed as an environment variable.
CMD ["node", "server.js"]
