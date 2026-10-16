# Launcher/auth service only. Native Luanti and its protocol proxy are separate.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server/ ./server/
COPY public/ ./public/
RUN mkdir -p /app/runtime/world && chown -R node:node /app/runtime
USER node
ENV HOST=0.0.0.0 PORT=3000 WORLD_DIR=/app/runtime/world
EXPOSE 3000
CMD ["node", "server/index.mjs"]
