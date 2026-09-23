# Zibel

浏览器里的矢量绘图工具。文档模型为 AI Agent 通过 MCP 读写而设计，人类用户在同一份文档上用 Illustrator 风格的画布编辑。术语以 Adobe Illustrator 的用法为准，Illustrator 没有的概念才自造。

## 文档结构

**Document（文档）**：
一份独立的矢量作品，由 Artboard 集合、Node 树和 Asset 库组成。一个 Document 对应一个文件。
_Avoid_: File、Project、Canvas

**Artboard（画板）**：
Document 中的一块矩形区域，是导出、对齐和渲染范围的边界。Artboard 不是 Node，不能作为任何 Node 的父级。
_Avoid_: Page、Frame、Canvas

**Node（节点）**：
Document 中任何可寻址的图稿对象，有稳定 ID 与父级。Layer、Group、Path、Text 等都是 Node。
_Avoid_: Element、Object、Item、Shape（泛指时）

**Layer（图层）**：
组织图稿的容器 Node，带颜色、锁定、模板等管理属性。Layer 的父级只能是 Document 根或另一个 Layer；Group 不能包含 Layer。
_Avoid_: Folder、Sublayer 作为独立类型（嵌套 Layer 就叫 Layer）

**Group（编组）**：
把若干 Node 合为一个整体的容器 Node，本身是图稿的一部分，可出现在 Layer 或其他 Group 内。
_Avoid_: Container、Frame

**Selection（选区）**：
人类用户在 UI 中当前选中的 Node 集合。它是 UI 便利，不是文档状态；Agent 操作以显式 Node ID 为准。
_Avoid_: 把 Selection 作为工具调用的隐式参数

**Auto-name（自动名称）**：
`name` 为空的 Node 在 Layers 面板中显示的名称，如 `<Rectangle>`、`<Path>`、`<Group>`；Text Node 取其内容。只用于显示，不写入 Document。
_Avoid_: Default name、Placeholder name

## 几何

**Path（路径）**：
由 Anchor 与 Handle 定义的贝塞尔曲线 Node，可开放或闭合。
_Avoid_: Shape（泛指时）、Curve、Polyline

**Anchor（锚点）**：
Path 上的一个顶点。分角点（Corner）与平滑点（Smooth）。
_Avoid_: Vertex、Point、Node（几何意义上）

**Handle（手柄）**：
从 Anchor 伸出、控制相邻曲线段方向与曲率的控制点。
_Avoid_: Control point、Direction point、Bezier point

**Live Shape（实时形状）**：
由参数（宽高、圆角、边数、内外半径、起止角）定义的 Node，如矩形、椭圆、多边形、星形。锚点级编辑会把它转为 Path。它的派生几何以 `d` 形式只读暴露。
_Avoid_: Primitive、Basic shape、Parametric shape

**Compound Path（复合路径）**：
多条子路径按同一填充规则视为一个 Path，用于挖洞。它是破坏性的：子路径不再各自独立。
_Avoid_: Compound Shape（另一个概念）、Hole、Cutout

**Compound Shape（复合形状）**：
对若干子 Node 施加布尔运算（Unite / Minus Front / Intersect / Exclude）的非破坏性 Live Object；子 Node 保留、可编辑、结果实时重算。
_Avoid_: Boolean、Boolean group、Pathfinder object

## 文字

**Text（文字）**：
显示字符的 Node，`type` 为 `text`，按 `kind` 分为 Point Type、Area Type、Type on a Path。字符属性（字体族、字号）存在 Node 上。
_Avoid_: Label、Text box、Text element

**Point Type（点文字）**：
从一个点开始、只在硬回车处换行的 Text，`kind: "point"`。那个点是第一个字符基线的起点。
_Avoid_: Point text、Label、Single-line text

## 实时对象

**Live Object（实时对象）**：
保留参数、由参数派生出几何、支持 Expand 与 Release 的 Node 的统称。包括 Live Shape、Compound Shape、Blend、Repeat、Chart、带 Effect 的对象、带画笔的描边。
_Avoid_: Smart object、Dynamic object、Procedural object

