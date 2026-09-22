# 调研三：MCP 设计 / 绘图 / 画布类工具接口模式

> 调研执行：Sonnet subagent，2026-09-22。所有工具名均引自源码或官方文档，未验证处已标注。

## 1. Figma 官方 MCP Server

Figma 官方现在实际上是**两套 MCP 能力**共存：本地 Dev Mode MCP server（只读为主）+ 远程 MCP server（读写全套，含 `use_figma`）。真实工具清单（来自 [developers.figma.com/docs/figma-mcp-server/tools-and-prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)）：

- **读**：`get_design_context`（把节点转成 React/Tailwind 代码+样式）、`get_metadata`（返回稀疏 XML 大纲——只含 id/name/type/位置尺寸，供 agent 先"看骨架"再决定要不要深挖）、`get_screenshot`（PNG 截图）、`get_variable_defs`（设计 token）、`get_motion_context`（动效关键帧）、`get_figjam`、`download_assets`。
- **写**：`use_figma`（通用创建/编辑/查询，见下）、`generate_figma_design`（把活体网页 UI 转成设计图层）、`create_new_file`、`upload_assets`、`generate_diagram`（把 Mermaid 或文字描述转成 FigJam 图）。
- **设计系统/Code Connect**：`get_libraries`、`search_design_system`、`get_code_connect_map`、`add_code_connect_map`。
- **账户/生成式插件/Shader**：`whoami`、`create_generative_plugin`、`create_shader` 等。
- **Weave 工作流**：`weave_run_tool` 等（另计费）。

