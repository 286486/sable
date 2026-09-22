---
status: accepted
date: 2026-09-22
---

# core 用 TypeScript 实现，WASM 只用于几何热点

`core`（文档模型、命令、事务、查询、schema）必须同时运行在浏览器、Node stdio 进程和 Cloudflare Durable Object 三处，而 MCP 工具的 zod schema、UI 属性面板和文档 JSON 三者需要同源类型。因此 core 用 TypeScript 写，不走 Penpot / Graphite 的 Rust + WASM 路线；只有几何热点（Skia PathOps 布尔与描边轮廓、HarfBuzz 文字整形、resvg / CanvasKit 渲染）使用现成的 WASM 模块。

## Considered Options

- **Rust core + WASM，TS 只做胶水**：渲染性能好，但 Graphite 的经验表明收益主要在渲染而非文档模型；类型需在 Rust 与 TS 之间生成并同步，DO 内调试困难。
- **全 TypeScript，几何也自研**：布尔运算的精度问题（Paper.js 长期未修的边界 bug）证明不值得重做。

## Consequences

- 渲染性能瓶颈通过替换 `render` 包的后端解决（Canvas2D → CanvasKit），不通过重写 core。
- core 的 CI 必须在 `workerd` 中跑测试，禁止依赖 Node 专有 API。
- 若将来 core 性能确实不足，迁移成本高；这是有意接受的取舍。
