# CheckQ 现状与坑

- 仓库 `/opt/data/checkq`，GitHub `zqs1qiwan/CheckQ`，v0.2+。
- 前端 React + Vite 手写 UI，**不换 Kumo**（老白确认过）。
- set 节点格式 `{name, value}`，单值。
- 引擎单链 `Pick` 必须接在链尾；`browser_click` 不触发 React，需走 CDP。
- 跨包引用要在 Dockerfile 补 `COPY`。
- 差距清单见 `docs/GAP-ANALYSIS.md`。