最值得借鉴的是 **`use_figma` 的设计**：它不是"逐个属性一个工具"的细粒度 API，而是让 agent **直接写一段 JavaScript 脚本对 Plugin API 编程**（创建节点、查询、改属性），一次调用内部执行多步操作。其调用规范由 `skill://figma/figma-use/SKILL.md`（[github.com/figma/mcp-server-guide](https://github.com/figma/mcp-server-guide/blob/main/skills/figma-use/SKILL.md)）以"技能文档"的形式提供，而不是塞进工具描述里——这是"skill 作为 MCP resource 分发、按需加载"的真实范例。该 skill 中几条硬性约定极具参考价值：
- 颜色必须用 0–1 浮点（不是 0–255）；
- 每次创建/修改节点的脚本**必须 return 所有受影响节点的 id**（`{createdNodeIds, mutatedNodeIds}`），作为下一步调用的输入，形成显式的状态回执；
- 推荐"骨架优先"的增量流程：先建顶层结构（用 `placeholder=true` 标记未完成区域）→ 分批填充内容 → 最后 `get_metadata` 做结构校验、`get_screenshot` 做视觉校验；
- 页面切换 `setCurrentPageAsync` 每次调用只做一次，多页面工作要拆到并行的多次 tool call。

截图/渲染预览统一走 MCP 的 **image content**（`type:"image"`，base64 或临时 URL，`enableBase64Response` 参数可控），生成式插件源码则以 **embedded resource URI** 返回，客户端按需再拉取（省 token）。

来源：[Introducing our Dev Mode MCP server](https://www.figma.com/blog/introducing-figma-mcp-server/)、[Guide to the Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)、[Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)、[figma/mcp-server-guide](https://github.com/figma/mcp-server-guide)。

## 2. 社区 Figma MCP：细粒度 CRUD + WebSocket 桥

三个同族项目（`cursor-talk-to-figma-mcp` by sonnylazuardi、`claude-talk-to-figma-mcp` by arinspunk、`Framelink figma-mcp` by GLips）代表另一条路线：**MCP server ⇄ WebSocket 中转 ⇄ Figma 插件**，插件在浏览器/桌面端执行真正的 Plugin API 调用。

`cursor-talk-to-figma-mcp`（[github.com/sonnylazuardi/cursor-talk-to-figma-mcp](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp)）真实工具列表极细：`get_document_info`、`get_selection`、`create_rectangle`、`create_frame`、`create_text`、`set_fill_color`、`set_stroke_color`、`set_corner_radius`、`move_node`、`resize_node`、`clone_node`、`set_layout_mode`（auto layout）、`create_component_instance`、`export_node_as_image`、`join_channel` 等——每个 Figma 属性对应一个独立工具，属于典型的"面向对象属性访问器"式细粒度设计。已知痛点：
- 必须先 `join_channel` 加入频道才能收发命令，是隐式会话状态；
- 大文档要靠 `scan_text_nodes` 的 chunking 参数分页，否则一次返回撑爆上下文；
- 图片导出走 base64 文本，"limited support"；
- 所有命令都可能抛异常，需要 agent 自己做错误处理。

`Framelink`（GLips/Figma-Context-MCP）则是**纯只读**服务，核心卖点是"简化 Figma 原始 API 响应"——只把布局/样式相关字段喂给模型，明确写道减少上下文量能提高准确率、降低成本，是"服务端做预处理再返回"的典型代表。

`claude-talk-to-figma-mcp` 基本是前者的移植版，额外提示：多 agent 并发时禁止用隐式的 `set_current_page`，必须显式传 `parentId`，避免"当前页"这种共享可变状态导致的竞态。

来源：[cursor-talk-to-figma-mcp README](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp)、[claude-talk-to-figma-mcp README](https://github.com/arinspunk/claude-talk-to-figma-mcp/blob/main/readme.md)、[GLips/Figma-Context-MCP](https://github.com/GLips/Figma-Context-MCP)。

## 3. Excalidraw MCP：JSON 元素 + 实时画布同步

`yctimlin/mcp_excalidraw`（[github.com/yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw)）是"声明式 JSON 场景图"路线的好例子，暴露约 26 个工具，分组清晰：
- **元素 CRUD**：`create_element`、`get_element`、`update_element`、`delete_element`、`query_elements`、`batch_create_elements`、`duplicate_elements`；
- **布局**：`align_elements`、`distribute_elements`、`group_elements`、`ungroup_elements`、`lock_elements`；
- **内省/导出**：`describe_scene`（场景摘要）、`get_canvas_screenshot`、`export_scene`/`import_scene`、`export_to_image`、`create_from_mermaid`；
- **状态**：`clear_canvas`、`snapshot_scene`、`restore_snapshot`、`set_viewport`。

元素字段直接映射 Excalidraw 数据模型（`id`、`type`、`x/y/width/height`、`backgroundColor`），并为 agent 友好性做了改写：箭头连接用 `startElementId`/`endElementId` 而不是底层的 `startBinding` 对象，文本标签直接挂在 `"text"` 字段上。画布服务端内存中持有元素状态，`ENABLE_CANVAS_SYNC=true` 时通过 WebSocket 广播增量，允许人和多个 agent 并发编辑同一画布——但服务重启即丢数据，README 明确提示必须导出 `.excalidraw` 文件或用命名快照持久化。文档里最有价值的一条经验：**"批量创建后应截图验证文字截断/元素重叠，再迭代式微调而不是整体重来"**——即把"渲染反馈"当作强制的写后校验步骤，而不是可选项。

来源：[yctimlin/mcp_excalidraw README](https://github.com/yctimlin/mcp_excalidraw)。

## 4. tldraw：Editor API 直接暴露给 Agent

tldraw 走的不是标准 MCP，而是把自己的 `Editor` 实例直接交给一个 `TldrawAgent` 对象操作画布形状（"Agent Starter Kit"，2025 年随 tldraw SDK 4.0 一起发布五个 starter kit）。经典的 "Make Real" 功能（[github.com/tldraw/make-real](https://github.com/tldraw/make-real)）流程是：截图选中区域 → 连同 prompt 发给模型 → 生成 HTML → 渲染回画布，本质是"画布→图像→LLM→代码→画布"的单向闭环，而非结构化读写。Agent Starter Kit 更进一步：AI 返回结构化响应后，agent 通过 Editor API 直接操作 shape record，属于"宿主应用把内部对象模型 API 直接暴露"的路线，相比 MCP 细粒度工具更省一层协议开销，但耦合宿主运行时、无法跨进程/跨语言调用。

来源：[tldraw/make-real](https://github.com/tldraw/make-real)、[tldraw × AI Agent: Agent Starter Kit 解析](https://zenn.dev/slowhand/articles/bb203aba83e385?locale=en)。

## 5. Blender MCP / Unity MCP / Unreal MCP：脚本执行 vs 细粒度工具的两极分化

- **Blender MCP**（ahujasid，[github.com/ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp)）核心工具是 `execute_blender_code`——把 LLM 生成的任意 Python 代码通过 `exec()` 丢进 Blender 执行，**没有沙箱、没有校验**。官方 issue #207 明确警告这是"unrestricted arbitrary code execution"，建议对该工具要求 UI 内的显式人工确认，等同于其他框架里的"destructive tool 需要 human-in-the-loop"。这是"脚本执行"模式安全性最差的反例。
- **Unity MCP**（CoplayDev，[github.com/CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp)）反而走**细粒度+批处理**混合路线：47 个具名工具（`apply_text_edits`、`create_script`、`find_gameobjects`…）外加一个 `batch_execute` 把多条命令打包一次往返，兼顾"可发现性"与"往返延迟"。另一些社区 fork（FunplayAI）则额外提供 `execute_code`，说明"细粒度工具 + 逃生舱脚本执行工具"并存是常见折中。
- **Unreal MCP** 社区实现分化更极端：从 127 个工具/16 子系统（sam-david/unreal-mcp）到 1931+ actions/26 类别（db-lyon/ue-mcp），可见"细粒度到什么颗粒度"在 3D/引擎类工具里缺乏共识，工具数量爆炸本身就是上下文成本问题的来源。

来源：[ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp)、[blender-mcp Issue #207](https://github.com/ahujasid/blender-mcp/issues/207)、[CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp)、[Tool reference](https://coplaydev.github.io/unity-mcp/reference/tools)。

## 6. Canva / Adobe Illustrator：事务化编辑 + 脚本桥接两个真实样本

**Canva 官方 MCP**（`mcp.canva.com/mcp`）约 32 个工具，最值得借鉴的是**显式事务模型**：`start-editing-transaction` → `perform-editing-operations`（可多次）→ `commit-editing-transaction`，把一连串编辑操作包成一个可原子提交/回滚的事务，避免逐条编辑各自触发一次"撤销记录"、也避免半途失败留下脏状态。配合 `search-designs`、`generate-design`、`get-design-content`、`export-design`（多格式）、`upload-asset-from-url`。

**Adobe Illustrator**：官方内置 MCP（Illustrator Beta 30.4+）目前功能有限，聚焦"分析/批处理已有文档"（颜色分析、字体检查、批量导出画板），尚不支持从零生成矢量图形。社区的 `illustrator-mcp-server`（krVatsal / ie3jp 等多个 fork）反而更完整——63 个工具，本质是把 prompt 翻译成 **ExtendScript(JSX)**，写临时文件后在 macOS 用 `osascript do javascript` 调起、在 Windows 用 COM 自动化执行，附带截图能力做视觉反馈。这与 Blender MCP 同属"生成脚本喂给宿主引擎执行"模式，但用了具名工具包一层，比直接暴露 `execute_code` 稍安全。

来源：[Canva MCP docs](https://www.canva.dev/docs/apps/mcp/)、[About using AI tools with Illustrator (Beta)](https://helpx.adobe.com/in/illustrator/desktop/connect-with-other-apps-and-tools/about-using-ai-tools-with-illustrator.html)、[ie3jp/illustrator-mcp-server](https://github.com/ie3jp/illustrator-mcp-server)。

## 7. 图表/白板类：DSL 文本 → 渲染矢量

- **Mermaid MCP**（多个实现，如 `peng-shawn/mermaid-mcp-server`、Mermaid 官方 `mermaid.ai/docs/ai/mcp-server`）统一模式：agent 产出 Mermaid 文本 DSL → 服务端用 headless 浏览器/Puppeteer 或 Kroki 渲染 → 返回 PNG/SVG。**校验与渲染分离**是常见做法（`mcp-mermaid-validator` 先 validate 语法再渲染），避免把渲染失败的原始报错抛给模型。
- **draw.io MCP**（`@drawio/mcp` 官方 npm 包 + 多个社区实现如 `simonkurtz-MSFT/drawio-mcp-server`）分两种：一种直接生成 drawio XML 文件（无需运行时）；另一种做**双向桥接**，既能推送图到正在运行的 draw.io 编辑器，也能从画布读回结构给 agent 处理，类似 Figma 社区插件的 WebSocket 桥模式。
- **Miro 官方 MCP**（`mcp.miro.com`）20+ 工具打包成 7 个"技能簇"：browse、diagram、doc、table、code-review 等，`generate_diagram` 可直接把代码/PR/文字描述转成板上图表，体现"按使用场景打包工具"而非"按 CRUD 动词打包"的思路。
- **Figma `generate_diagram`**：同样吃 Mermaid 语法或纯文字描述，产出原生 FigJam 图形（非图片），说明"DSL 进、原生矢量对象出"是行业趋同做法，而非仅渲染成图片。

来源：[draw.io MCP server docs](https://www.drawio.com/docs/manual/generate/drawio-mcp-server/)、[Miro MCP Server Tools](https://developers.miro.com/docs/miro-mcp-tools)、[Mermaid Chart MCP Server](https://mermaid.ai/docs/ai/mcp-server)。

## 8. 数据可视化 MCP：Schema 化的图表类型枚举

`antvis/mcp-server-chart`（[github.com/antvis/mcp-server-chart](https://github.com/antvis/mcp-server-chart)）是数据可视化 MCP 的标杆：25+ 图表类型，每种图表一个独立工具（`generate_bar_chart`、`generate_column_chart`、`generate_boxplot_chart`、`generate_area_chart`…），每个工具用 Zod 定义自己的输入 schema，同时共享 `ThemeSchema`、`PaletteSchema`、`BackgroundColorSchema` 等公共片段——**"每种可视化类型一个具名工具 + 共享子 schema"** 是值得直接照搬的惯例，比"一个 `generate_chart(type, config)` 万能工具"更利于模型在无文档情况下靠工具名猜出用法，也比 63 个完全独立无复用的 schema 更省维护成本。Vega-Lite 系的 MCP server（如 `isaacwasserman/mcp-vegalite-server`）则相反，只暴露 `save_data` + `visualize_data` 两个工具，把"画什么图"完全交给 Vega-Lite JSON 语法本身承载——这是"少量工具 + 强表达力 DSL"路线的例子。

来源：[antvis/mcp-server-chart README](https://github.com/antvis/mcp-server-chart)。

## 9. MCP 协议层与 Anthropic 官方指导

**MCP 规范**（[modelcontextprotocol.io/specification/2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)）关键机制：
- `outputSchema` + `structuredContent`：工具可声明输出 JSON Schema，返回既有可读文本块也有结构化字段，供程序化消费；
- 内容类型覆盖 text / image / audio / **resource_link**（工具返回可订阅的资源 URI 而非内容本身）/ **embedded resource**（内联但仍带 `annotations.audience/priority/lastModified`）；
- **工具 annotations**：`readOnlyHint`（只读）、`destructiveHint`（默认 true，标记是否做覆盖式而非追加式修改）、`idempotentHint`（重复调用是否等幂）、`openWorldHint`（是否触达开放世界的外部实体）——官方博客明确指出这些是"风险提示词汇，非强制安全保证"，客户端仍需自行判断；
- `tools/list`、`resources/list`、`resources/templates/list` 均支持基于 cursor 的**分页**；resources 支持 `subscribe`/`listChanged` 两种变更通知；elicitation 允许服务端在会话中反向向用户要输入；progress token 用于长任务的进度回报。

**Anthropic「Writing effective tools for agents」**（[anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents)）核心建议：
- 用**少数高层工具**替代大量细粒度端点，如把 `get_customer_by_id`+`list_transactions`+`list_notes` 合并成一个 `get_customer_context`；
- 工具**命名空间化**（`asana_search`、`jira_search`），前缀/后缀顺序会实测影响模型选择准确率，需靠评测决定；
- 返回内容应"语义可读"而非裸 UUID，暴露 `response_format: "concise"/"detailed"` 枚举把 token 控制权交给 agent；
- 把 pagination/filter/truncation 的默认值调得保守，并把出错信息写成"可执行的修正提示"而不是原始 traceback。

**Anthropic「Code execution with MCP」**（2025年11月，[anthropic.com/engineering/code-execution-with-mcp](https://www.anthropic.com/engineering/code-execution-with-mcp)）提出把 MCP server 呈现成**文件系统里的代码 API**（如 `./servers/figma/createFrame.ts`），agent 写代码去调用、在执行环境本地做数据过滤/整理，只把最终结果吐回上下文。案例中一个流程从 15 万 token 降到 2 千 token（省 98.7%）。渐进式披露（agent 可用 `search_tools` 按需探索文件系统而非一次性加载全部工具定义）与隐私保护（敏感数据留在执行环境、不进入模型上下文）是两个额外收益，代价是需要一个带资源限制和监控的安全沙箱，运维复杂度上升。

## A. 接口粒度对比表

| 模式 | 代表案例 | Token 成本 | 出错率/鲁棒性 | 可发现性 | 安全性 |
|---|---|---|---|---|---|
| 细粒度 CRUD 工具（一属性一工具） | cursor-talk-to-figma-mcp、Unreal `db-lyon/ue-mcp` | 高——工具定义本身就占大量上下文，多步操作要多次往返 | 单步失败影响小，但多步组合易漏调用、状态不同步 | 高——工具名即文档，LLM 容易猜对 | 较安全，每个工具可单独加 `destructiveHint`/校验 |
| 声明式"整份 JSON/场景图替换或增量" | Excalidraw `batch_create_elements`/`update_element`、Canva 事务 API | 中——一次传大 JSON，但省去多次往返 | 中——需要良好的 diff/merge 语义，ID 管理是关键失败点 | 中——需要文档说明 schema | 中，写入前后可做整体校验 |
| 执行脚本/代码（Plugin API / Python / ExtendScript） | Figma `use_figma`、Blender `execute_blender_code`、Illustrator JSX 桥 | 低——一次调用做多步操作，省去中间态往返 | 高方差——脚本对/错取决于模型代码能力，出错时定位难 | 低——没有具名工具可枚举，靠 skill 文档教怎么写 | 最差（Blender 无沙箱）到中等（Figma 有 Plugin API 边界）不等，需要显式确认/沙箱 |
| DSL/文本入，渲染矢量出 | Mermaid MCP、`generate_diagram`(FigJam)、antvis chart 工具 | 低——DSL 紧凑，模型训练语料里天然见过 | 低——语法可校验(validate-then-render)，失败信息明确 | 高——每种图表/图类型一个具名工具 | 高，渲染是纯函数、无持久状态副作用 |

对 Illustrator 级"矢量编辑器"而言，结论倾向**混合**：高频、结构清晰的操作（建路径、布尔运算、加图层、改填充）用细粒度或"批量声明式"工具；复杂一次性排版/图案生成用脚本执行工具（但要沙箱化，不能像 Blender 那样裸 `exec`）；图表/图示类功能直接照抄 antvis 的"每类型一工具+共享 schema"模式。

## B. 值得借鉴的命名与 Schema 惯例（均为真实存在的例子）

- 动词_名词 前缀家族：`create_rectangle`/`create_frame`/`create_text`、`set_fill_color`/`set_stroke_color`/`set_corner_radius`（cursor-talk-to-figma-mcp）——同一前缀便于模型归类。
- 批处理后缀 `_multiple_`/`batch_`：`set_multiple_text_contents`、`delete_multiple_nodes`、`batch_create_elements`、`batch_execute`（Unity）——明确告诉模型"这个工具接受数组"。
- 只读探测工具单独命名并轻量化：`get_metadata`（稀疏 XML，仅结构）vs `get_design_context`（完整样式代码）——分层返回，让模型先"扫一眼"再决定要不要深挖，是控制 token 的关键手段。
- `describe_scene` / `whoami` 这类"给我讲讲现状"的自然语言化摘要工具（Excalidraw、Figma）。
- 共享 Schema 片段：`ThemeSchema`、`PaletteSchema`、`BackgroundColorSchema`（antvis），跨工具复用降低维护成本、保证跨图表一致性。
- 事务三段式：`start-editing-transaction`/`perform-editing-operations`/`commit-editing-transaction`（Canva）。
- 强制回执字段：脚本类工具要求 `return {createdNodeIds, mutatedNodeIds}`（Figma `use_figma` skill）。

## C. 反馈回路模式

- **PNG/图片反馈**：几乎所有画布类 MCP 都提供 `get_screenshot`/`get_canvas_screenshot`/`export_node_as_image`，用 MCP 的 `image content` 类型（base64 或临时 URL）。Excalidraw 文档明确把"改动后截图核查文字截断/重叠"写成推荐工作流，而不是可选步骤——这点对矢量插画编辑器尤其重要，因为几何布局的对错很多时候语言模型光看坐标数字判断不出来。
- **结构化摘要**：`describe_scene`（Excalidraw）、`get_metadata`（Figma 稀疏 XML）用轻量文本代替整份 JSON/图片，供模型快速判断"现在画布上有什么"，是控制上下文膨胀的关键中间层。
- **SVG/文本回执**：Mermaid/draw.io 类返回渲染后的 SVG 文本本身可再被模型读取解析（不像 PNG 是黑盒像素），适合需要模型"读回并继续编辑"的场景。
- **ID 回执**：写操作强制返回受影响对象 id 列表（Figma skill 规范），让后续调用可以精确寻址，避免模型凭空编造 id。
- 综合来看，好的反馈回路应同时提供"给人看的图片"（PNG/截图）和"给模型继续操作用的结构化数据"（id 列表/精简 JSON/SVG 文本），二者缺一都会导致下一步操作出错率上升。

## D. 常见坑

- **ID 管理**：Excalidraw 早期版本批量创建后丢失/重排 ID，导致后续 `update`/`delete` 失败，靠专门的 PR（#34）修复"batch ID preservation"；Figma skill 里干脆把"返回所有 id"写成协议级强制要求。设计时应保证 ID 在批量创建/撤销/重做后保持稳定且可预测。
- **坐标系与单位**：Figma 用左上角原点+像素，颜色用 0–1 浮点而非 0–255（模型很容易按直觉写成 255 制导致颜色全错，skill 文档专门强调这条）；引擎类 MCP（Unity/Unreal）还要处理左手/右手坐标系、米/厘米单位混淆。矢量编辑器要在工具 schema 里显式标注单位与坐标原点约定，并在描述里反复强调，而不是假设模型"应该知道"。
- **颜色格式不统一**：HEX、RGB 0-255、RGB 0-1、HSL 并存，是这类工具最容易出错的字段，建议单一 canonical 格式 + 明确 schema 描述。
- **撤销分组（undo grouping）**：Canva 用显式事务包装一批操作，使其在宿主应用里表现为一次可撤销单元；没有这层包装的工具（如很多社区 Figma MCP）每条命令都各自进入撤销栈，人类用户按一次 Ctrl+Z 只能撤销模型的最后一小步，体验很差。
- **长时任务**：Canva/Weave 类工具对"生成"这种慢操作采用"提交任务 + 轮询获取结果"两段式（`weave_run_tool` + `weave_get_tool_run_output`），而非阻塞等待——矢量渲染/导出大文件、批量图表生成都应参考这个模式，并用 MCP 的 progress token 机制回报进度。
- **人机并发编辑冲突**：Excalidraw 的 `ENABLE_CANVAS_SYNC` 允许人和 agent 同时改同一画布，文档未提及冲突解决策略（看起来是"后写覆盖"），这对协同编辑的插画/图表工具是显著风险点，需要显式的锁定/分支/乐观并发控制（如 `lock_elements` 这种半成品方案）。
- **会话/文档寻址**：细粒度社区 Figma 工具要求先 `join_channel`，多 agent 并发时不能用隐式"当前页"状态（必须显式传 `parentId`）——说明"当前上下文"类隐式状态在多会话场景下极易出 bug，矢量编辑器的文档/画板/图层寻址应始终显式传 id，不依赖"当前选中"这种可变全局态。
- **大文档 token 膨胀**：Framelink 明确把"精简 Figma 原始响应"作为核心卖点，antvis/Excalidraw 都提供"稀疏元数据"级别的轻量工具；这提示大型矢量文档（成百上千路径/图层）必须设计分层读取 API（大纲→选区→单节点详情），不能只有"导出整份文档 JSON"一个选项。
- **脚本执行的安全边界**：Blender MCP 的 `execute_blender_code` 是反面教材——无沙箱、无审批即可执行任意代码；Figma 的 `use_figma` 虽然也是脚本执行，但限定在 Plugin API 沙箱内、且有 skill 文档约束写法，风险可控得多。新设计脚本类工具时至少要做到：限定可调用的 API 面（不能任意 `eval`/`exec` 宿主环境）、默认要求人工确认破坏性操作、并把该工具标注 `destructiveHint: true`。

## E. 参考来源

- [Introducing our Dev Mode MCP server](https://www.figma.com/blog/introducing-figma-mcp-server/)
- [Figma MCP — Tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)
- [Guide to the Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559-Guide-to-the-Figma-MCP-server)
- [figma/mcp-server-guide (skills, incl. figma-use/SKILL.md)](https://github.com/figma/mcp-server-guide)
- [cursor-talk-to-figma-mcp (sonnylazuardi)](https://github.com/sonnylazuardi/cursor-talk-to-figma-mcp)
- [claude-talk-to-figma-mcp (arinspunk)](https://github.com/arinspunk/claude-talk-to-figma-mcp/blob/main/readme.md)
- [GLips/Figma-Context-MCP (Framelink)](https://github.com/GLips/Figma-Context-MCP)
- [yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw)
- [tldraw/make-real](https://github.com/tldraw/make-real)
- [tldraw × AI Agent: Agent Starter Kit](https://zenn.dev/slowhand/articles/bb203aba83e385?locale=en)
- [ahujasid/blender-mcp](https://github.com/ahujasid/blender-mcp) / [Issue #207 security](https://github.com/ahujasid/blender-mcp/issues/207)
- [CoplayDev/unity-mcp](https://github.com/CoplayDev/unity-mcp) / [Tool reference](https://coplaydev.github.io/unity-mcp/reference/tools)
- [sam-david/unreal-mcp](https://github.com/sam-david/unreal-mcp)、[db-lyon/ue-mcp](https://github.com/db-lyon/ue-mcp)
- [Canva MCP docs](https://www.canva.dev/docs/apps/mcp/)
- [About using AI tools with Illustrator (Beta)](https://helpx.adobe.com/in/illustrator/desktop/connect-with-other-apps-and-tools/about-using-ai-tools-with-illustrator.html)
- [ie3jp/illustrator-mcp-server](https://github.com/ie3jp/illustrator-mcp-server)
- [draw.io MCP server docs](https://www.drawio.com/docs/manual/generate/drawio-mcp-server/)
- [Miro MCP Server Tools](https://developers.miro.com/docs/miro-mcp-tools)
- [Mermaid Chart MCP Server](https://mermaid.ai/docs/ai/mcp-server)
- [antvis/mcp-server-chart](https://github.com/antvis/mcp-server-chart)
- [isaacwasserman/mcp-vegalite-server](https://github.com/isaacwasserman/mcp-vegalite-server)
- [MCP Spec — Tools](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [MCP Spec — Resources](https://modelcontextprotocol.io/specification/2025-06-18/server/resources)
- [MCP Blog — Tool Annotations as Risk Vocabulary](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)
- [Anthropic — Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Anthropic — Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
