# 调研二：Web 矢量图形编辑器技术栈与竞品分析

> 调研执行：Sonnet subagent，2026-09-22。未核实/存在冲突的信息见文末。

## 1. 竞品与开源参照 (Competitors & Open-Source References)

### 1.1 Figma
- **渲染技术**：早期（2015 起）自研 **WebGL** tile-based 渲染引擎，核心用 C++ 编写并通过 Emscripten 编译为 **WebAssembly**；2023-2026 年起逐步迁移到 **WebGPU**（基于 Google Dawn），理由是 compute shader、更清晰的错误处理、避免 WebGL 的"易出错全局状态"，并保留 WebGL 自动回退（含 GPU 丢失恢复）。官方博客明确指出拒绝 HTML/SVG DOM 方案，因其"因 DOM 访问而慢得多"、遮罩/模糊/混合模式跨浏览器不一致（figma.com/blog/building-a-professional-design-tool-on-the-web）。WASM 化后加载时间提升 3 倍（官方数据）。
- **文档模型**：场景图（frame/group/vector node），multiplayer 同步层是扁平的 `(ObjectID, Property, Value)` 三元组表，父子关系通过子对象的 parent 属性 + **分数索引（fractional indexing）**表达，非 OT、非严格 CRDT，而是"服务器为中心的按属性最后写入胜出"模型（figma.com/blog/how-figmas-multiplayer-technology-works）。文档进程 2023 年后由 Node/TS 重写为 **Rust**，序列化性能提升 10 倍以上。
- **许可**：闭源商业 SaaS。
- **插件沙箱**：经历三代——iframe 沙箱（因大文档序列化耗时达 14s 被否）→ Realms shim（with + Proxy 膜隔离）→ 2024 年官方博客确认因 Realms 沙箱逃逸漏洞迁移至 **QuickJS**（C 编写、编译为 WASM 的轻量 JS 引擎），代价是部分插件变慢但更安全（figma.com/blog/an-update-on-plugin-security）。UI 运行在 null-origin iframe，与沙箱通过 postMessage 通信。
- **官方 MCP**：**Dev Mode MCP Server**（developers.figma.com/docs/figma-mcp-server）为**双向**——既可读取设计上下文生成代码，也可直接在画布上创建/修改 frame、组件、变量、Auto Layout，并与 Code Connect 集成复用真实设计系统组件。
- **对比 Illustrator 的差距**：布尔运算在边缘情况下被用户反馈"不稳定"；基本无 CMYK 色彩管理、无出血/裁切线、无专色，print 场景基本空白。

### 1.2 Penpot
- **渲染技术**：历史上纯 **SVG DOM**；2025-2026 年官方博客"Penpot's new rendering system"披露迁移到 **Rust + WebAssembly**（借助 skia-safe 绑定 Skia，over WebGL）自研渲染引擎，核心动机与 Figma 一致——"浏览器对 SVG 无限画布的 DOM 管理力不从心，性能根本不够"。采用游戏引擎式的**瓦片（tile-based）渲染**：仅渲染可视视口、预测缓存邻近瓦片、内存不足时淘汰最远瓦片。截至所见信息该功能以 opt-in beta（`?wasm=true`）形式发布，是否已默认开启需以发布时最新状态为准。官方未公布量化前后性能数字（仅定性描述"面板拖拽更流畅"）。
- **文档模型/格式**：设计即标准 SVG + CSS/HTML/JSON，`.penpot` 文件可读、可版本控制。核心抽象是 **Container**（Page 与 Component 共享，均持有 ShapeTree），每个 Shape 对应一个 SVG 节点 + Penpot 专有元数据扩展；组件实例通过 `sync-attrs`/"touched" 标记记录局部覆盖。
- **技术栈**：前端 **ClojureScript**（React，经 rumext），全局状态用 Redux 式的事件流（potok 库）+ RX streams；后端 Clojure/JVM + PostgreSQL；渲染层新增 Rust/WASM——三语言混合栈，属实。
- **许可**：**MPL-2.0**，完全开源、可自托管。
- **插件/MCP**：有官方 Plugins API；**官方 MCP server**（github.com/penpot/penpot-mcp，penpot.app/ai/mcp-server）通过 WebSocket 与 Penpot 通信，支持读取设计数据、修改元素、在工作区直接创建新结构，覆盖组件/样式/tokens/页面/图层的双向工作流。另有多个第三方 MCP（如声称 66 个工具的 ancrz/penpot-mcp-server）。

