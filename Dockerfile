FROM node:22-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
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
