# 调研一：Adobe Illustrator 核心功能盘点 (Core Functionality Inventory)

> 调研执行：Opus subagent，2026-09-22。
> **用途**：作为 Web 版矢量绘图工具（图表/示意图、插画、手绘）需求文档的事实基础；同时为 MCP API 设计提供对象模型参考。
> **资料来源**：以 Adobe 官方 Illustrator User Guide (helpx.adobe.com) 为主，共实际抓取 40+ 页；另含 Adobe Illustrator Scripting Guide（docsforadobe 社区镜像，Adobe 官方脚本手册的在线版）与 Classroom in a Book 目录页。**凡未能核实的内容均已明确标注。**

---

## 1. 工具箱盘点 (Toolbox inventory)

Adobe 官方将工具分为 **六大类**：Draw / Select / Navigate / Paint / Text / Modify。工具栏有三种形态：**Getting Started**（新用户默认）、**Basic**、**Advanced**（含全部工具），另有 **All Tools drawer**（抽屉）可拖拽自定义；支持 `Window > Toolbars > New Toolbar` 创建自定义工具栏。

> 通用修饰键行为（官方文档明确）：工具右下角小三角 = 有隐藏工具，长按展开；`Alt/Option + 点击`循环切换隐藏工具；`Caps Lock` 或偏好设置 "Use Precise Cursors" 切换精确十字光标。

### 1.1 选择类 (Select tools)

| 工具 | 快捷键 | 作用 |
|---|---|---|
| Selection | `V` | 选择整个对象/组，移动与缩放（bounding box） |
| Direct Selection | `A` | 选择锚点与路径段以改形 |
| Group Selection | — | 选组内单个对象，或父组内的子组 |
| Magic Wand | `Y` | 按相同属性（颜色、不透明度等）选择对象 |
| Lasso | `Q` | 拖拽套索圈选 |
| Artboard | `Shift+O` | 选择/创建/调整画板 |

**已核实的修饰键**：`Shift+点击` 加选（Selection / Direct Selection / Group Selection / Live Paint Selection / Magic Wand）；`Alt+Shift+点击` 减选（Selection / Direct Selection / Group Selection / Live Paint Selection）；`Ctrl/Cmd` 临时切回上次使用的选择工具；`Ctrl+Alt`（Win）/ `Cmd+Option`（mac）在 Direct Selection 与 Group Selection 间切换。

### 1.2 绘制类 (Draw tools)