### 1.3 Excalidraw
- **渲染**：**Canvas2D** + rough.js 实现手绘风格；架构简单（无 GPU 加速场景图）。
- **文档模型**：扁平 **elements 数组**，每个元素是普通 JSON 对象（type/x/y/points…），开放 `.excalidraw` JSON 格式。Undo/redo 由 `History` 类（两个栈 undoStack/redoStack，基于差量 delta 反转）实现；多人协作用 `Portal` 类封装 Socket.IO，仅广播变更元素（版本号 diff），并对 payload 端到端加密。
- **许可**：**MIT**。
- **MCP**：**官方** `excalidraw-mcp`（github.com/excalidraw/excalidraw-mcp，MIT，托管于 mcp.excalidraw.com），支持自然语言驱动生成图表，兼容 Claude/ChatGPT/VS Code 等；另有大量社区 MCP 变体（26 个工具版本、实时画布同步等），反映出对"agent 可驱动 2D 画布"的强烈需求。
- **差距**：无真正贝塞尔路径编辑、无布尔运算、无色彩管理、无出版级排版——是白板/图表工具而非矢量编辑器，但其"扁平数组 + 极简 schema"是 agent 友好文档模型的重要参考。

### 1.4 tldraw
- **渲染**：每种 shape 通过 `ShapeUtil` 子类的 `component()` 渲染为 **React 组件产生的 HTML/SVG DOM**（非纯 canvas），导出走 `toSvg()` 管线；视口外元素通过 `display:none` 剔除（仍在 DOM 中）。
- **文档模型**：`Store`（`@tldraw/store`）管理类型化 **records**（shapes、bindings、assets），基于自研响应式信号库 **`@tldraw/state`**（前身 Signia：`atom`/`computed`/`react`）；每个 record 类型有 `up`/`down` 迁移的 schema 版本化（`@tldraw/tlschema`）。**Binding** 是独立、有方向（fromId/toId）的一等记录，而非嵌在 shape props 里的引用，带生命周期钩子。`Editor` API 提供细粒度 CRUD（createShape/updateShape/select/camera 等），是四个产品中最贴近"MCP 工具面"的既有设计。
- **许可**：**2025 年 9 月起重大变更**——生产环境需要 Trial / 非商用 Hobby（须显示"Made with tldraw"水印）/ 付费 Commercial（去水印）三选一，与其早期完全宽松开源定位形成对比（tldraw.dev/community/license）。
- **"Make Real"**：由 Figma 工程师 Sawyer Hood 发起的演示——草图 → GPT-4V → 生成 Tailwind/HTML/JS 原型，两周内 GitHub 10K+ star，是"画布 → AI → 真实 UI"范式的重要先例。
- **MCP**：官方托管远程 MCP server（`tldraw-mcp-app.tldraw.workers.dev/mcp`），实现 **MCP Apps 规范**——工具调用可返回**嵌入聊天窗口内的实时可交互 tldraw 画布**，画布状态变化又反馈进 agent 上下文，是四者中最先进的 MCP 设计模式。

### 1.5 其他产品与库速览

