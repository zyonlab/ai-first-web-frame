# docs/reports — 手写长文报告

两份关于这个仓库本身的 HTML 长报告，以及它们的索引页。

| 文件 | 内容 |
| --- | --- |
| `index.html` | 索引页 |
| `architecture-map.html` | **架构地图** — 定位、请求拓扑、三层模块划分、四条生命周期（请求 / 片段交付 / island / 变更交付）、六条核心价值、边界与现状 |
| `competitive-analysis.html` | **竞品对位分析** — 8 条能力轴逐项对位 Podium / OpenComponents / Module Federation 2.0 / Nx / Astro Server Islands / Tailor；可借鉴清单（按 ROI 排序，带估时）；自研 vs 采用的成本账 |
| `cost-assessment.html` | **成本与风险评估** — 架构、设计模式、组件分级、SEO、人力与 AI 接手成本、线上运维成本的逐项评分；17 条发现各带代码证据、修复状态与证明；14 道门禁的真实拦截力 |

## 看

```
pnpm reports                 # 起本地服务，打印地址（默认 http://localhost:4300）
pnpm reports --port 4310     # 换端口
pnpm reports --open          # 顺便用默认浏览器打开
```

也可以直接双击文件：每份开头都有 `<meta charset="utf-8">` 和 viewport meta，所以 `file://` 下
中文不乱码、手机宽度也正常。

服务端是 `scripts/serve-reports.mts`，零依赖（`node:http` + `node:fs`），只读、只服务这一个目录、
只接受 GET/HEAD。它是阅读辅助，**不是基础设施**——`pnpm verify` 的任何一道门禁都不依赖它。
其路径解析的安全属性（返回值必然在目录内）由 `e2e/unit/serve-reports.test.ts` 覆盖。

## biome 例外

`biome.json` 的 `files.includes` 里排除了 `docs/reports/*.html`。Biome 2.5 会 lint HTML 内嵌
CSS，会对这两份页面的 `<style>` 报 `noDescendingSpecificity` 之类的选择器顺序建议——它们是
**发布用的文档页**，不该被源码样式规则治理。同一份 `includes` 里已有 `!reports/*.json` 的先例
（机器产物同理）。

## 为什么在 `docs/` 下而不是根 `reports/`

- 根 `reports/` 是**机器生成**的审计产物（`verify-report.json`、`bundle-report.md`、
  `css-report.md` …），每次 `pnpm verify` 都会重写。手写长文不该混进去。
- `docs/` 在 affected 引擎的 `IGNORED` 正则里（`tools/release-tools/src/affected-graph.ts`），
  所以**改报告永远不会触发任何单元重建**。

## 更新

这些文件同时是 claude.ai Artifact 的页面源码：文件体本身就是可发布的内容，顶部两行 meta
在 Artifact 环境里是无害的重复（那边的 harness 自带 head）。所以同一份文件既能本地打开，
也能原样发布，不需要两份副本。

当前线上副本：

- 架构地图 — <https://claude.ai/artifact/1NRLSYminvE8rFW5pPnwNs>
- 成本与风险评估 — <https://claude.ai/artifact/7hgEM55wep2T6cpjTDd7Lw>

> 报告内容有时效性。两份都标注了基线：初版为 `main @ 420f043`（2026-09-19），
> 当前内容已更新到分支 `fix/framework-hardening` 的加固结果。改动代码后若结论过期，
> 直接编辑这里的 HTML 即可——它们没有构建步骤。
