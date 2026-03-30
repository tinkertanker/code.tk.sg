FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN rm -rf node_modules && npm ci --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 haste && \
    adduser --system --uid 1001 haste

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/static ./static
COPY --from=builder /app/about.md ./about.md
COPY --from=builder /app/example.config.js ./example.config.js

RUN chown -R haste:haste /app
USER haste

ENV NODE_ENV=production
EXPOSE 7777
CMD ["node", "server.js"]