| 产品/库 | 渲染技术 | 文档模型/格式 | 许可证 | 亮点 | 对比 Illustrator 差距 | API/MCP |
|---|---|---|---|---|---|---|
| **Vectr** | 未公开，疑似 Canvas | 云端私有文档，导出 SVG/PNG/EPS/AI/PDF | 闭源，免费增值 | 协作、AI 矢量化/文生 SVG（Pixlr/Inmagine 旗下，2026 仍在运营） | 面向 logo/消费级，无专业路径工具、无色彩管理 | 无 |
| **Boxy SVG** | 原生浏览器 **SVG DOM** 操作 | 原生 SVG/SVGZ，支持 PDF 兼容导入 .ai | 闭源，约 $9.99 一次性/订阅 | 精确数值输入、文字沿路径、完整 SVG 滤镜编辑器 | 无布尔稳健性/无 print 工作流 | 有 Web Component 嵌入 API（非自动化脚本），无 MCP |
| **Vectornator/Linearity Curve** | 未知 | 专有 | 闭源订阅（$0-80+/月） | AI 矢量化、Motion 产品线（Linearity Move） | 官方仅列 Mac/iPad/iPhone，Web 版存在性存疑（cloud.linearity.io 提及但未核实） | 无 |
| **Gravit Designer/Corel Vector** | 疑似 Canvas/WebGL | 专有 | 闭源，曾免费增值 | 曾是最佳免费 Illustrator 替代 | **2025 年 8 月疑似已停运**，被 CorelDRAW Go 取代（未获 Corel 官方确认） | 无 |
| **Photopea** | 纯前端 JS + **Canvas2D**（文件不离开浏览器） | 兼容 PSD/XCF/Sketch/XD/CDR/SVG/PDF；矢量以 Path/Vector Mask/Shape Layer 存储 | 闭源，免费+广告/Premium $5/月 | 真正的钢笔/形状工具；**有文档化脚本 API**（`app.activeDocument` 类 Photoshop 对象模型）与 iframe embed API（URL hash 传参、自动运行脚本） | 光栅优先架构，矢量为附加能力 | 无官方 MCP，有质量未知的社区 MCP |
| **Canva** | 专有 | 专有云文档 | 闭源，免费增值 | 模板/素材驱动、面向大众 | 无贝塞尔级路径控制 | **官方 MCP**：`mcp.canva.com/mcp`，支持自然语言设计创建/编辑、资产上传、品牌套件、导出 PDF/PNG/PPTX/MP4 |
| **Inkscape**（桌面参照） | C++/gtkmm，Cairo 渲染，GTK3→GTK4 迁移中 | **原生 SVG**（含 Inkscape 命名空间扩展） | **GPL-2.0-or-later** | 最完整的开源矢量工具集，布尔运算、Live Path Effects | 无 CMYK/print、桌面专属 | Python 扩展系统 `inkex`；无官方 MCP，多个社区 D-Bus/CLI 封装 MCP（如 inkmcp） |
| **Method Draw / SVG-Edit** | 原生 **SVG DOM** | SVG | **MIT** | SVG-Edit 拆分出可编程无头核心 `@svgedit/svgcanvas`，v7 持续维护；Method Draw 已基本停滞（自 2021 起少有更新） | 大文档下无 GPU 加速，性能受限 | svgcanvas 可作为库嵌入，无 MCP |
| **Graphite (graphite.rs)** | **Rust → WASM**，GPU 管线用 **wgpu**，路径渲染调用 **Vello**（Linebender）；另用 kurbo（贝塞尔数学）、resvg/usvg、parley/skrifa（文字整形） | **节点图**（自研"Graphene"引擎），图层视图叠加其上，无损、可程序化 | **MIT OR Apache-2.0**（双许可） | 唯一原生非破坏性节点图编辑器，现代 GPU 管线，2025 年内已有原生桌面构建 | 仍处 **Alpha**，文档少，无插件/脚本/自动化面，无 print/CMYK 工作流 | **无任何插件/脚本/MCP** |
| **Polotno SDK** | **Konva/react-konva**（Canvas2D 场景图） | 中心化 `Store`，JSON 序列化，MobX/mobx-state-tree 驱动 | 闭源商业 SDK（$249-899+/月分级） | 面向"设计工具即产品"的商业底座，常被用作 AI 生成设计工具的基础 | Canvas 渲染无真矢量文档、无布尔运算、无 print | 丰富的 Store API/自定义元素扩展点，无 MCP |
| **Fabric.js** | Canvas2D 对象模型 | JSON 序列化 + SVG 导入导出 | **MIT** | 交互式对象模型成熟，TS 支持 | 无 UI、无排版引擎、无矢量原生文件格式 | 无 MCP |
| **Konva.js** | Canvas2D **场景图**（Stage→Layer→Group→Shape，每 Layer 独立 canvas） | — | **MIT** | 事件/拖拽/变换/缓存/动画完善；Polotno 与 konva.app 均构建其上 | 同上 | 无 MCP |
| **Paper.js** | Canvas2D，但具完整**保留模式场景图**（Project/Layer/Item/Path/Segment/Curve），源自 Scriptographer | 自有布尔运算算法 `PathItem.Boolean.js` | **MIT** | Unite/Intersect/Subtract/Exclude/Divide，是 JS 生态最常用的布尔路径实现 | **已基本停滞维护**（最新版 v0.12.18，2024-07），存在若干长期未修复的边界 bug（近重合点、自相交） | 纯库 API，无 MCP |

**关键结论**：12 个产品/库中仅 **Canva** 有官方 MCP；Figma、Penpot、tldraw、Excalidraw 各有官方 MCP（分属竞品分组一）；Photopea 有文档化脚本/嵌入 API；Inkscape 有多个社区 MCP 封装；其余均无 agent 可驱动接口。Graphite 是唯一原生非破坏性节点图 + 现代 Rust/WASM/GPU 架构的开源项目，但完全没有自动化能力，是极佳的架构参照而非集成对象。

---

## 2. 核心技术选型 (Core Technical Building Blocks)

### 2.1 渲染技术
| 方案 | 优点 | 缺点/失效边界 | 代表库（许可证） |
|---|---|---|---|
| **SVG DOM** | 零打包成本、天然可访问性、文档即导出格式 | 每次属性变更触发 style recalc/layout/paint；持续拖拽/缩放下低至几百节点即可造成卡顿（Penpot 社区案例：168 节点拖拽导致 3-6 秒 UI 冻结） | 浏览器原生 |
| **Canvas2D** | GPU 加速即时模式绘制，跨浏览器一致性较好 | 立即模式，每帧需重新提交几何（Figma 官方称"不必要的浪费"）；无原生场景图/拾取，需自建脏矩形与空间索引 | 浏览器原生 |
| **WebGL** | 批量合成，吞吐量高 | 需自建场景图、拾取、撤销等一切上层能力 | **PixiJS**（v8.21.0，MIT，统一管线优先 WebGPU 回退 WebGL2）；**Two.js**（v0.8.24，MIT，渲染后端可切换 SVG/Canvas/WebGL） |
| **WebGPU** | Compute shader、更清晰状态管理 | 跨浏览器支持仍不均衡（Chromium 优先）；生态尚不成熟 | **Vello**（Linebender，MIT/Apache-2.0 双许可，README 明确 GPU 计算管线仍属实验阶段）；**Rive Renderer**（MIT，路径转三角面片，支持 Metal/Vulkan/D3D/WebGL）；**CanvasKit/Skia-WASM**（Skia 本体 BSD-3-Clause，`canvaskit-wasm` 包体积实测约 7.0MB 原始/2.81MB gzip） |

