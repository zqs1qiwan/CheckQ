# 数据存储与备份评估

> 2026-11-10 · 评估当前 JSON 文件存储的成熟度与改进项。

## 1. 当前架构

```
/data
├── flows.json      任务定义（含 nodes/edges/vars/log/notify）
├── runs.json       运行记录（每 flow 最近 500 条）
├── templates.json  模板
└── meta.json       密码 hash / API Key / AI 配置 / 每日汇总配置
```

- 写入：`#persist` 400ms 节流 → 原子写（tmp + rename）；
- 读取：启动时全量载入内存，运行期内存操作；
- 备份：`GET /api/system/backup` 导出全部 JSON；`POST /api/system/restore` 以新 ID 导入（停用）；
- 恢复：前端「恢复」弹窗，支持选择文件。

## 2. 成熟度评估

| 维度 | 评级 | 说明 |
|---|---|---|
| 原子性 | ✅ 良 | tmp+rename，不会写半截文件 |
| 一致性 | ✅ 良 | 单进程内存 + 文件，无并发写 |
| 持久性 | ⚠️ 中 | 400ms 节流窗口内被 SIGKILL 会丢最近变更；已加 SIGTERM/SIGINT flush |
| 容量 | ⚠️ 中 | runs.json 每 flow 500 条上限，长期仍会增长；flows/templates 无上限 |
| 备份 | ⚠️ 中 | 手动导出，无自动定时备份 |
| 加密 | ✅ 良 | 密码 scrypt；API Key 明文存 meta（本地可信目录） |
| 迁移 | ❌ 弱 | 无版本号/迁移脚本，结构变更靠兼容读取 |

## 3. 已实施改进（2026-11-10）

- **进程退出 flush**：`startServer` 监听 SIGTERM/SIGINT，先 `store.flush()` 再退出；
- `docker restart` / 正常停止不再丢配置。

## 4. 建议改进（按优先级）

| 优先级 | 改进 | 说明 |
|---|---|---|
| P0 | 自动每日备份 | 新增 `GET /api/system/backup?download=1` 定时任务，或复制 `data/` 快照到备份目录 |
| P0 | 写入关键操作后立即 flush | 创建/更新/删除任务、改密、改 API Key 后立即落盘（跳过节流） |
| P1 | runs 轮转 | 按天/按大小归档旧运行（如保留 30 天） |
| P1 | meta 版本号 | `meta.version` + 启动迁移脚本，结构变更可平滑升级 |
| P2 | SQLite 可选 | 若任务/运行规模增长，可切换 better-sqlite3（单文件、事务、查询快） |

## 5. 备份操作手册

```bash
# 手动备份（在容器内）
docker exec checkq tar -czf /data/backup-$(date +%F).tgz -C /data flows.json runs.json templates.json meta.json
# 复制到宿主机
docker cp checkq:/data/backup-2026-11-10.tgz /mnt/nvme0n1-4/checkq/backups/

# 恢复：网页「更多 → 恢复」选择 backup JSON；或 API
curl -X POST http://host:18888/api/system/restore -H 'Content-Type: application/json' --data @backup.json
```

> 注意：恢复会生成新 ID 且任务默认停用，避免与现有任务冲突。
