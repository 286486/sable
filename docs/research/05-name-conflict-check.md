# 调研五：产品名冲突核查（Sable 及备选）

> **结论（2026-09-23）**：弃用 Sable，更名 **Zibel**。本报告保留原始核查记录。

> 事实核查：Sonnet subagent + 本地 curl，2026-09-22/23。商标库均为 JS 渲染页面，自动抓取被阻，需手工查询。

## Sable

**同名软件 / 开发工具**
- sablejs（ErosZy/sablejs）：沙箱 JS 运行时，1,124★ — https://github.com/ErosZy/sablejs
- Sable（SableClient/Sable）：Matrix 客户端，463★ — https://github.com/SableClient/Sable
- sabledb：Valkey 兼容数据库，457★ — https://github.com/sabledb-io/sabledb
- SableCC：编译器生成器，156★ — https://github.com/SableCC/sablecc
- Libera-Chat/sable：IRC 服务器，133★
- **Sable AI**（withsable.com）："AI employee" 平台，npm scope `@sable-ai/*`（react、sdk-core、voice-agent、text-agent、core），面向开发者的 Agent SDK。**与本项目目标受众（开发者 + Agent 使用者）重叠**。
- Sable UI（sable-ui.com，npm `sable-ui`）：React / WebGL 组件与 shader 库，自称 "AI-ready"。
- sable-cli：终端 coding agent — https://sable.rotur.dev
- 未发现名为 Sable 的矢量绘图 / 设计工具。

**包名与域名**
- npm `sable`：已占（HTTP dev server）；scope `@sable/` 无包，但 `@sable-ai/*`、`@sableclient/*` 活跃。
- PyPI `sable`：已占（SQL 测试工具）；crates.io `sable`：已占（游戏引擎，2025-12）；Homebrew：无。
- sable.dev 已注册（无站点）；sable.app 停放待售；sable.design 是一家传播机构的活跃站点；sable.tools 已注册；getsable.com 已注册（2026-01）；sable.sh 未能核实。

**非软件品牌**：Sable（Shedworks 开放世界游戏）、Mercury Sable（福特汽车）、Bon Iver 2024 EP。

**商标**：USPTO / EUIPO / WIPO 需手工查询：
- https://tmsearch.uspto.gov/search/search-information?query=SABLE
- https://euipo.europa.eu/eSearch/
- https://branddb.wipo.int/branddb/en/

**结论：冲突 MEDIUM-HIGH。** 法律风险不高（同名者多为小项目、不同类别），但 Sable AI 在同一受众里已有品牌，且干净的包名与短域名全部不可得。

## 备选核查

| 名称 | 含义 | npm | PyPI | crates.io | .dev / .app | GitHub 同名仓库 | 其他 |
|---|---|---|---|---|---|---|---|
| **Kolinsky** | 貂毫画笔的真实名称（Kolinsky sable） | 空 | 空 | 空 | 均未注册 | 5 个零星小仓库 | 是艺术材料通用词，在绘图工具类别申请商标可能被以"描述性"驳回 |
| **Zibel** | 德语 Zobel / 法语 zibeline（貂）的短拼 | 空 | 空 | 空 | 均未注册 | 45 个，均为人名或无关 | 自造词，无描述性问题 |
| **Zibeline** | 法语"貂 / 貂皮" | 空 | 空 | 空 | 均未注册 | 18 个零星 | 词稍长（8 字母） |
| Vexel | vector + pixel | 已占（2013 voxel 包） | 已占 | 已占 | 均已注册 | 336 个，含 lvivski/vexel（图片转矢量，12★） | 冲突 MEDIUM |
| Martes | 貂的拉丁属名 | 空 | 空 | — | 未注册 | 2,499 个（西班牙语"星期二"） | 噪音太大 |

RDAP 结果 404 = 未注册（rdap.org，跟随重定向后）。商标状态均未查。
