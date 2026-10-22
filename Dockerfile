FROM node:22.23.4-alpine3.24@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS base
RUN apk upgrade --no-cache

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV DATA_DIR=/app/data

RUN addgroup --system --gid 1001 notes && adduser --system --uid 1001 notes
COPY --from=builder --chown=notes:notes /app/public ./public
COPY --from=builder --chown=notes:notes /app/.next/standalone ./
COPY --from=builder --chown=notes:notes /app/.next/static ./.next/static
COPY --from=builder --chown=notes:notes /app/scripts ./scripts
RUN mkdir -p /app/data && chown -R notes:notes /app/data

USER notes
EXPOSE 3000
CMD ["node", "server.js"]