**Expand（扩展）**：
把 Live Object 的派生几何固化为普通 Path，丢弃参数。不可逆。
_Avoid_: Flatten、Bake、Rasterize（那是转位图）

**Release（释放）**：
解除 Live Object 的关系，恢复其子 Node 为独立对象。与 Expand 不同，它保留子 Node 而丢弃结果。
_Avoid_: Ungroup（那是 Group 的操作）、Detach

**Blend（混合）**：
在两个或多个 Node 之间按步数或距离生成过渡对象的 Live Object。
_Avoid_: Morph、Interpolation、Tween

**Repeat（重复）**：
按径向、网格或镜像规则复制一个 Node 的 Live Object。
_Avoid_: Array、Pattern（那是填充）、Clone

**Chart（图表）**：
由数据、编码与主题派生出坐标轴、图形与标签的 Live Object。改数据即重绘；Expand 后成为普通 Node。
_Avoid_: Graph（Illustrator 旧称，仅在映射表中出现）、Plot、Visualization

**Diagram（图示）**：
由节点与边描述（如 Mermaid）生成的流程图、架构图等。生成后是普通 Group，其中的连接线是 Connector。
_Avoid_: Chart、Flowchart 作为总称

**Connector（连接线）**：
两端绑定到其他 Node、随其移动而重新路由的 Path。
_Avoid_: Arrow、Edge（仅在 Diagram 的输入描述中使用）、Link

## 外观

**Appearance（外观）**：
一个 Node 的全部视觉属性：有序的 Fill 列表、Stroke 列表与 Effect 列表。可施加于单个 Node、Group 或 Layer。
_Avoid_: Style（保留给 Graphic Style）、Paint、Look

**Fill（填充）**：
Appearance 中给 Path 内部着色的一层：纯色、渐变或图案。一个 Node 可有多个 Fill。
_Avoid_: Background、Color（泛指时）

**Stroke（描边）**：
Appearance 中沿 Path 轮廓绘制的一层，有宽度、端点、连接、虚线、箭头等属性。一个 Node 可有多个 Stroke。
_Avoid_: Outline、Border、Line、笔迹（那是 Ink）

**Effect（效果）**：
Appearance 中非破坏性修改几何或像素的一层，如阴影、模糊、偏移路径。
_Avoid_: Filter（保留给 SVG filter 的技术语境）

**Graphic Style（图形样式）**：
可复用、可命名的完整 Appearance 定义，存于 Asset 库。
_Avoid_: Style preset、Theme

**Clipping Mask（剪切蒙版）**：
用一个 Path 的形状裁切一组 Node 可见范围的容器。
_Avoid_: Clip、Crop（那是位图操作）

**Opacity Mask（不透明度蒙版）**：
用一个 Node 的亮度控制一组 Node 透明度的容器。
_Avoid_: Alpha mask、Luminosity mask

## 手绘

**Ink（笔迹）**：
来自鼠标、触控笔或 Agent 的原始点序列（含可选压力），尚未成为 Path。
_Avoid_: Stroke（那是描边）、Gesture、Trace

**Fidelity（保真度）**：
把 Ink 拟合为 Path 时"忠实原点"与"平滑"之间的取舍参数，与 Illustrator Pencil 选项同义。
_Avoid_: Smoothing、Tolerance

## 资源

**Asset（资源）**：
Document 级可被多个 Node 引用的共享定义：色板、渐变、图案、符号、Graphic Style、字符与段落样式、画笔、图表主题。修改 Asset 即更新所有引用处。
_Avoid_: Library item、Resource、Definition

**Symbol（符号）**：
一份可复用的图稿定义，存于 Asset 库；放到文档里的每一份是 Symbol Instance。
_Avoid_: Component、Master、Template

**Swatch（色板）**：
命名的颜色或渐变 Asset。标记为全局的 Swatch 被修改时，所有使用处同步变化。
_Avoid_: Palette entry、Color token

## 编辑与协作

