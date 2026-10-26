# 国策树查看器 · HOI4 Focus Viewer

拖入 mod 文件夹，直接看《钢铁雄心 4》国策树结构图。

不装东西、不注册、不上传——双击 `index.html` 就能用，只在本机读 `common/national_focus/*.txt`。

![国策树预览](docs/preview.svg)

---

## 为什么做这个

这个需求九年前就被验证过：[FocusTreeAndEventManager](https://github.com/Minivera/FocusTreeAndEventManager)
（38 star / 32 fork）能管理和可视化国策树。但它是个 Windows 桌面 C# 程序，
**2018 年归档**，面对的是七八年前的游戏版本。

后来这个位置被网页端的 [钢之工坊](https://scharnhorst.hagane.works/) 接住了，
它做得很好，但形态是**托管服务**：要注册、项目存服务器、导出是 ZIP。

中间缺一档：

> **现代的、开源的、跑在你自己仓库里的查看器。**

这个项目就填这一档。它是只读的，不做编辑，不和谁抢位置。

## 用法

1. 下载这个仓库（`git clone` 或右上角 Download ZIP）
2. 双击 `index.html`
3. 把 mod 文件夹（或整个游戏目录）拖进页面

浏览器只在本地读文件，没有任何网络请求。

| 操作 | 效果 |
|---|---|
| 滚轮 | 缩放 |
| 拖动空白处 | 平移 |
| 单击节点 | 右侧展开详情，同时高亮整条前置/后继链 |
| 详情里的标签 | 点前置或互斥项，直接跳过去并居中 |
| 搜索框 | 按 id 过滤 |
| 搜索后按回车 | 跳到第一个命中项并居中 |
| `Esc` | 取消选中、关掉详情 |
| 导出 SVG | 存成图片 |

## 它做的事

- **解析 Clausewitz 脚本**：注释、引号字符串、嵌套块、BOM、裸露的列表值
- **换算坐标**：带 `relative_position_id` 的国策，把相对偏移解成绝对坐标
- **按 x / y 直接画**：HOI4 的坐标本来就是作者手写的，换算一下就是最终位置
- **区分边**：实线 = 前置，虚线 = 多组前置（满足其一），红色虚线 = 互斥
- **详情面板**：成本、坐标、前置分组、互斥项，以及 `available` / `completion_reward` / `bypass` 的原始脚本
- **条件解读**：把 `available` / `bypass` 翻成中文短句，并追溯标记是在哪个事件里设置的
- **显示真图标**：读 `interface/*.gfx` 建精灵索引，再把 `.dds` 解成 PNG 贴进图里；解不了就退回色块
- **只进必要的目录**：拖整个游戏目录时只走 `common/national_focus`、`events`、`interface`、`gfx/interface/goals`、`gfx/interface/ideas` 这几处。实测原版有 4,885 个 `.txt`、33,007 个 `.dds`，真正用得上的只有 209 个和 6,358 个
- **首屏不等图标**：先画树，`.gfx` 索引在后台建，建好再把图标补上

## 跨树关联

HOI4 的国策不都是一棵树内部的。常见的两种：

- **共享国策**：刚果的国策被比利时用 `shared_focus =` 借用，同时出现在两棵树里
- **阵营国策**：波罗的海三国共用一个国策，它和各国专属国策互斥——谁先点，别人就点不了

这些引用跨了文件，只看一棵树是看不出来的。所以：

| 看到什么 | 含义 |
|---|---|
| 节点右上角紫色圆点 | 这个国策有跨树关联 |
| 详情里紫色标签（带树名） | 指向别的树，点一下切过去并居中 |
| 详情里红色划掉的标签 | 静态读取时找不到定义 |

搜索框还会额外列出其他树里的匹配项，点一下直接跳。

原版 1.19.3 实测：**6 个国策**有跨树关联（波罗的海三国、刚果 ↔ 比利时、荷属东印度），另有 **6 个 id** 静态找不到（`CONGO_*` 四个、`INSHOL_*` 两个）。后者大概率是 `dynamic = yes` 的共享国策，游戏运行时才按国家生成，静态分析看不见——这是限制，不是 bug。

## 条件与效果解读

国策的 `available` 常常长这样，对不熟脚本的人等于天书：

```hoi4
available = {
	NOT = { has_government = fascism }
	date > 1940.1.1
	has_global_flag = mc_started
}
```

详情面板会把它翻成人话，并标出引用去了哪儿：

```
· 不满足：
  · 政体是 fascism
· 日期晚于 1940 年 1 月 1 日
· 全局标记「mc_started」已设置   ← mc.bootstrap (events/mc.txt)
```

最后那行是关键：**「这个标记什么时候被设的」在原文里完全看不出来**。工具会去 `events/` 里扫 `set_global_flag` / `set_country_flag` / `set_variable`，把设置它的那个事件 id 和文件找出来。

`completion_reward`（完成效果）同样会翻。比如 `POL_demand_yugoslav_subjugation` 这段：

```hoi4
if = { limit = { YUG = { is_subject = no exists = yes has_capitulated = no } }
       YUG = { country_event = NSB_poland_monarchist_events.6 } }
else = { every_state = { limit = { is_core_of = YUG } add_claim_by = ROOT } }
```

翻出来是：

```
· 如果：
  · 条件是：从 YUG 的角度看 → 不满足:是附庸国 / 存在 / 不满足:已投降
  · 那么：对 YUG 执行 → 触发事件 NSB_poland_monarchist_events.6
· 否则：
  · 对每个州：
    · 条件是：是 YUG 的核心领土
    · 我方 获得宣称
```

几个设计上的取舍：

- 词典只覆盖最常见的条件与效果，**遇到不认识的键原样输出**，绝不猜——看不懂比看错强
- `is_ai = no` 这类会翻成「不满足：由 AI 控制」，不会翻反
- `ROOT` / `FROM` / `PREV` 翻成「我方 / 对方 / 上一个对象」
- `tooltip` / `custom_effect_tooltip` 是纯显示用的，跳过不显示
- 标记索引是后台扫描，建好之前不显示来源，也不影响主流程

## 坐标系怎么处理

渲染时有两套坐标，混用会让连线和节点整体错位：

| 变量 | 含义 | 用途 |
|---|---|---|
| `_px` / `_py` | 网格坐标，可能是负数 | 只用来算包围盒 |
| `_sx` / `_sy` | 加上画布偏移后的最终坐标 | 所有绘制统一用它 |

测试里有一条专门的回归用例，逐个检查连线起点是否落在节点的边框上。

## 为什么不做自动布局

大多数图形工具会用力导向之类的算法自动排版。这里故意不做，原因有两个：

1. 游戏里的布局就是 `x` / `y` 写的，照着画才和游戏里一致
2. 自动布局在几百个节点的树上既慢又难看

所以从脚本到图的映射是**确定的**：同一个文件，永远画出同一张图。

## 测试

```bash
node test/clausewitz.test.js

# 顺带用真实游戏文件跑一遍（81 个文件、1 万多个国策）
HOI4_PATH="C:/Program Files (x86)/Steam/steamapps/common/Hearts of Iron IV" \
  node test/clausewitz.test.js
```

没有依赖，不需要 `npm install`。

## 导出图片

```bash
node tools/export-svg.js <文件或目录> --list          # 看看有哪些树
node tools/export-svg.js <文件> --tree <树 id> --out out.svg

# 带真图标（会把 .dds 解出来嵌进 SVG，文件是自包含的）
node tools/export-svg.js <文件> --tree <树 id> --game "<游戏目录>" --out out.svg
```

`docs/preview.svg` 就是这么生成的：`generic.txt` 里的 `generic_focus`，56 个国策、44 个图标。

## 已知限制

- **图标只支持未压缩的 32 位 DDS**。原版 2954 个图标里 2951 个是这种格式；DXT 压缩和 DX10 会退回色块
- **图标要拖整个游戏目录才有**。只拖 mod 文件夹时 `gfx/` 里没有素材，显示的就是色块
- **大树非常宽**。`belgium_focus` 画出来有 20000px 宽——这是游戏原始布局的宽度，不是 bug
- **只读**。不能编辑、不能保存
- **共享国策只能静态还原一部分**。`shared_focus = X` 的导入已经支持，但原版还有 6 个 id（`CONGO_*` 4 个、`INSHOL_*` 2 个）静态找不到——它们是 `dynamic = yes` 的共享国策，游戏运行时才按国家生成。界面上会标成红色划掉，不会假装解析成功

## 路线图

- [x] 读 `.gfx` 拿到图标清单，把色块换成真图标
- [ ] 读 `localisation/*.yml`，把 id 换成游戏里的中文名
- [x] 树与树之间的 `shared_focus` 关联
- [ ] 生成 PNG / 缩略图，方便贴进 PR
- [ ] 做成 VS Code 扩展，在编辑器里直接看

## 相关项目

| 项目 | 关系 |
|---|---|
| [CWTools](https://github.com/cwtools/cwtools-vscode) | 语言服务器，做校验。本项目不重复它的工作 |
| [clausewitz-mcp](https://github.com/jacklenzotti/clausewitz-mcp) | 面向 AI 的符号索引和 mod 校验 |
| [FocusTreeAndEventManager](https://github.com/Minivera/FocusTreeAndEventManager) | 2018 年的桌面版，已归档 |
| [钢之工坊](https://scharnhorst.hagane.works/) | 托管的可视化编辑器，功能最全 |

## 许可证

MIT
