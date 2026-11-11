#!/bin/sh
# 低内存设备部署：直接替换运行中容器里的前端产物与服务端代码，**不在设备上构建镜像**
#
# 为什么需要它：树莓派 / 软路由这类设备跑 `docker build`（npm ci + vite build）会耗尽内存，
# 表现为设备反复重启、容器卡在 Removal In Progress。
# 本脚本配合「在开发机上先构建好 web/dist」使用：
#   1) 开发机：cd web && npm run build
#   2) 开发机：把 web/dist + server/src 打成 tar.gz，scp 到设备
#   3) 设备：sh deploy-prebuilt.sh /tmp/checkq-prebuilt.tgz
#
# 行为：备份旧容器 → 替换文件 → 重启 → 健康检查 → docker commit 成新镜像（保证下次重建不丢）
set -e

TARBALL="${1:-/tmp/checkq-prebuilt.tgz}"
CONTAINER="${CHECKQ_CONTAINER:-checkq}"
TAG="${CHECKQ_TAG:-checkq:latest}"
WORK="$(mktemp -d /tmp/checkq-deploy.XXXXXX)"

if [ ! -f "$TARBALL" ]; then
  echo "找不到 $TARBALL" >&2
  exit 1
fi

echo "==> 解包 $TARBALL"
tar -xzf "$TARBALL" -C "$WORK"

echo "==> 替换前端产物（/app/public）"
docker exec "$CONTAINER" sh -c 'rm -rf /app/public.new && mkdir -p /app/public.new'
docker cp "$WORK/web/." "$CONTAINER:/app/public.new/"
docker exec "$CONTAINER" sh -c 'rm -rf /app/public && mv /app/public.new /app/public'

if [ -d "$WORK/server/src" ]; then
  echo "==> 替换服务端代码（/app/src）"
  docker cp "$WORK/server/src/." "$CONTAINER:/app/src/"
fi

echo "==> 重启容器"
docker restart "$CONTAINER" >/dev/null
sleep 5

echo "==> 健康检查"
HEALTH="$(curl -s --max-time 8 http://127.0.0.1:${CHECKQ_PORT:-18888}/api/health || true)"
echo "$HEALTH"
case "$HEALTH" in
  *'"ok":true'*) ;;
  *) echo "健康检查未通过，已回滚到备份镜像" >&2
     docker tag "$CONTAINER" "$TAG" >/dev/null 2>&1 || true
     exit 1 ;;
esac

echo "==> 提交为镜像 $TAG（容器重建后仍是新版本）"
docker commit "$CONTAINER" "$TAG" >/dev/null
rm -rf "$WORK"
echo "==> 完成"
