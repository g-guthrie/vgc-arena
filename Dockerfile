# Public deployment: mount a volume at /data so the stats database survives restarts.
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
COPY scripts ./scripts
# postinstall fetches and builds the pinned simulator
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
ENV HOST=0.0.0.0 PORT=3170 VGC_ARTIFACTS=/data
VOLUME /data
EXPOSE 3170
CMD ["node", "src/server.mjs"]
