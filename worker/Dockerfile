FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip ca-certificates curl unzip && rm -rf /var/lib/apt/lists/*
RUN python3 -m pip install --no-cache-dir --break-system-packages vosk && python3 -c "import vosk; print(vosk.__file__)"
RUN mkdir -p /opt/vosk-model && curl -L --fail --retry 3 -o /tmp/vosk.zip https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip && unzip -q /tmp/vosk.zip -d /opt && mv /opt/vosk-model-small-en-us-0.15/* /opt/vosk-model/ && rmdir /opt/vosk-model-small-en-us-0.15 && rm /tmp/vosk.zip
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js transcribe.py ./
ENV PORT=8080
ENV VOSK_MODEL_DIR=/opt/vosk-model
ENV WHISPER_MODEL=tiny
EXPOSE 8080
CMD ["npm","start"]