**Transaction（事务）**：
一组作为整体提交或回滚的编辑，也是撤销的最小单位。UI 的一次拖拽和 Agent 的一组工具调用都各成一个 Transaction。它属于 Document 而不属于任何连接，只有开启它的 Actor 能使用其 `txId`；5 分钟无活动未提交即回滚。
_Avoid_: Batch、Undo step、Operation group

**Command（命令）**：
浏览器把一次手势（拖动、删除、显示 / 隐藏、锁定）作为一个 core 编辑经 WebSocket 发给 Document。Document 要么把它提交为一个归属 User Actor 的 Transaction 并广播，要么只向发送方回复拒绝；浏览器从不在本地先行应用它。
_Avoid_: Operation、Action、Mutation

**Revision（修订号）**：
Document 单调递增的版本序号，每提交一个 Transaction 加一。用来判断"我读过之后文档是否被别人改过"。
_Avoid_: Version（保留给 schema 版本）、Etag、Snapshot

**WriteReceipt（写入回执）**：
每个写工具的统一返回：`txId`、提交后的 `rev`、新增 / 修改 / 删除的 Node id、`clientKey` 到新 id 的 `keyMap`、受影响范围的 `bounds` 与 `warnings`。Agent 靠它确认改了什么，无需重读。`partial: true` 时另附 `failed`：每个未生效项的下标与错误。Transaction 内的写入，`rev` 仍是已提交的修订号，`tx_commit` 时才递增。
_Avoid_: Result、Response、Ack

**Actor（参与者）**：
做出修改的身份：一个人类 User，或一个 Agent 凭证。每个 Transaction 记录其 Actor；同一个人授权的两个 MCP 客户端是两个不同的 Actor。
_Avoid_: Session、Client、Connection、User（Actor 可能是 Agent）

**Agent**：
通过 MCP 调用 Zibel 的 AI 客户端，以自己的凭证作为一个 Actor。与人类用户拥有同等的编辑能力，只是入口不同。
_Avoid_: Bot、AI、Model、Assistant

## 渲染与导出

**Render Scope（渲染范围）**：
`render` 与 `export` 画出的那块区域：整个 Document（所有 Artboard 的并集）、一个 Artboard、若干 Node（取它们的 visible bounds，且只画这些 Node）或一个文档坐标矩形。它决定 `docRect`。
_Avoid_: Region、Crop、Viewport（那是返回的映射）

**Viewport（视口元数据）**：
`render` 返回的 `{docRect, pixelSize, scale}`：图像覆盖的文档矩形、像素尺寸、实际采用的每点像素数。Agent 用 `docX = docRect.x + px / scale` 把截图坐标换回文档坐标。
_Avoid_: Camera、View、Transform

**Render Overlay（渲染叠加层）**：
`render` 画在图稿之上的辅助标记：Node 的 bounds、Node id 标签、Artboard 边界。按像素定尺寸，只出现在 `render` 图像里，不进入 Document，也不进入 `export`。
_Avoid_: Annotation、Guide（那是参考线）；不要单说 Overlay（ADR-0008 的 Transaction overlay 是另一回事）

## 读取与查询

**Document Outline（文档大纲）**：
`doc_outline` 返回的稀疏 Node 树：每项只有 id、type、name、bounds（`includeBounds: false` 时省略）、childCount、visible、locked，子项展开到 `depth` 层。不带 `rootId` 时顶层永远是 Layer 列表。
_Avoid_: Tree、Layers（那是面板）；不要单说 Outline（Illustrator 的 Outline 是轮廓视图或 Create Outlines）

**Node Query（节点查询）**：
`node_query` 按条件（类型、名称正则、标签、父级、区域）找 Node，条件同时成立才算匹配，结果按 id 排序分页。它是 Agent 侧的"选择"，不改变 Selection。
_Avoid_: Search、Filter、Find

**Cursor（游标）**：
分页结果里的 `nextCursor`：上一页最后一个 Node 的 id，原样传回取下一页。它不在服务器上保存任何状态。
_Avoid_: Page token、Offset、Session
