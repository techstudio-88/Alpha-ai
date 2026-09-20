FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --break-system-packages yt-dlp gdown faster-whisper
WORKDIR /app
COPY worker/package.json ./package.json
RUN npm install --omit=dev
COPY worker/server.js ./server.js
COPY worker/transcribe.py ./transcribe.py
ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
