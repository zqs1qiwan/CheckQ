# ---- web build ----
FROM node:22-alpine AS webbuild
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --fund=false
COPY web/ ./
# PickPanel 引用共享的 text-regex 模块（仓库根/server/src），web 目录内需可解析
COPY server/src/text-regex.js /server/src/text-regex.js
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
