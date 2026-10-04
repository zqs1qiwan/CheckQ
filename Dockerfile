# ---- web build ----
FROM node:22-alpine AS webbuild
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --fund=false
COPY web/ ./
RUN npm run build

# ---- server ----
FROM node:22-alpine
RUN apk add --no-cache curl
WORKDIR /app
ENV NODE_ENV=production PORT=8888 DATA_DIR=/data
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --fund=false
COPY server/ ./
COPY --from=webbuild /web/dist ./public
VOLUME /data
EXPOSE 8888
CMD ["node", "src/index.js"]
