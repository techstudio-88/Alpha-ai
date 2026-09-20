FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp gdown
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.mjs ./
ENV PORT=8080
ENV WHISPER_MODEL=onnx-community/whisper-tiny
ENV HF_HOME=/tmp/huggingface
EXPOSE 8080
CMD ["npm","start"]