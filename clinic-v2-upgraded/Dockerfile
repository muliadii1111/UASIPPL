FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Folder data persisten (mount sebagai volume saat deploy agar data tidak hilang)
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000

CMD ["node", "server.js"]