**推荐结论**：Figma 与 Penpot 两个最成熟的生产级案例都独立得出相同结论——**SVG DOM 无法支撑交互式大文档操作**，均自研 GPU 渲染层。对于新项目建议：MVP/原型阶段可用 SVG DOM 或 Canvas2D（PixiJS/Two.js）快速验证；一旦目标是"数千对象持续交互"级别的专业编辑器，应规划自研或采用 CanvasKit/Vello 级别的 GPU 管线，且渲染后端应与文档模型解耦（可插拔）。

### 2.2 路径几何与布尔运算
布尔运算在贝塞尔曲线上天生困难：两条三次曲线最多可有 9 个交点，无解析解，需迭代数值方法（有精度截断）；近重合点会使拓扑分类翻转；自相交/重叠共线段破坏 winding-number 逻辑。业界两条技术路线：

1. **曲线原生布尔**（保真但脆弱）：**Paper.js**（MIT）直接在贝塞尔上操作，长期存在边界 bug（issue #786/#1074/#1149/#1939，近重合点/自相交导致崩溃或错误结果）；**Skia PathOps**（通过 CanvasKit，BSD-3-Clause）以 C++ 实现，被字体工具链 `fonttools/skia-pathops` 采用替代 pyclipper 以获得更高鲁棒性，是目前公认最稳健的曲线级方案。
2. **拉平为折线 + 整数/定点坐标**（鲁棒但需曲线拟合还原）：**Clipper/Clipper2**（Boost Software License 1.0，Angus Johnson）用缩放整数坐标获得有界 ±1 单位误差，是 CAD/CAM/GIS 领域最受信任的多边形布尔引擎，`ErikSom/Clipper2-WASM`（BSL-1.0）是较新的 WASM 移植；**polygon-clipping**（mfogel, MIT）与 **martinez**（w8r, MIT）实现 Martinez-Rueda-Feito 扫描线算法，但仅支持多边形，无曲线支持。

其他基础库：**flatten-js**（MIT，含 Arc 一等公民）、**bezier-js**（Pomax, MIT，弧长/切线/自相交检测等低层数学，但维护呼声较弱）、**svgpath**/**svg-path-commander**/**path-data-polyfill**（均 MIT，SVG path 字符串变换/归一化工具）。

**建议**：对正确性要求高的布尔操作，用 Clipper2-WASM 类整数折线裁剪 + 曲线重拟合，或若已为渲染引入 CanvasKit，直接复用其 PathOps；Paper.js 适合曲线保真优先、可接受边界情况风险的场景。

### 2.3 描边转轮廓/可变宽度描边
描边转填充路径的标准流程：沿中心线做 ±w/2 偏移得到两条边线 → 顶点处理拐角（miter/round/bevel）→ 端点处理（butt/round/square）→ 缝合 → **解决自相交与重叠**（最难环节）。`paperjs-offset`（MIT，`glenzli/paperjs-offset`）提供 `offsetStroke()` 及自适应/鲁棒/分裂等多种自相交清理算法；CanvasKit 暴露 `Path.stroke(opts)`（与 Chrome/Android 同源代码，鲁棒性最佳）。**可变宽度描边**（Illustrator Width Tool）无成熟开源实现——SVG 曾提出 `stroke-profile-*` 属性草案但从未被浏览器采纳；可参照 Figma 插件 API 的 `variableWidthPoints: [{position, width}]` 数据模型自建：在参数化间隔插值宽度，逐段偏移后复用上述自相交清理管线。

### 2.4 文字排版与字体处理
- **opentype.js**（MIT）：解析/生成 TTF/OTF/WOFF(2)，`Font.getPath()`/`Path.toSVG()` 可直接拿到字形轮廓；但只做基础从左到右逐字形排版+字距，**不是**完整 OpenType 整形引擎，不适合阿拉伯语连写/印度语重排等复杂文种。
- **harfbuzzjs**（MIT）：HarfBuzz C++ 编译为 WASM（体积约 434KB raw），是 Chromium/Firefox/Android/**Figma**/InDesign/Photoshop 等生产工具共用的整形引擎，处理连字、上下文替换、GPOS 字距，并可通过 `font.glyphToPath()` 直接产出轮廓。
- **fontkit**（MIT，PDFKit 内核）：自研 JS 版 OpenType 整形（GSUB/GPOS/AAT），无需 WASM 依赖，但对复杂文种正确性需自行核验。
- **文字转轮廓（Create Outlines）标准管线**：HarfBuzz 整形得到字形 ID 与位置 → 用同一字体文件的字形 ID 查表取轮廓（HarfBuzz 自带或交给 opentype.js）→ 按 fontSize/unitsPerEm 缩放并按笔位平移 → 合并为按字形或按文本行分组的复合路径。**渲染方式对比**：Canvas `fillText` 无法逐字形拾取编辑，只适合预览层；SVG `<text>` 矢量友好但拿不到轮廓；只有手动整形路线能同时保证复杂文种正确性与逐字形可编辑性——这正是 Illustrator/Figma/InDesign 的实际做法。

