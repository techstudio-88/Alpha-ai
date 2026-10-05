FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 python3-pip fonts-dejavu-core && python3 -m pip install --no-cache-dir --break-system-packages -U "gdown" "yt-dlp[default]" && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/package*.json ./
RUN npm ci --omit=dev
COPY worker/ ./worker/
COPY lib/video-workflow.mjs ./lib/video-workflow.mjs
COPY lib/credential-cipher.mjs ./lib/credential-cipher.mjs
ENV PORT=10000
EXPOSE 10000
CMD ["node","worker/server.js"]
