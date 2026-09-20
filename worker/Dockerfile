FROM ghcr.io/ggml-org/whisper.cpp:main AS whisper
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=whisper /app/build /opt/whisper.cpp/build
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.py ./
ENV PORT=8080
ENV WHISPER_MODEL=tiny
ENV PATH=/opt/whisper.cpp/build/bin:$PATH
EXPOSE 8080
CMD ["npm","start"]