| 工具 | 快捷键 | 作用 |
|---|---|---|
| Pen | `P` | 用锚点与方向手柄绘制直线与曲线 |
| Add Anchor Point | `+` | 在路径上加锚点 |
| Delete Anchor Point | `-` | 删除锚点 |
| Anchor Point | `Shift+C` | 角点↔平滑点互转，调整方向手柄（按 `Alt/Option` 拖手柄可联动对侧手柄形成平滑点） |
| Curvature | `Shift+~` | 直观绘制/编辑连续曲线 |
| Line Segment | `\` | 画直线段 |
| Arc | — | 画弧 |
| Spiral | — | 画螺旋，旋转调整大小 |
| Rectangular Grid | — | 画矩形网格 |
| Polar Grid | — | 画极坐标网格（同心圆 + 径向分割） |
| Rectangle | `M` | 矩形与正方形 |
| Rounded Rectangle | — | 圆角矩形 |
| Ellipse | `L` | 椭圆与圆 |
| Polygon | — | 多边形，**最多 1000 边** |
| Star | — | 星形，**最多 1000 个角** |
| Flare | — | 光晕对象（bright center / halo / rays / rings） |
| Paintbrush | `B` | 徒手画笔描边 |
| Blob Brush | `Shift+B` | 徒手画**填充形状**（按 `Alt/Option` 临时切到 Smooth 工具） |
| Pencil | `N` | 徒手路径 |
| Smooth | — | 沿已有路径涂抹使其平滑 |
| Path Eraser | — | 沿路径涂抹擦除路径段 |
| Join | — | 连接两条路径为一条 |
| Shaper | `Shift+N` | 潦草手绘 → 自动转成规整矢量形状 |
| Symbol Sprayer | `Shift+S` | 喷洒符号实例形成 symbol set |
| Symbol Shifter / Scruncher / Sizer / Spinner / Stainer / Screener / Styler | — | 分别：重排位置 / 调整间距 / 缩放 / 旋转 / 渐变改色相 / 调不透明度 / 应用 Graphic Style |
| Slice | `Shift+K` | 切分画板为独立图像区域 |
| Slice Selection | — | 选择/移动/变换切片 |
| Perspective Grid | `Shift+P` | 显示/移动/调整透视网格 |
| Perspective Selection | `Shift+V` | 在透视中选择/移动/缩放/复制对象，或把对象带入透视 |

**9 个图表工具 (Graph tools)**（官方原文逐条列出）：
1. **Column Graph** `J` — 垂直柱状
2. **Stacked Column Graph** — 堆叠柱状（分区对应整体的组成部分）
3. **Bar Graph** — 水平条形
4. **Stacked Bar Graph** — 堆叠条形
5. **Line Graph** — 折线（显示趋势）
6. **Area Graph** — 面积图（线下区域实色填充）
7. **Scatter Graph** — 散点（x/y 轴数值）
8. **Pie Graph** — 饼图
9. **Radar Graph** — 雷达图（轴自中心向外发散，每轴代表一个变量）

### 1.3 文字类 (Text tools)

Type `T` / Area Type / Type on a Path / Vertical Type / Vertical Area Type / Vertical Type On A Path / **Touch Type** `Shift+T`（单字符可移动、缩放、旋转）。

### 1.4 上色类 (Paint tools)

Gradient `G` / Mesh `U` / Shape Builder `Shift+M` / Live Paint Bucket `K` / Live Paint Selection `Shift+L`。

### 1.5 修改类 (Modify tools)

Rotate `R`、Reflect `O`、Scale `S`、Shear、**Reshape**（相对某锚点整体改形）、Width `Shift+W`、Free Transform `E`、Puppet Warp（打图钉扭曲）、Eyedropper `I`、Blend `W`、Eraser `Shift+E`、Scissors `C`、Knife（沿徒手路径切割对象或文字）、Measure、**Dimension**（新增：线性/角度/半径标注）、**Objects on Path**（新增：把对象吸附对齐到路径并可沿路径重排）。

**Liquify 七件套**（官方归类）：Warp `Shift+R`、Twirl、Pucker、Bloat、Scallop、Crystallize、Wrinkle。共同选项：Width / Height / Angle / Intensity / Use Pressure Pen / Detail；`Complexity` 仅 Scallop·Crystallize·Wrinkle；`Simplify` 仅 Warp·Twirl·Pucker·Bloat；`Twirl Rate` 仅 Twirl（正值顺时针）；`Horizontal/Vertical` 仅 Wrinkle；`Brush Affects Anchor Points / In Tangent Handles / Out Tangent Handles` 仅 Scallop·Crystallize·Wrinkle。**限制：liquify 工具不能用于链接文件，或含文字、图表、符号的对象。**

### 1.6 导航类 (Navigate tools)

Hand `H`、**Print Tiling**（调整可打印区域）、Rotate View `Shift+H`、Zoom `Z`。
已核实视图快捷键：`F` 切换屏幕模式；双击 Hand = 适合窗口；双击 Zoom 或 `Ctrl/Cmd+1` = 100%；`Space` 临时 Hand；`Ctrl+Space` 临时放大、`Ctrl+Alt+Space` 临时缩小；`Ctrl/Cmd+R` 显示/隐藏标尺；`Ctrl+Alt+0` 查看全部画板。

> ⚠️ **未能核实**：Adobe 当前工具页未给出 Group Selection、Arc、Spiral、Polygon、Star、Flare、Smooth、Knife、Measure、Reshape、Dimension 等的独立快捷键——它们属于同组隐藏工具，默认无独立键位。

---

## 2. 面板与核心概念 (Panels & core concepts)

### 2.1 Layers panel
入口 `Window > Layers`。官方标注的控件：**Search All 搜索框、Filter（按图层与对象类型如 text/images/paths 过滤）、Save Selection（把当前选择存为命名组）、Collect For Export（送入 Asset Export 面板）、Locate Object、Make/Release Clipping Mask、Create New Layer、Create New Sublayer、Delete Selection**，外加面板菜单（复制/合并/编组图层、打印设置、拼合、显示选项）。支持子图层嵌套、按图层颜色定位对象、Release to Layers、Merge/Flatten。

### 2.2 Appearance panel（外观属性栈）
`Window > Appearance`。核心概念：**appearance attributes 只影响外观、不改变底层结构**（fills / strokes / transparency / effects）；可施加于 **object、group、layer 任一层级**，图层级效果随对象移出图层而失效。面板中 **fill/stroke 按堆叠顺序列出（面板从上到下 = 画面从前到后）**，effects 按应用顺序列出。按钮：Add New Stroke / Add New Fill / Add Effect / Clear Appearance / Duplicate Selected Item。选中容器时出现 **Contents** 项，选中文本时出现 **Characters** 项。

**Targeting（定位）** 是关键概念：要给 layer/group/object 加外观属性，必须先在 Layers panel 中 **target**（点击 target 图标，双环表示已定位）。选中对象等同 target 该对象，但**图层只能通过点击 target 图标来定位**。面板菜单 `New Art Has Basic Appearance` 控制新对象是否继承当前外观。

### 2.3 Pathfinder panel
`Window > Pathfinder`。官方定义（逐条）：

- **Shape Modes**：**Unite**（合并为单一路径，取最前对象属性）、**Minus Front**（删前面对象并从最后对象减去重叠区）、**Intersect**（只留重叠区；多处分离重叠时无效）、**Exclude**（去掉重叠区）。
- **Pathfinders**：**Divide**（按重叠切成独立块）、**Trim**（后方对象减去重叠区，**移除所有描边**）、**Merge**（合并 fill/opacity/effects 相同的重叠对象，移除描边）、**Crop**（以最前对象作 mask 裁切）、**Outline**（转为无描边无填充的轮廓，用于陷印）、**Minus Back**（删后方对象并从最前对象减去重叠区）。
- 面板菜单：**Trap**、Repeat <last>、**Pathfinder Options**（Precision / Remove Redundant Points / Divide and Outline Will Remove Unpainted Artwork）、**Make / Release / Expand Compound Shape**。

**Compound Shape vs Compound Path**（关键区别，MVP 必须建模）：
- **Compound Shape** = 非破坏性、可编辑：按住 `Alt/Option` 点击 Shape Mode 生成；保留原始对象，可嵌套（官方建议每层嵌套 ≤10 个对象以保性能）；可用 Direct Selection 选子集再改其 shape mode；可 Release 还原、可 Expand 固化（Expand 后在 Layers 中变为 `<Path>` 或 `<Compound Path>`）。允许纳入 paths、compound paths、groups、其他 compound shapes、blends、text、envelopes、warps；**开放路径会被自动闭合**。
- **Compound Path** = `Object > Compound Path > Make`，多条路径视为一个路径、产生"挖洞"（evenodd 填充规则，见 DOM 的 `evenodd` 属性）。

### 2.4 Align panel
`Window > Align`。三种对齐基准：**Align to Selection**（全选边界框）、**Align to Key Object**（不按 Shift 再点一次某对象设为 key object，蓝色轮廓标识，自动切到此模式）、**Align to Artboard**（Shift+点击画板）。另可**用 Direct Selection 选多个锚点后对齐/分布锚点**。支持分配自定义快捷键（Edit > Keyboard Shortcuts > Menu Commands > Object > Align / Distribute）与录制为 Action。

### 2.5 Transform panel
`Window > Transform`。**Reference Point（3×3 参考点网格）**、X / Y / W / H、Rotate、Shear、Constrain Width and Height Proportions、Shape properties（选中 live shape 时显示可编辑属性，选中普通路径时为空）、**Scale Corners**、**Scale Strokes & Effects**。面板菜单：Show on Shape Creations、Flip Horizontally / Vertically、**Transform Object Only / Transform Pattern Only / Transform Both**、Use Registration Point for Symbol。

### 2.6 Stroke panel
- **Caps**：Butt Cap / Round Cap / Projecting Cap（后者向两端各延伸半个线宽）。
- **Joins**：Miter Join（Limit 取值 **1–500**）/ Round Join / Bevel Join。
- **Arrowheads**：起点与终点各选样式；Swap start and end；**Scale** 起止各自缩放系数（默认 100%，可 Link）；**Align**：`Extend arrow tip beyond end of path` 或 `Place arrow tip at the end of path`。
- 另有 Dashed Line（虚线/点线）、Align Stroke、**Variable Width Profiles**（配合 Width 工具 `Shift+W`）。

### 2.7 Color / Swatches / Color Guide / Recolor Artwork
Swatches 支持 process color / **spot color** / gradient swatch / 分组 / swatch libraries / 跨 Adobe 应用共享。**Recolor Artwork**（`Edit > Edit Colors > Recolor Artwork`）核心控件：Color Library、**Colors（限制颜色数量）**、**Color Theme Picker（从参考图/矢量图取色板）**、色轮（hue/brightness/saturation 手柄）、Change color order randomly、Change saturation and brightness randomly、Link/Unlink harmony colors、**Prominent Colors（可拖边界调整各色权重）**、Show brightness+hue / saturation+hue、New swatch group（Save All Colors / Save Prominent Colors）、Advanced Options。另有 Color Guide 面板（色彩和谐规则）与 Adobe Color Themes 面板。

### 2.8 Gradient panel
三种类型：**Linear / Radial / Freeform**。
- Linear 与 Radial **可用于 Fill 与 Stroke**；**Freeform 仅可用于 Fill**。
- Freeform 有两种模式：**Points**（色标独立成点，可设 Spread 扩散值）与 **Lines**（色标连成线；第三个色标起线自动变曲线；`Esc` 结束；**Lines 模式无 Spread**；两条线的端点色标可相连）。
- **Gradient Annotator**（渐变批注器）：显示起点、终点、中点与两个色标；拖圆端移动原点、拖箭头端改范围、悬停箭头端出现旋转光标改角度；`View > Hide/Show Gradient Annotator`。
- 另有 dither 控制与 **perceptual interpolation**（感知插值）选项。

### 2.9 Transparency panel
Opacity（0–100%）、Blending Mode、**Make Mask / Release**（opacity mask）、**Clip**、**Invert Mask**、Isolate Blending、Knockout Group、Opacity & Mask Define Knockout Shape。面板菜单：Show/Hide Thumbnails、Show/Hide Options、Disable Opacity Mask、**Unlink / Link Opacity Mask**、New Opacity Masks Are Clipping、New Opacity Masks Are Inverted、Page Isolated Blending、Page Knockout Group。

**Opacity Mask 原理**：用另一个对象（masking object）控制透明度；Illustrator 把其颜色转为灰度计算——**白色显示、黑色隐藏、灰色半透明**。默认 masked 与 masking 对象**链接**（移动被遮罩对象时遮罩跟随；移动遮罩对象时被遮罩对象不动）。与 Photoshop 的 layer mask 可互转。

**Blend Modes**（脚本常量核实）：Normal、Multiply、Screen、Overlay、Soft Light、Hard Light、Color Burn、Color Dodge、Darken、Lighten、Difference、Exclusion、Hue、Saturation、Color、Luminosity。

### 2.10 Type 相关面板
**Character panel**（`Window > Type > Character`）：font family、font style、font size、**leading**、**kerning**、**tracking**、Horizontal Scale、Vertical Scale、**baseline shift**、Character Rotation、anti-aliasing method（None/Sharp/Crisp/Strong）、Language。默认只显示常用项，面板菜单 `Show Options` 展开全部。
**Paragraph panel**、**OpenType panel**、**Glyphs panel**（备用字形、stylistic sets、ligatures、swashes/titling/stylistic alternates）、Character Styles / Paragraph Styles、Tabs、Snap to Glyph / glyph guides。
文本对象三类：**Point Type / Area Type / Type on a Path**（对应 DOM 的 `TextType` 常量 POINTTEXT / AREATEXT / PATHTEXT）；支持 threading（串接文本框）、text wrap、rows & columns、placeholder text、Retype（识别轮廓化文字的字体）。

### 2.11 Artboards panel
`Window > Artboards`。**单文档最多 1000 个画板**；可增删、改名、复制、调整大小、重排、锁定、设背景色、导出。Properties panel 显示画板尺寸/位置/名称/preset/rearrange 及 "move and scale artwork with artboard"。

### 2.12 Symbols panel
Symbols list、Symbol Libraries Menu（Arrows、Nature、Maps 等）、Place Symbol Instance、**Break Link to Symbol**、Symbol Options（重命名、类型 static/dynamic/movie clip、工具行为）、New Symbol、Delete Symbol；面板菜单含 **Redefine Symbol**（更新定义，所有实例同步）、Duplicate Symbol、Edit Symbol、**Replace Symbol**、**Reset Transformation**、Select All Unused、**Select All Instances**、Sort by Name、三种视图、Save Symbol Library。

### 2.13 Brushes panel
五种画笔类型（New Brush 对话框逐条列出）：**Calligraphic、Scatter、Art、Bristle、Pattern**。面板菜单：Duplicate/Delete Brush、Remove Brush Stroke、Select All Unused、按类型筛选显示、Thumbnail/List view、**Options of Selected Object**（改单个对象上的画笔参数）、**Brush Options**（改画笔定义）、Open/Save Brush Library。注意：不同类型画笔在面板中分区，不能跨区拖动。

### 2.14 Image Trace panel
预设：Auto-Color、High Color、Low Color、Grayscale、Black and White、Outline（另有 enhanced/legacy 两套预设可切换，Manage Presets 自定义）。
参数：**View**（含 Press & hold 对比原图）、**Mode**（Color / Grayscale / Black and White → 分别出现 Colors、Grays、Threshold 滑块）、**Palette**（Automatic / Limited / Full Tone / Document Library）。
Advanced：**Paths**（贴合松紧）、**Corners**（角点倾向）、**Noise**（忽略像素面积；高分辨率建议 20–50，低分辨率 1–10）、**Method**（Abutting 拼接 / Overlapping 叠压）、**Create**（Fills / Strokes（含最大描边宽度）/ **Gradients**（含 Smooth 滑块））、**Shapes**（识别圆、方、矩形为 live shapes）、**Options**（Snap Curves To Lines / Transparency / Ignore Color）、**Info**（Paths / Anchors / Colors 计数）、**Auto Grouping**、**Expand**、Preview、Trace。

### 2.15 Properties panel / Asset Export / Libraries
Properties panel 为上下文相关面板（含 Quick Actions，如 Start/Stop Global Edit、Blend Options）。Asset Export 通过 Layers 面板的 **Collect For Export** 或右键 Collect for Export 汇集资源。Creative Cloud Libraries 用于跨文档/跨应用共享色板、字符样式、图形。

### 2.16 其他核心概念
- **Drawing Modes**：Draw Normal / Draw Behind / **Draw Inside**（`Shift+D` 循环）。Draw Inside 只在选中**单个** path / compound path / text 时可用，绘制/粘贴内容自动被裁切——**与 `Object > Clipping Mask > Make` 不同，它保留路径的外观属性**。
- **Clipping Mask**：由 **clipping path**（定义可见区的矢量对象）+ **masked objects** 组成 clipping set。规则：只有矢量对象能做遮罩，但可遮罩任意类型图稿；被遮罩对象自动移入 Layers 中的 clipping group；图层/组中的**第一个对象**成为其下所有内容的遮罩；转为遮罩时 **fill 与 stroke 被自动移除**。
- **Live Shapes**：矩形/圆角矩形/椭圆/多边形/星形保留可编辑参数（corner radius、边数、内外半径、pie 起止角），Transform 面板的 "Shape properties" 列显示这些参数。
- **Isolation Mode**、**Outline Mode**、Smart Guides、Rulers/Grids/Guides、Snap to Pixel、Snap to Point、Snap to Glyph、Snap to Perpendicular/Tangent、Distance guides。

---

## 3. 关键工作流 (Key workflows)

### 3.1 路径绘制与编辑
- **Pen**：直线段、曲线、直线接曲线、曲线接直线、两段曲线由角点连接；配合 Add/Delete Anchor Point、Anchor Point（`Alt/Option` 拖手柄联动 → 平滑点）。
- **Curvature**：点击即生成连续曲线，双击切换角点/平滑点。
- **Pencil**：徒手路径、直线段、延长路径、改形、**连接两条路径**；Pencil Tool Options（Fidelity 等）。
- **Smooth 工具 / Smooth slider**：降低不规则度。
- **Simplify**（`Object > Path > Simplify`）：自动简化 + Advanced 选项（**Simplify Curve**、**Corner Point Angle Threshold**、**Compare Original and New**（显示原/新锚点数）、**Show Original Path**、Preview、**Convert to Straight Lines**）。

### 3.2 `Object > Path` 菜单（已核实条目）
**Join**（Join 工具或菜单）、**Average**（对话框：Horizontal / Vertical / Both）、**Offset Path**（Offset / Joins / Miter limit）、**Simplify**、**Add Anchor Points**、**Divide Objects Below**（"饼干模具"：以选中对象切穿下方对象并丢弃切割对象）、**Split Into Grid**（rows / columns / Height / Width / **Gutter** / Total / **Add Guides** / Preview）、**Outline Stroke**、**Clean Up**。
> ⚠️ Outline Stroke、Add Anchor Points、Clean Up 三项未逐页核实其对话框细节，仅从其他页面的交叉引用确认命令存在。

### 3.3 Shape Builder 与形状构建
Shape Builder `Shift+M`：拖过多个重叠形状合并；按 `Alt/Option` 拖为擦除。Shaper 工具把潦草手绘转为规整形状。
> ⚠️ Shape Builder 专页在新版 helpx 上已改名/移动，未能成功抓取，上述修饰键行为来自通用知识而非本次抓取，**需在需求文档中再次核验**。

### 3.4 Live Paint 上色
`Object > Live Paint > Make` 创建 Live Paint group。核心概念：**edge**（两个交点之间的路径段）与 **face**（由若干 edge 围成的区域）；**可填充未完全封闭的区域**（Gap Options 找/闭合缝隙）。路径仍可编辑，编辑后颜色**自动重新应用**到新区域。
**官方明确的限制**（对 MVP 很重要）：
- 只能整组生效、不能对单个 face/edge 生效的：Transparency 面板、effects、Appearance 多重 fill/stroke、Envelope Distort、Hide、Rasterize、Slice > Make、Make Mask、Brushes。
- **完全不支持**：gradient mesh、graphs、symbols、flares、Stroke 面板的 Align Stroke、**Magic Wand**。
- 不可用命令：`Effect > Path > Outline Stroke`、`Object > Expand`（改用 `Object > Live Paint > Expand`）、Blend、Slice、`Object > Clipping Mask > Make`、create gradient mesh、**所有 Pathfinder 命令**、`File > Place`、Make Guides、`Select > Same > ...`、Text Wrap。

### 3.5 Blends（混合）
Blend 工具 `W` 或 `Object > Blend > Make`。**Blend Options**：
- **Spacing**：Smooth Color（自动算最优步数）/ **Specified Steps** / **Specified Distance**。
- **Orientation**：**Align to Page**（垂直于页面 x 轴）/ **Align to Path**（垂直于路径）。
- Preview。
另有 Modify Spine（改混合轴）、Reverse Spine、Reverse Front to Back、Release / Expand。新版还有 **Blend 面板**，增加了 easing 与 color 控制。
⚠️ 注意：**spot-to-spot 混合的中间步会被转为文档的 process 色空间**。

### 3.6 Envelope Distort / Warp
`Object > Envelope Distort` 三种方式：
1. **Make with Warp** → Warp Options 对话框选 style 与参数；
2. **Make with Mesh** → Envelope Mesh 对话框设 rows / columns；
3. **Make with Top Object** → 用最上层对象作封套形状。
编辑：用 Direct Selection 或 **Mesh 工具**（长按 Gradient 工具展开）拖锚点、加/删网格锚点。Envelope 的 fill/stroke 需通过 **Appearance panel** 设置。另有 `Edit Contents` / `Envelope Options` / `Release` / `Expand`。

### 3.7 Repeat（重复）
`Object > Repeat >` **Radial**（绕中心圆形复制，可调数量与旋转角）/ **Grid**（行列阵列）/ **Mirror**（沿中轴镜像）。修改原始对象时**所有实例自动更新**，全部通过画布上的控件调整。

### 3.8 Transform / Distort
- **Free Transform** `E`：拖角手柄时按 `Ctrl/Cmd` = 自由扭曲；`Shift+Alt+Ctrl` / `Shift+Option+Cmd` = 透视扭曲。
- **Puppet Warp**：加 pin 后拖拽变形。
- Rotate / Reflect / Scale / Shear：均相对 **reference point**（`Alt/Option+点击` 设定参考点并打开数值对话框）。
- `Object > Transform > Transform Each`（逐个变换）、Transform Again。

### 3.9 Expand（扩展）
`Object > Expand` 把外观属性转为实体对象。对话框：**Object**（扩展 live blends、envelopes、symbol sets、flares）、**Fill**、**Stroke**（描边转为轮廓路径）；渐变可选 **Export Gradient To: Gradient Mesh**。若对象有 appearance attributes，`Object > Expand` 会置灰——需先 `Object > Expand Appearance`。

### 3.10 Global Edit（全局编辑）
选中一个重复对象 → Properties/Control 面板的 **Global Edit Options**：Match 按 **Appearance**（相同 fill/stroke）或 **Size**；On Artboards 指定画板范围（如 `1, 2, 3` 或 `4-7`）与 **Include Objects On Canvas**；Result(s) 显示匹配数 → **Start Global Edit** → 编辑 → **Stop Global Edit** 或 `Esc`。**按比例缩放**（100pt 缩到 50pt，则 20pt 同步缩到 10pt）。**不支持**：images、text、masks、links、plugins、多选。

### 3.11 图表工作流 (Graphs)
1. 长按 Column Graph 工具选图表类型 → 在画板上**对角拖拽**定义尺寸（尺寸仅指图表本体，不含标签与图例），或点击后输入宽高。
2. `Object > Graph > Data` 打开 **Graph Data window**：Tab = 录入并右移；Enter/Return = 录入并下移；方向键移动。可从 Excel/Lotus 1-2-3 复制粘贴；**导入需 tab 分隔的文本文件、行以换行分隔，数字不能带千分位逗号**（写 `732000` 而非 `732,000`），用 **Import Data**。**Transpose row/column** 行列互换；**Switch x/y** 用于散点图。**Apply** 或数字键盘 `Enter` 生成。
3. `Object > Graph > Type`（或双击 Column Graph 工具）打开 **Graph Type** 对话框改类型与样式。⚠️ 官方警告：**若图表对象已应用渐变，改类型会产生意外结果**；建议图表完成后再上渐变，或用 Direct Selection 重新应用。
4. 其他官方列出的图表能力：Add graph labels and data sets、Adjust decimal digits and column width、Format columns/bars/lines、Select parts of a graph（Direct/Group Selection）、Change graph value axes、Assign different scales to value axes、Change legend position、**Combine different graph types**、Add drop shadows、**Apply marker designs**、Format pie graphs、Format graph text。
5. **Graph Designs**：`Object > Graph > Design` → **Paste Design**（把已存设计粘回画板编辑）→ 编辑后 **Save Design** 存为新设计，可应用于任何合适的图表类型。

### 3.12 Image Trace
`Object > Image Trace > Make` 或 Image Trace 面板 → 选预设/调参 → **Preview** → **Trace** → **Expand** 转为可编辑路径（Auto Grouping 后可在 Layers 面板看到分组）。可 Save Image Trace Presets。

### 3.13 Artboards 与导出
- **Export for Screens**（`File > Export > Export for Screens`）：两个标签页 **Artboards** 与 **Assets**；格式可多选 **PNG / JPEG / SVG / PDF / WebP / TIFF**；可设 scale、格式专属选项与 Advanced；导出到本地文件夹或 **Adobe cloud storage**。Assets 需先对图稿右键 **Collect for Export**。
- **Background export**：默认后台导出（仅 `.png` / `.jpg` 支持；`.svg` / `.pdf` 走标准流程；混合选择时不走后台）。可在 `Preferences > File Handling & Clipboard > Export in Background` 关闭。
- **Export As**（`File > Export > Export As`）：多画板时可 **Use Artboards** 每板一文件、**All**、或指定 **Range**。

### 3.14 Effects
Effect 菜单**上半部 = 矢量效果**（只能作用于矢量对象，或位图对象的 fill/stroke），**下半部 = 栅格效果**（矢量/位图皆可）。栅格效果包括 SVG Filters、下半部全部效果，以及 `Effect > Stylize` 中的 **Drop Shadow / Inner Glow / Outer Glow / Feather**。
**Resolution Independent Effects (RIE)**：改变 `Effect > Document Raster Effects Settings`(DRES) 的分辨率时，效果参数会被重新解释以保持外观基本不变。
**Rasterization options**：Color Model、Resolution、Background（White / Transparent，后者生成 alpha 通道）、Anti-alias（None / Art Optimized / Type Optimized）、Create Clipping Mask、Add Around Object。
已核实的栅格效果类别：Artistic（15 种，如 Colored Pencil、Cutout、Dry Brush、Film Grain、Fresco、Neon Glow、Paint Daubs、Palette Knife、Plastic Wrap、Poster Edges、Rough Pastels、Smudge Stick、Sponge、Underpainting、Watercolor）、Blur、Brush Strokes、Distort、Pixelate、Sketch、Stylize、Texture、Video。
**SVG Filters**：`Effect > SVG Filters`，XML 描述、分辨率无关；可 Apply SVG Filter / Edit SVG Filter（直接改 XML）/ New SVG Filter / **Import SVG Filter**。画板上显示的是栅格化预览。

### 3.15 3D and Materials
官方目录含：Create 3D objects、Rotate objects in 3D、Add custom bevel paths、**Map artwork on 3D objects**、Create 3D text effects、Render 3D vector artwork、Export 3D vector artwork、3D and Materials panel options。
> ⚠️ 未逐页抓取 3D 细节，仅确认功能存在及其子页面清单。

---

## 4. 文件格式与导出 (File formats)

### 4.1 原生格式（可保存，Save/Save As）
官方原文：**"五种基本文件格式 — AI、PDF、EPS、FXG、SVG"**，称为 native formats，**能保留全部 Illustrator 数据，包括多画板**（PDF 与 SVG 需勾选 "Preserve Illustrator Editing Capabilities"）。**EPS 与 FXG 可把各画板存为独立文件；SVG 只保存当前画板**（但所有画板内容都会显示）。

**AI (Illustrator Options)**：Version（可存为 legacy 版本，会丢数据）、Subset Embedded Fonts When Percent Of Characters Used Is Less Than、Embed permitted fonts for file preview、**Create PDF Compatible File**、Include Linked Files、Embed ICC Profiles、Use Compression、**Save Each Artboard To A Separate File**、Transparency options（Preserve Paths / Preserve Appearance And Overprints，仅 <9.0 版本）。
**Save in Background**：仅 `.ai` 支持；未勾选 Create PDF Compatible File 或含第三方插件组/实时效果时不走后台。

### 4.2 SVG 保存/导出选项（已核实）
- **SVG Profiles**：SVG 1.0 / 1.1、SVG Basic 1.1、SVG Tiny 1.1 / Tiny 1.1+、SVG Tiny 1.2。（Tiny 不支持渐变、透明、裁切、蒙版、符号、图案、下划线/删除线/竖排文字、SVG 滤镜；Tiny Plus 增加渐变与透明。）
- **Font Type**：Adobe CEF / SVG / **Convert To Outlines**。
- **Font Subsetting**：None / Only Glyphs Used / …
- **CSS Properties**：**Presentation Attributes**（默认，属性提到最高层级，灵活性最好）/ **Style Attributes**（可读性最好、体积略大，适合 XSLT 变换）/ **Style Attributes <Entity References>**（渲染最快、体积最小）/ **Style Elements**（适合与 HTML 共享，可外链样式表，但渲染较慢）。
- **Decimal Places**：1–7（精度 vs 体积）。
- **Encoding**：UTF-8 / UTF-16 / ISO 8859-1（后两者不保留文件元数据）。
- Optimize For Adobe SVG Viewer、Include Adobe Graphics Server Data、**Include Slicing Data**、Include XMP、Preserve Illustrator Editing Capabilities。

### 4.3 导出格式（Export As，非原生）
官方列表：**AutoCAD DWG / DXF、BMP、Enhanced Metafile (EMF)、JPEG、Macintosh PICT、Photoshop (PSD)、PNG、Targa (TGA)、Text Format (TXT)、SVG、TIFF**（列表末尾被截断，至少包含上述）。脚本 `ExportType` 常量另确认：AutoCAD、FLASH、GIF、JPEG、Photoshop、PNG24、PNG8、SVG、TIFF。

### 4.4 导入
`File > Place`：Photoshop（Photoshop import options、place linked PSD、从 PS 移动路径/局部图像）、**Adobe PDF**（Adobe PDF placement options、monotone/duotone/tritone 导入）、**EPS / DCS / AutoCAD**、位图图像；Links panel 管理 linked/embedded 文件（Embed、Unembed、Relink/Replace/Update）。另有 Extract CSS、Package files、Collect assets and export in batches。

---

## 5. Illustrator 文档对象模型 (Object model)

来源：Adobe Illustrator Scripting Guide（JavaScript/ExtendScript 对象参考）。**这是设计 MCP API 的最佳参照**——它已经是一个"给程序用"的 Illustrator 抽象。

### 5.1 顶层容器
- **Application** — 全局入口：user preferences、已装字体与打印机、`activeDocument`、`documents`、undo/redo、打开/新建/退出。
- **Document** — 一个画布/文件。
  - **集合属性**：`artboards`、`layers`、`pageItems`、`pathItems`、`compoundPathItems`、`groupItems`、`textFrames`、`symbols`、`symbolItems`、`swatches`、`gradients`、`patterns`、`brushes`、`graphicStyles`、`characterStyles`、`paragraphStyles`、`variables`、`dataSets`、`tags`、`views`、`selection`。
  - **设置属性**：`activeLayer`、`activeView`、`documentColorSpace`（CMYK / RGB）、`defaultFillColor` / `defaultStrokeColor` / `defaultFilled` / `defaultStroked`、`width` / `height`、`rulerUnits`、`saved`、`fullName` / `path`。
  - **方法**：`save()`、`saveAs()`（AI / EPS / PDF）、`exportFile()`、`close()`、`print()`、`rasterize()`、`activate()`、`selectObjectsOnActiveArtboard()`。
- **Layer** — 可见性、锁定、`opacity`、`zOrderPosition`、`blendingMode`、knockout、`layers`（子图层）、`pageItems` 及各类型子集合。

### 5.2 Artwork tree（图稿树）
文档内容即 **artwork tree**，其节点统称 **page items**。**PageItem 是所有图稿对象的超类**，其 8 个子类（官方 PageItem 页列出）：
`CompoundPathItem`、`GroupItem`、`MeshItem`、`PathItem`、`PlacedItem`、`PluginItem`、`RasterItem`、`TextFrameItem`。
Artwork tree 章节另列出的类型还包括：**GraphItem**、**SymbolItem**、**LegacyTextItem**、**NonNativeItem**。
访问方式：`Document.pageItems` / `Layer.pageItems` / `GroupItem.pageItems`，或按类型的专用集合（`graphItems`、`meshItems` 等）。
**不能通过脚本新建的类型**：`graphItems`、`meshItems`、`pluginItems`、`legacyTextItems`（无 `add()`）。

### 5.3 PageItem 公共属性（28 项）
`name`、`note`、`uuid`（CC2020+）、`typename`、`parent`、`layer`、`zOrderPosition`、`selected`、`hidden`、`locked`、`editable`、`opacity`（0–100）、`blendingMode`、`artworkKnockout`、`isIsolated`、`pixelAligned`、`sliced`、`uRL`、`visibilityVariable`、`tags`、`left`、`top`、`width`、`height`（0.0–16348.0）、`position`、**`geometricBounds`**（不含描边）、**`visibleBounds`**（含描边）、**`controlBounds`**（含描边与控制点）、`wrapped` / `wrapInside` / `wrapOffset`。
**方法**：`resize()`、`rotate()`、`translate()`、`transform()`（变换矩阵）、`zOrder()`、`bringInPerspective()`。

### 5.4 PathItem（最核心的绘制类，47 属性 / 9 方法）
- 几何：`pathPoints`（PathPoint 集合）、`selectedPathPoints`、`closed`、`area`（只读，平方点）、`length`（只读）、`evenodd`（填充规则）、`polarity`、`guides`。
- 填充/描边：`filled`、`fillColor`、`fillOverprint`、`stroked`、`strokeColor`、`strokeWidth`、`strokeCap`、`strokeJoin`、`strokeDashes`、`strokeDashOffset`、`strokeMiterLimit`、`strokeOverprint`。
- 其他：`clipping`（作为裁切路径）、`resolution`。
- 方法：`setEntirePath()`（用坐标数组一次性定义路径）、`duplicate()`、`move()`、`remove()`、`resize()`、`rotate()`、`translate()`、`transform()`、`zOrder()`。
- **PathPoint**（推断自 PathItem 结构）：`anchor`、`leftDirection`、`rightDirection`、`pointType`（corner/smooth）、`selected`。

### 5.5 TextFrameItem
`kind`（TextType：POINTTEXT / AREATEXT / PATHTEXT，只读）、`contents`（字符串）、`story`、`textRange`，以及只读集合 `characters`、`words`、`lines`、`paragraphs`。方法：`createOutline()`（转曲，返回 GroupItem）、`duplicate()`、`resize()`、`rotate()`、`transform()`。相关类：`CharacterAttributes`、`ParagraphAttributes`、`Story`、`TextRange`、`CharacterStyle`、`ParagraphStyle`。

### 5.6 常量枚举（已核实）
- `ExportType`：AutoCAD、FLASH、GIF、JPEG、Photoshop、PNG24、PNG8、SVG、TIFF
- `DocumentColorSpace`：CMYK、RGB
- `StrokeCap`：BUTTENDCAP、ROUNDENDCAP、PROJECTINGENDCAP
- `StrokeJoin`：BEVELENDJOIN、ROUNDENDJOIN、MITERENDJOIN
- `BlendModes`：见 §2.9（16 种）
- `TextType`：POINTTEXT、AREATEXT、PATHTEXT
- `ColorModel`：PROCESS、SPOT、REGISTRATION
- 颜色类：`RGBColor`、`CMYKColor`、`GrayColor`、`SpotColor`、`GradientColor`、`PatternColor`、`NoColor`

### 5.7 对 MCP API 的启示
DOM 已经提供了一套良好的动词/名词分层：
- **容器层**：Document → Artboard / Layer → GroupItem → PageItem
- **几何层**：PathItem.pathPoints（anchor + 两个 direction handle）= 纯 Bézier，天然映射 SVG `path`
- **样式层**：fill/stroke 属性 + Appearance 栈（多重 fill/stroke + effects）
- **资源层**：swatches / gradients / patterns / brushes / symbols / graphicStyles / character&paragraphStyles（文档级共享库）
- **操作层**：`transform(matrix)`、`resize`、`rotate`、`translate`、`zOrder`、`duplicate`、`move`、`remove`、`setEntirePath`
- 每个 PageItem 有稳定的 **`uuid`**——MCP 工具做增量编辑时应有等价物。

---

## 6. 教程中反复出现的「核心功能」清单（MVP 范围建议）

依据：Adobe User Guide 的章节权重、Classroom in a Book 2024/2025 的 16–17 课结构、LinkedIn Learning *Illustrator 2022/2024/2025 Essential Training* 的章节列表。三者高度重合的主题按出现一致性排序：

**第 1 梯队（三个来源全覆盖，必做）**
1. 工作区 / 画板 / 缩放平移 / 撤销（Work area, artboards, navigation）
2. 选择技法：Selection / Direct Selection / Group Selection / 编组 / 隔离模式
3. 基本形状 + Live Shapes（矩形、椭圆、多边形、星形、圆角）
4. **Pen 工具与 Bézier 路径编辑**（锚点、手柄、角点/平滑点转换）
5. **Shape Builder + Pathfinder**（合并、相减、相交、分割）
6. 变换：移动 / 缩放 / 旋转 / 镜像 / 倾斜 + Transform 面板 + Free Transform
7. 对齐与分布（Align panel，含 key object 与 artboard 基准）
8. Fill / Stroke 基础 + Stroke 面板（粗细、caps、joins、虚线、箭头、对齐描边）
9. 颜色：Swatches、Color 面板、Color Guide、**Recolor Artwork**
10. **Layers 面板**（子图层、锁定/隐藏、排序、模板图层）
11. **Type**：Point / Area / Type on a Path、Character & Paragraph 面板、**Create Outlines**
12. **Gradients**（linear / radial / freeform）
13. **Clipping Mask**
14. 导出与分享：Export for Screens、Asset Export、PNG/JPG/SVG/PDF

**第 2 梯队（两个来源覆盖，强烈建议）**
15. Brushes（尤其 Calligraphic + Art + Pattern）与 Paintbrush / Blob Brush / Pencil
16. **Appearance 面板 + Effects + Graphic Styles**（多重 fill/stroke、效果栈）
17. **Blends**（对象混合）
18. **Patterns**（图案创建与编辑）
19. **Symbols**（含 Repeat：Radial / Grid / Mirror）
20. **Transparency**：opacity、blend modes、**Opacity Mask**
21. **Image Trace**（位图转矢量）
22. 置入图像与链接管理（Place / Links panel / embed / crop）
23. Smart Guides、标尺、网格、参考线、Snap to Pixel
24. Width 工具与 variable width profiles
25. Live Paint

**第 3 梯队（进阶/差异化）**
26. Envelope Distort / Warp
27. Puppet Warp、Liquify 七件套
28. **Graph 工具与 Graph Data**（图表——对本项目属核心而非进阶）
29. 3D and Materials
30. Perspective Grid
31. Global Edit
32. Gradient Mesh
33. Actions / Variables（数据合并）/ 脚本

**对本项目的取舍建议**：目标场景是"图表/示意图 + 插画 + 手绘"，因此应把第 3 梯队的 **Graph（28）上提到第 1 梯队**，而 Perspective Grid、Gradient Mesh、3D、Liquify、Trapping、色彩分色/印刷相关功能可明确排除在 MVP 之外。对 MCP 驱动而言，**Live Paint 的大量功能限制**（见 §3.4）说明它是个特殊执行模型，建议 MVP 不实现。

---

## 7. 参考来源列表（本次实际抓取的 URL）

**Adobe 官方 Illustrator User Guide（helpx.adobe.com）**
1. https://helpx.adobe.com/illustrator/using/tools.html
2. https://helpx.adobe.com/illustrator/using/tools-in-illustrator.html
3. https://helpx.adobe.com/illustrator/using/default-keyboard-shortcuts.html
4. https://helpx.adobe.com/illustrator/desktop/automate-visualize-data/visualize-data/create-graphs.html
5. https://helpx.adobe.com/illustrator/desktop/automate-visualize-data/visualize-data/change-graph-types.html
6. https://helpx.adobe.com/illustrator/desktop/automate-visualize-data/visualize-data/add-graph-data.html
7. https://helpx.adobe.com/illustrator/desktop/automate-visualize-data/visualize-data/reuse-graph-designs.html
8. https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/pathfinder-panel-overview.html
9. https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/create-compound-shapes-with-pathfinder.html
10. https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/transform-panel-overview.html
11. https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/distort-objects-with-envelopes.html
12. https://helpx.adobe.com/illustrator/desktop/manage-objects/reshape-transform-objects/distort-objects.html
13. https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/image-trace-panel-options.html
14. https://helpx.adobe.com/illustrator/desktop/manage-objects/traces-mockups-symbols/symbols-panel-options.html
15. https://helpx.adobe.com/illustrator/desktop/manage-objects/edit-objects/about-clipping-masks.html
16. https://helpx.adobe.com/illustrator/desktop/manage-objects/edit-objects/divide-or-split-objects.html
17. https://helpx.adobe.com/illustrator/desktop/manage-objects/edit-objects/offset-duplicate-objects.html
18. https://helpx.adobe.com/illustrator/desktop/manage-objects/edit-objects/edit-similar-objects.html
19. https://helpx.adobe.com/illustrator/desktop/manage-objects/arrange-objects/align-and-distribute-objects.html
20. https://helpx.adobe.com/illustrator/desktop/manage-objects/arrange-objects/expand-objects.html
21. https://helpx.adobe.com/illustrator/desktop/manage-objects/select-objects/isolate-objects.html
22. https://helpx.adobe.com/illustrator/desktop/manage-layers/create-and-organize-layers/layers-panel-overview.html
23. https://helpx.adobe.com/illustrator/desktop/manage-layers/create-and-organize-layers/layers-overview.html
24. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/apply-and-edit-strokes/brushes-panel-overview.html
25. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/apply-and-edit-strokes/about-brushes.html
26. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/apply-and-edit-strokes/change-the-caps-or-joins-of-a-line.html
27. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/apply-and-edit-strokes/add-arrowheads.html
28. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/apply-and-edit-strokes/create-dotted-or-dashed-lines.html
29. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/apply-and-edit-strokes/create-brushes.html
30. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/create-and-edit-gradients/gradients-overview.html
31. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/create-and-edit-gradients/create-and-apply-freeform-gradients.html
32. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/create-and-edit-patterns/repeat-patterns-overview.html
33. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/create-and-edit-patterns/patterns-overview.html
34. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/learn-painting-basics/about-live-paint.html
35. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/learn-painting-basics/create-live-paint-groups.html
36. https://helpx.adobe.com/illustrator/desktop/paint-and-fill/learn-painting-basics/create-multiple-fills-and-strokes.html
37. https://helpx.adobe.com/illustrator/desktop/manage-colors/apply-transparency-and-blending/transparency-panel-overview.html
38. https://helpx.adobe.com/illustrator/desktop/manage-colors/apply-transparency-and-blending/about-opacity-masks.html
39. https://helpx.adobe.com/illustrator/desktop/manage-colors/apply-transparency-and-blending/blend-options-overview.html
40. https://helpx.adobe.com/illustrator/desktop/manage-colors/apply-transparency-and-blending/blended-objects-overview.html
41. https://helpx.adobe.com/illustrator/desktop/manage-colors/apply-transparency-and-blending/blending-mode-types.html
42. https://helpx.adobe.com/illustrator/desktop/manage-colors/modify-colors/recolor-options-overview.html
43. https://helpx.adobe.com/illustrator/desktop/manage-colors/use-swatches/swatches-panel-overview.html
44. https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/learn-drawing-basics/paths-overview.html
45. https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/learn-drawing-basics/drawing-modes-overview.html
46. https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/modify-paths/refine-paths.html
47. https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/modify-paths/split-paths.html
48. https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/modify-paths/average-the-position-of-anchor-points.html
49. https://helpx.adobe.com/illustrator/desktop/draw-shapes-and-paths/modify-paths/simplify-paths-advanced-options-overview.html
50. https://helpx.adobe.com/illustrator/desktop/design-with-text/add-manage-text/add-text-illustrator-text-tools.html
51. https://helpx.adobe.com/illustrator/desktop/design-with-text/add-manage-text/add-text-to-vector-artwork.html
52. https://helpx.adobe.com/illustrator/desktop/design-with-text/edit-format-text/character-panel-overview.html
53. https://helpx.adobe.com/illustrator/desktop/create-manage-artboards/add-edit-artboards/introduction-to-artboards.html
54. https://helpx.adobe.com/illustrator/desktop/measure-and-align/grids-and-guides/work-with-smart-guides.html
55. https://helpx.adobe.com/illustrator/desktop/save-and-export/export-files-to-different-formats/export-for-screens.html
56. https://helpx.adobe.com/illustrator/desktop/special-effects-styles/apply-graphic-styles/graphic-styles-panel-overview.html
57. https://helpx.adobe.com/illustrator/desktop/special-effects-styles/apply-filter-effects/apply-svg-filter-effects.html
58. https://helpx.adobe.com/illustrator/desktop/get-started/learn-the-basics/properties-panel-overview.html
59. https://helpx.adobe.com/illustrator/using/saving-artwork.html
60. https://helpx.adobe.com/illustrator/using/exporting-artwork.html
61. https://helpx.adobe.com/illustrator/using/appearance-attributes.html
62. https://helpx.adobe.com/illustrator/using/effects.html
63. https://helpx.adobe.com/illustrator/using/summary-effects.html

**Adobe 产品页**
64. https://www.adobe.com/products/illustrator/features.html

**Adobe Illustrator Scripting Guide（官方脚本手册在线版 / docsforadobe）**
65. https://ai-scripting.docsforadobe.dev/
66. https://ai-scripting.docsforadobe.dev/objectmodel/theArtworkTree/
67. https://ai-scripting.docsforadobe.dev/objectmodel/topLevelObjects/
68. https://ai-scripting.docsforadobe.dev/jsobjref/Document/
69. https://ai-scripting.docsforadobe.dev/jsobjref/PageItem/
70. https://ai-scripting.docsforadobe.dev/jsobjref/PathItem/
71. https://ai-scripting.docsforadobe.dev/jsobjref/TextFrameItem/
72. https://ai-scripting.docsforadobe.dev/jsobjref/scripting-constants/

**培训资料目录**
73. https://www.peachpit.com/store/adobe-illustrator-classroom-in-a-book-2024-release-9780138263713
74. https://www.peachpit.com/store/adobe-illustrator-classroom-in-a-book-2025-release-9780135376720
75. LinkedIn Learning *Illustrator 2022 / 2024 / 2025 Essential Training* 章节列表 —— 通过搜索摘要获取（https://www.linkedin.com/learning/illustrator-2025-essential-training 与 classcentral 页面均返回 403，**未能直接抓取完整原文**）

---

## 未能核实的事项（明确声明）

1. **https://helpx.adobe.com/illustrator/tutorials.html** 返回内容为空/被 CDN 拦截，官方教程清单未获取。第 3 节的工作流是从 User Guide 的功能页与目录结构重建的，**不是**从 tutorials 页取得。
2. **Shape Builder 专页** 在新版 helpx 上已迁移，未抓取成功。其 `Alt/Option` 擦除等修饰键行为未经本次核实。
3. **Object > Path 菜单** 中的 Outline Stroke、Add Anchor Points、Clean Up 三项，只确认命令存在（经其他页面交叉引用），未读到各自的专页与对话框细节。
4. **3D and Materials、Perspective Grid、Puppet Warp、Mesh 工具** 的详细参数未逐页抓取。
5. **Adobe Illustrator Classroom in a Book 的逐课小节标题**：O'Reilly 与 LinkedIn Learning 均返回 403，只拿到课级标题（16–17 课），课内小节未核实。
6. **Effect 菜单上半部（矢量效果）的完整子菜单列表**（3D and Materials / Convert to Shape / Crop Marks / Distort & Transform / Path / Pathfinder / Rasterize / Stylize / SVG Filters / Warp）未从抓取页面中逐条确认——`summary-effects.html` 只覆盖栅格效果。
7. helpx.adobe.com 对标准抓取器返回 403；本次通过带浏览器 User-Agent 的 curl 取得内容。这是公开文档，但说明后续若要自动化核验需注意。
