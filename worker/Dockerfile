FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.mjs warmup-whisper.mjs /app/
RUN node /app/warmup-whisper.mjs
RUN test -f /app/transcribe.mjs
ENV PORT=8080
ENV WHISPER_MODEL=onnx-community/whisper-tiny
ENV HF_HOME=/root/.cache/huggingface\nENV TRANSFORMERS_CACHE=/root/.cache/huggingface\nENV HF_HUB_DISABLE_TELEMETRY=1
EXPOSE 8080
CMD ["npm","start"]