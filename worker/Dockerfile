FROM ghcr.io/ggml-org/whisper.cpp:main
USER root
RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates curl ffmpeg xz-utils && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://nodejs.org/dist/v20.19.5/node-v20.19.5-linux-x64.tar.xz | tar -xJ --strip-components=1 -C /usr/local
RUN (command -v whisper-cli || command -v main) > /opt/whisper-bin-path && test -x "$(cat /opt/whisper-bin-path)"
WORKDIR /app-alpha
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.py ./
ENV PORT=8080
ENV WHISPER_MODEL=tiny
EXPOSE 8080
CMD ["npm","start"]