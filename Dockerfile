FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY worker/package.json ./package.json
RUN npm install --omit=dev
COPY worker/server.js ./server.js
COPY worker/transcribe.mjs ./transcribe.mjs
ENV PORT=10000
ENV WHISPER_MODEL=onnx-community/whisper-tiny
ENV HF_HOME=/tmp/huggingface
EXPOSE 10000
CMD ["npm","start"]
