FROM node:20-alpine

WORKDIR /app
COPY package.json /app/package.json
COPY server.js /app/server.js
COPY db /app/db

RUN npm install --production

ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

CMD ["node", "server.js"]