### 2.5 自由手绘 (Freehand)
标准管线：Pointer Events（原生支持压力 `pressure`/倾斜 `tiltX/tiltY`）采集原始点 → 简化（**Ramer–Douglas–Peucker** 或 **simplify-js**，Vladimir Agafonkin 作品）→ 拟合贝塞尔（**fit-curve**，基于 Philip J. Schneider 的 Graphics Gems 算法移植）→ 平滑输出。另一路线是 **perfect-freehand**（steveruizok，MIT，被 tldraw 与 Excalidraw 采用）：直接对输入点构建样条并按压力做逐点法向偏移，产出描边轮廓多边形（`getStroke()`），无需先拟合再描边两步走，是目前最广泛复用的开源方案。

### 2.6 命中测试、吸附、空间索引
**rbush**（Mourner，MIT）实现 R-tree 二维空间索引，支持"给定包围盒查询所有相交对象"，比逐一遍历快数百倍，是大量对象场景下命中测试/智能参考线吸附的标准基础设施。智能参考线一般通过维护各对象的边缘/中心/间距坐标集合，在拖拽时以容差阈值匹配最近候选并高亮实现（Figma/Illustrator 均为此类启发式方案，无公开算法细节）。

### 2.7 撤销/重做与并发模型
命令模式（记录可逆操作）与不可变快照对比：前者内存占用小但要求每个操作都实现逆操作；后者实现简单但大文档下快照成本高，tldraw 与 Excalidraw 均采用**差量（delta）式命令历史**折中方案。多人/人机协同编辑场景的 CRDT 选型：
- **Yjs**（MIT，22.8k star，被 Google/AWS/Evernote/Linear 等生产采用，网络无关、支持离线）——生态最成熟，适合作为默认选择；
- **Automerge**（MIT，Ink & Switch 主导，Automerge 3 在内存占用上有约 10 倍优化，JS 包被称为稳定版本，Rust 底层 API 相对底层未完全文档化）；
- **Loro**（MIT，Rust + WASM，借鉴 Yjs 的协同编辑合并算法与 Automerge 的列式编码策略，采用 Event Graph Walker 与 Fugue 文本算法，定位为更快的新一代方案，但未见其官方直接性能对比数据）。

对于"人类与 AI agent 并发编辑同一矢量文档"场景，Figma 式"服务器权威 + 按属性最后写入胜出"已证明足以支撑复杂度，无需完整 CRDT；若需要真正去中心化/离线优先能力，Yjs 因生态成熟度是最稳妥的起点，Loro 值得作为性能敏感场景的候选。

### 2.8 图表/图形生成与"图表转可编辑矢量"
Illustrator 原生 Graph Tool 生成的是特殊"图表对象"，用户可通过菜单"取消编组"将其拆解为普通可编辑矢量路径（柱状、扇形均变为独立路径对象）。Web 生态对应能力：**D3.js**（BSD-3-Clause 生态惯例，产出真实 SVG DOM，天然可作为矢量对象二次编辑）、**Vega-Lite/Vega/Observable Plot**（声明式图表语法，同样产出 SVG）。第三方"数据变图表"工具中，**Datawrapper**、**RAWGraphs**、**Flourish** 普遍支持导出 SVG（RAWGraphs 定位即"生成可在 Illustrator 中再编辑的矢量图表"），这与本项目"图表 → 可编辑矢量对象"的目标高度一致，实现路径可参考：用 D3/Vega 渲染出 SVG → 解析 SVG DOM 树 → 逐节点转换为本编辑器原生矢量对象（路径/组），保留图表的数据绑定作为可选元数据。

