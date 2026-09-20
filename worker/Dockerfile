FROM node:20-bookworm-slim AS whisper-build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tar && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /opt/whisper.cpp && curl -L --fail --retry 3 -o /tmp/whisper.tar.gz https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.4/whisper-bin-ubuntu-x64.tar.gz && tar -xzf /tmp/whisper.tar.gz -C /opt/whisper.cpp --strip-components=1 && rm /tmp/whisper.tar.gz
RUN mkdir -p /opt/whisper.cpp/models && curl -L --fail --retry 3 -o /opt/whisper.cpp/models/ggml-tiny.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin?download=true
RUN test -x /opt/whisper.cpp/whisper-cli && cp -L /opt/whisper.cpp/whisper-cli /opt/whisper-cli

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=whisper-build /opt/whisper.cpp /opt/whisper.cpp
COPY --from=whisper-build /opt/whisper-cli /usr/local/bin/whisper-cli
RUN chmod +x /usr/local/bin/whisper-cli
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.py ./
ENV PORT=8080
ENV WHISPER_MODEL=tiny
ENV PATH=/opt/whisper.cpp/build/bin:$PATH
EXPOSE 8080
CMD ["sh","-c","ls -l /usr/local/bin/whisper-cli /opt/whisper.cpp/build/bin/whisper-cli 2>&1 || true; npm start"]