FROM node:20-bookworm-slim AS whisper-build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git make g++ cmake build-essential && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /opt/whisper.cpp && make -C /opt/whisper.cpp -j2
RUN mkdir -p /opt/whisper.cpp/models && curl -L --fail --retry 3 -o /opt/whisper.cpp/models/ggml-tiny-q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin?download=true
RUN test -x /opt/whisper.cpp/build/bin/whisper-cli

FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl && rm -rf /var/lib/apt/lists/*
COPY --from=whisper-build /opt/whisper.cpp /opt/whisper.cpp
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.py ./
ENV PORT=8080
ENV WHISPER_MODEL=tiny
ENV PATH=/opt/whisper.cpp/build/bin:$PATH
EXPOSE 8080
CMD ["npm","start"]