### 2.9 导入导出
- **SVG**：解析/序列化用 **svgson**（转 JSON 树）+ **SVGO**（MIT，SVG Optimizer，清理编辑器导出的冗余元数据/默认值）。
- **PDF**：**pdf-lib**（MIT，纯 JS 无原生依赖，可创建+修改现有 PDF、嵌入字体/图片/表单）是最灵活的选择；**jsPDF** 偏"从零生成"；**svg2pdf.js** 专注 SVG→PDF 转换，常与 jsPDF 搭配使用。
- **AI 格式**：Adobe Illustrator 的 `.ai` 本质是 **PDF 容器格式**（自 Illustrator 9 起），可选"PDF 兼容"保存以便非 Illustrator 程序读取基本内容，但其完整专有数据（图层、实时效果等）未公开完整规范，被广泛认为难以在第三方 Web 应用中做到高保真读写，建议仅以 PDF 兼容模式做最基本互通，不追求完整 .ai 私有数据兼容。
- **EPS**：基于 PostScript 的遗留格式，Microsoft Office 已于 2018 年因安全问题移除支持，现代编辑器可视为"仅导出兼容"的遗留需求，不建议作为核心投入方向。

### 2.10 图像描摹 (Image Tracing)
**potrace**（原始 C 库及其 Node/WASM 移植如 `node-potrace`）采用 **GPL-2.0** 许可，商业闭源产品集成需注意授权合规；**imagetracerjs**（**Unlicense/公有领域**）是纯 JS 实现，无授权顾虑，内置 16 种预设，是更适合商业项目直接集成的选择。

### 2.11 前端框架选型
tldraw 与 Excalidraw 均基于 **React**；Penpot 前端是 **ClojureScript**（通过 rumext 使用 React）+ 全局事件流状态管理（potok，Redux 式单一大状态树/事件流），非常规 React 生态但架构思路（集中状态 + 事件驱动变更）与 Redux/Zustand 高度相通。对于新项目，React + Zustand/Jotai 的组合足以复刻 tldraw/Excalidraw 的成功模式；SolidJS/Svelte 在大量细粒度响应式更新（如数千图形属性面板同步）场景下有细粒度更新优势，但生态与人才池不如 React 成熟，需权衡。

---

## 3. 架构模式参考 (Architecture Patterns)

- **tldraw**：`ShapeUtil` 类将"数据 schema（`static props` 校验器）+ 几何（`getGeometry()`）+ 渲染（`component()`）+ 生命周期"绑定在一起；**Binding 作为独立、带方向、类型化的一等记录**（而非嵌在 shape 属性里的引用），配合生命周期钩子在关联形状变化时自动更新/清理；`Store` 提供 `serialize()`/`loadStoreSnapshot()`/`migrateSnapshot()`，schema 版本化通过每记录类型的 `up`/`down` 迁移函数实现。**可借鉴**：ShapeUtil 的 `static props` 校验器可直接复用为 MCP 工具的 JSON Schema；关系作为独立记录便于 agent 单独查询/修改而不牵动宿主对象。
- **Excalidraw**：场景是**扁平的纯 JSON 元素数组**，无类实例、无循环引用，天然可 diff、可序列化——是"agent 可读文档模型"的理想简化范式；`History` 类严格区分持久场景数据（elements）与临时会话状态（AppState），只向外暴露前者；`Portal`/`ActionManager` 将业务逻辑收敛为"reducer 式" `(state, payload) => newState` 的具名 Action，几乎可以 1:1 映射为 MCP 工具处理函数。**可借鉴**：极简扁平数组 + 具名 Action 的映射关系，是构建"LLM 易于理解调用"的工具面的最佳起点范例。
- **Penpot**：Container 抽象（Page 与 Component 复用同一套 ShapeTree 逻辑）让同一套工具调用可同时作用于页面与可复用组件；"1 shape = 1 SVG 节点 + 命名空间扩展元数据"在保持核心图可移植/可 diff 的同时容许非标准特性；单一原子状态 + 命名事件流（potok）使每次变更都是可审计、可重放的具名事件——这与 MCP 工具调用的"具名、可审计"特性天然契合。
- **Figma**：扁平 `(ObjectID, Property, Value)` 模型 + parent-as-property + **分数索引**排序，让每次 agent 调用都能是原子的"设置对象 O 的属性 P"，整图可序列化为扁平 JSON；分数索引允许并发插入/重排而不必重新编号兄弟节点；**膜（membrane）/不透明句柄边界**——插件只能通过稳定 ID 经受限 API 访问节点，从不触碰原始结构指针，这既是 API 稳定性的保障，也是（如 QuickJS 迁移所示）值得用真实沙箱隔离的安全边界，若未来允许第三方脚本运行应予以借鉴。

**面向 headless、agent 可编写脚本的编辑器的共性结论**：四个产品无一例外收敛到"**扁平、以 ID 为键的记录存储**，树状结构以数据形式编码（而非嵌套对象图）"——这正是应交给 agent 的 scene graph 形态；关系类数据独立建模（bindings）+ 分数索引，是在不引入 OT/CRDT 复杂度前提下支持并发/增量编辑的两个关键模式；schema 版本化 + 迁移函数（tldraw、Penpot）是长期演进文档 schema 而不破坏历史文档的必要基础设施。

---

## 4. 性能基准/经验数字

