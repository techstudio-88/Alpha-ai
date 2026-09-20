FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl git cmake build-essential && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /opt/whisper.cpp && make -C /opt/whisper.cpp -j2 && test -x /opt/whisper.cpp/build/bin/whisper-cli && curl -L --fail --retry 3 -o /opt/whisper.cpp/models/ggml-tiny-q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin?download=true
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.py ./
ENV PORT=8080
ENV WHISPER_MODEL=tiny
EXPOSE 8080
CMD ["npm","start"]