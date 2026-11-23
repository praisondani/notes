FROM node:22.23.5-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a AS base
LABEL org.doorkeeperlabs.security.node_base="node:22.23.5-alpine3.24@sha256:1314fb30ec37592d5845e5a160d522c0e680972aa534549940b8d73bde88481a" org.doorkeeperlabs.security.node_version="v22.23.5"
RUN apk upgrade --no-cache

FROM base AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor/braces ./vendor/braces
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
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
        /opt/yarn-v1.22.22 \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
        /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/pnpm
COPY --from=builder --chown=notes:notes /app/public ./public
COPY --from=builder --chown=notes:notes /app/.next/standalone ./
COPY --from=builder --chown=notes:notes /app/.next/static ./.next/static
COPY --from=builder --chown=notes:notes /app/scripts ./scripts
RUN mkdir -p /app/data && chown -R notes:notes /app/data

USER notes
EXPOSE 3000
CMD ["node", "server.js"]