- **SVG DOM**：无严谨官方基准，Penpot 官方定性表述"性能根本不够"；社区最具体案例是 Penpot 论坛报告的 **168 个 SVG 元素**在拖拽时导致 **3-6 秒** UI 冻结；d3.js 社区经验值约 **1,200-5,000 圆形元素**即出现明显卡顿；综合各方信息，持续交互（拖拽/缩放）场景下 SVG DOM 的可用上限大致在**几百到几千个活跃节点**之间，远低于静态展示场景可承受的数千节点。
- **Canvas2D（以 Excalidraw 为例）**：GitHub issue 报告（非官方基准）显示 **5,000+ 元素**开始明显卡顿；一份较量化的报告（M1 MacBook Air 16GB）显示 4k-8k 对象尚可，**8k 起吃力**，**10k-14k 降至约 30fps**（Chrome），**14k-24k** 在 Firefox 下已不可用。
- **WebGL（Figma）**：官方（Evan Wallace, "Building a professional design tool on the web"）未公布具体节点数/FPS 基准，仅陈述 60fps 为设计目标，以及自研渲染器规避了 DOM/Canvas2D 立即模式重复上传几何的开销；唯一公开量化数字是 WASM 化后**加载时间提升 3 倍**。
- **Penpot 2025 Rust/WASM 渲染引擎**：官方博客给出的动机是"SVG-based 无限画布性能不足"，采用瓦片渲染 + 视口裁剪；**未公布量化前后性能对比数字**，仅有定性描述与个别社区案例（同一文件从 SVG 渲染器下的卡顿到 WebGL 渲染器下"工作正常"）。

**综合结论**：目前没有任何主流产品公布过严谨的"节点数 vs FPS"官方基准，但所有公开信息一致指向同一结论——**SVG DOM 的可交互上限在几百至几千节点级别，Canvas2D 约在 5,000-10,000 级别开始明显退化，两家最成熟的生产级 Web 设计工具（Figma、Penpot）均独立得出"必须自建 GPU/WASM 渲染层才能支撑专业级大文档"的结论**。新项目在架构设计时应假设目标规模超过万级节点，并将渲染后端设计为可插拔，以便未来从 SVG/Canvas2D 原型平滑升级到 WebGL/WebGPU 生产渲染层。

---

## 5. 参考来源 (Sources Actually Fetched)

**Figma / Penpot / Excalidraw / tldraw**
https://www.figma.com/blog/figma-rendering-powered-by-webgpu/ ・ https://developers.figma.com/docs/figma-mcp-server/ ・ https://www.figma.com/blog/how-we-built-the-figma-plugin-system/ ・ https://developers.figma.com/docs/plugins/how-plugins-run ・ https://www.figma.com/blog/an-update-on-plugin-security/ ・ https://www.figma.com/blog/how-figmas-multiplayer-technology-works/ ・ https://madebyevan.com/figma/how-figmas-multiplayer-technology-works/ ・ https://www.figma.com/blog/rust-in-production-at-figma/ ・ https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/ ・ https://madebyevan.com/figma/building-a-professional-design-tool-on-the-web/ ・ https://www.figma.com/blog/webassembly-cut-figmas-load-time-by-3x/ ・ https://penpot.app/blog/penpots-new-rendering-system/ ・ https://penpot.app/ai/mcp-server ・ https://help.penpot.app/technical-guide/developer/data-model/ ・ https://help.penpot.app/technical-guide/developer/data-guide/ ・ https://help.penpot.app/technical-guide/developer/architecture/ ・ https://help.penpot.app/technical-guide/developer/architecture/frontend/ ・ https://github.com/penpot/penpot ・ https://community.penpot.app/t/its-time-for-penpot-to-almost-move-away-from-the-dom/6437 ・ https://community.penpot.app/t/whats-next-for-the-penpot-webgl-renderer/10627 ・ https://community.penpot.app/t/what-is-the-progress-on-penpots-new-rendering-engine/9858 ・ https://community.penpot.app/t/svg-rendering-performance-discussion/10830 ・ https://github.com/penpot/penpot/issues/3004 ・ https://github.com/excalidraw/excalidraw-mcp ・ https://github.com/excalidraw/excalidraw ・ https://raw.githubusercontent.com/excalidraw/excalidraw/master/excalidraw-app/collab/Portal.tsx ・ https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/excalidraw/history.ts ・ https://dev.to/karataev/excalidraw-state-management-1842 ・ https://tldraw.dev/community/license ・ https://tldraw.dev/docs/shapes ・ https://tldraw.dev/sdk-features/bindings ・ https://tldraw.dev/sdk-features/signals ・ https://tldraw.dev/reference/editor/Editor ・ https://tldraw.dev/reference/store/Store ・ https://github.com/tldraw/tldraw

