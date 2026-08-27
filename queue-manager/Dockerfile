FROM node:20-alpine

WORKDIR /app
COPY package.json /app/package.json
COPY queue-manager.js /app/queue-manager.js

RUN npm install --production

ENV DATA_DIR=/data
ENV RECORDINGS_DIR=/recordings
ENV POLL_INTERVAL_MS=10000
ENV STALE_JOB_TIMEOUT_MS=300000
ENV CLEANUP_DAYS=7

CMD ["node", "queue-manager.js"]
