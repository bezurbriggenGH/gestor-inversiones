# Imagen única: compila el frontend y lo sirve desde el mismo servidor Express.
FROM node:24-slim

WORKDIR /app
COPY server/package*.json server/
COPY client/package*.json client/
RUN npm ci --prefix server --omit=dev && npm ci --prefix client

COPY server server
COPY client client
RUN npm run build --prefix client

ENV NODE_ENV=production \
    PORT=3001 \
    DATA_DIR=/data
# La base de datos SQLite vive en /data: montá ahí un volumen para no perderla
VOLUME /data
EXPOSE 3001
CMD ["node", "server/src/index.ts"]