**其他编辑器**
https://vectr.com/ ・ https://en.wikipedia.org/wiki/Boxy_SVG ・ https://www.linearity.io/curve/ ・ https://www.linearity.io/pricing/ ・ https://www.linearity.io/blog/linearity-rebrand/ ・ https://blenderartists.org/t/gravit-designer-aka-corel-vector-is-retiring/1604869 ・ https://www.coreldraw.com/en/product/vector/ ・ https://en.wikipedia.org/wiki/Photopea ・ https://www.photopea.com/api/ ・ https://www.canva.dev/docs/apps/mcp/ ・ https://www.canva.dev/docs/connect/mcp-server/ ・ https://github.com/SVG-Edit/svgedit ・ https://github.com/methodofaction/Method-Draw ・ https://github.com/GraphiteEditor/Graphite ・ https://www.cgchannel.com/2025/07/check-out-unusual-open-source-vector-design-tool-graphite/ ・ https://graphite.art/volunteer/guide/graphene/ ・ https://github.com/GraphiteEditor/Graphite/pull/1897 ・ https://github.com/linebender/vello ・ https://polotno.com/docs/overview ・ https://polotno.com/sdk/pricing ・ https://github.com/fabricjs/fabric.js/ ・ https://github.com/konvajs/konva ・ https://github.com/paperjs/paper.js/ ・ http://paperjs.org/license/

**渲染/几何/文字**
https://github.com/pixijs/pixijs ・ https://pixijs.com/8.x/guides/components/renderers ・ https://pixijs.com/blog/8.16.0 ・ https://github.com/jonobr1/two.js ・ https://rive.app/blog/rive-renderer-now-open-source-and-available-on-all-platforms ・ https://github.com/rive-app/rive-runtime/blob/main/LICENSE ・ https://skia.org/docs/user/modules/canvaskit/ ・ https://github.com/google/skia/blob/main/LICENSE ・ https://github.com/paperjs/paper.js/issues/786 ・ https://github.com/mfogel/polygon-clipping ・ https://github.com/w8r/martinez ・ https://github.com/Pomax/bezierjs ・ https://github.com/alexbol99/flatten-js ・ https://github.com/fontello/svgpath ・ https://github.com/thednp/svg-path-commander ・ https://github.com/glenzli/paperjs-offset ・ https://github.com/fonttools/skia-pathops ・ https://api.skia.org/classSkStrokeRec.html ・ https://canvaskit-wasm.netlify.app/interfaces/path ・ https://github.com/danmarshall/svg-path-outline ・ https://github.com/steveruizok/perfect-freehand ・ https://github.com/steveruizok/perfect-freehand/blob/main/LICENSE ・ https://developers.figma.com/docs/plugins/api/VariableWidthStrokeProperties ・ https://github.com/opentypejs/opentype.js ・ https://github.com/harfbuzz/harfbuzzjs ・ https://harfbuzz.github.io/harfbuzzjs/ ・ https://github.com/foliojs/fontkit ・ https://infinitecanvas.cc/guide/lesson-016 ・ https://konvajs.org/docs/shapes/TextPath.html

**架构/性能补充**
https://api.github.com/repos/tldraw/tldraw/contents/packages ・ https://api.github.com/repos/excalidraw/excalidraw/contents/packages/excalidraw ・ https://andrewkchan.dev/posts/figma2.html ・ https://dev.to/vitalf/svg-vs-canvas-vs-webgl-for-diagram-viewers-tradeoffs-bottlenecks-and-how-to-measure-34n7 ・ https://groups.google.com/g/d3-js/c/tFU2-twAP8I ・ https://news.ycombinator.com/item?id=15024190 ・ https://github.com/excalidraw/excalidraw/issues/7280 ・ /8136 ・ /10022 ・ /10063

**freehand / CRDT / import-export / tracing**
https://github.com/mourner/rbush ・ https://github.com/soswow/fit-curve ・ https://github.com/yjs/yjs ・ https://github.com/automerge/automerge ・ https://github.com/loro-dev/loro ・ https://github.com/tooolbox/node-potrace ・ https://github.com/jankovicsandras/imagetracerjs ・ https://github.com/Hopding/pdf-lib ・ https://github.com/svg/svgo ・ https://en.wikipedia.org/wiki/Encapsulated_PostScript

**标记为未核实/存在冲突的信息**：Figma 当前插件沙箱技术官方开发者文档未再明确命名（仅 2024 年博客确认 QuickJS）；tldraw 商业许可具体定价（约 $6,000/年，第三方来源未经 tldraw 一手核实）；Penpot 新渲染引擎是否已默认启用（截至所见信息为 opt-in beta）；Linearity Curve 是否存在正式 Web 版（官网仅列 Apple 平台，其他页面提及 cloud.linearity.io 但未直接核实）；Corel Vector 是否已正式停运（无 Corel 官方声明，仅社区帖子与产品页跳转佐证）；Graphite LICENSE.md 原文未能直接抓取（许可证类型来自仓库主页声明）；Adobe .ai 格式为 PDF 容器基于公开常识与 Illustrator 历史文档惯例，本轮因官方帮助页面返回 403 未能直接抓取核实。
