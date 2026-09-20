FROM node:20-bookworm-slim AS whisper-build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl git make g++ cmake build-essential && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git /opt/whisper.cpp && cmake -S /opt/whisper.cpp -B /opt/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DGGML_AVX=OFF -DGGML_AVX2=OFF -DGGML_AVX_VNNI=OFF -DGGML_AVX512=OFF -DGGML_FMA=OFF -DGGML_F16C=OFF -DGGML_BMI2=OFF -DGGML_SSE42=OFF && cmake --build /opt/whisper.cpp/build --config Release -j2
RUN mkdir -p /opt/whisper.cpp/models && curl -L --fail --retry 3 -o /opt/whisper.cpp/models/ggml-tiny-q5_1.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny-q5_1.bin?download=true
RUN test -x /opt/whisper.cpp/build/bin/whisper-cli && cp -L /opt/whisper.cpp/build/bin/whisper-cli /opt/whisper-cli

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