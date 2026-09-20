FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.mjs ./
ENV PORT=8080
ENV WHISPER_MODEL=onnx-community/whisper-tiny
ENV HF_HOME=/tmp/huggingface
EXPOSE 8080
CMD ["npm","start"]