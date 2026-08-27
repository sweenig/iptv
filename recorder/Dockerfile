FROM node:20-alpine

# Install FFmpeg
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package.json /app/package.json
COPY recorder.js /app/recorder.js

RUN npm install --production

ENV DATA_DIR=/data
ENV RECORDINGS_DIR=/recordings
ENV POLL_INTERVAL_MS=3000
ENV HEARTBEAT_INTERVAL_MS=30000

CMD ["node", "recorder.js"]
