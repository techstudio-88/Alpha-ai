FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl python3 python3-pip yt-dlp && python3 -m pip install --no-cache-dir --break-system-packages gdown && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/package.json ./package.json
RUN npm install --omit=dev
COPY worker/server.js ./server.js
ENV PORT=10000
EXPOSE 10000
CMD ["npm","start"]