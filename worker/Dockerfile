FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl git cmake build-essential && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /opt/whisper.cpp && cmake -S /opt/whisper.cpp -B /opt/whisper.cpp/build -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON && cmake --build /opt/whisper.cpp/build --config Release -j2 --target whisper-cli && bash /opt/whisper.cpp/models/download-ggml-model.sh tiny
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.py ./
ENV PORT=8080
ENV WHISPER_MODEL=tiny
EXPOSE 8080
CMD ["npm","start"]