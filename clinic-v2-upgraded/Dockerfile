FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Folder data persisten (attach a Railway Volume at /app/data via the dashboard)
RUN mkdir -p /app/data

ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000

CMD ["node", "server.js"]
