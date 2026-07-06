# 差距分析（Gap Analysis）

最后更新：2026-07-06

本文档基于对全仓库源码的逐包核查（非仅文档核对），对照 [AI_NATIVE_PRODUCTION_READY_FRAMEWORK_PLAN.md](./AI_NATIVE_PRODUCTION_READY_FRAMEWORK_PLAN.md) 第 1 节的核心目标——**AI 能持续生成、验证、发布、观测、优化生产代码**——给出当前实现与目标之间的差距清单和补齐顺序。

## 1. 总体结论

**骨架完整、闭环全断。**

- 契约层：计划中的 12 个 Zod schema 已 100% 定义。
- 本地质量门禁：`pnpm verify` 真实可用，预算超标为 fail 而非 warn。
- 运行时：slot 级 DAG 调度、SSR 数据去重、TTL 缓存、标签失效为真实现。

但在"生成 → 验证 → 发布 → 观测 → 优化"五个环节中，只有"生成"和"验证"的前半段能够跑通：**发布是手工的，trace 出不了进程，优化建议无法落地，运行时缺客户端层和弹性工程。** 按当前状态，一个 AI agent 独立完成"新增一个 fragment 并上线"会在 4~5 个环节卡死。

各环节完成度速览：

| 环节 | 完成度 | 一句话现状 |
| --- | --- | --- |
| 生成 | ~60% | 脚手架可无头调用，但注册/挂载全手工，无 agent 指令文件 |
| 验证 | ~65% | verify 完整，但覆盖率门禁未启用、e2e 零用例、无契约兼容性测试 |
| 发布 | ~20% | CI 只跑 verify；无镜像推送、无 affected、无 promote/canary/rollback 脚本 |
| 观测 | ~20% | trace 只活在单次 SSR 内存中；零 metrics、零 SLO、零告警 |
| 优化 | <25% | 优化器只吃静态 manifest；finding 无文件定位；无 codemod、无再验证回路 |

## 2. 按环节的差距明细

### 2.1 生成（AI 生成代码）— 约 60% 就位

已有：

- `tools/create-component` 非交互、输出结构化 JSON，可生成 fragment 全套 9 个文件（manifest、测试、预算、Dockerfile、fixtures）。
- 依赖审计会拦截业务代码中的裸 `fetch(...)`，强制走 `@mvp/request` / `@mvp/data`。

缺口：

- **无 agent 指令文件**：仓库没有 CLAUDE.md / AGENTS.md。`AI_COMPONENT_GUIDE.md`、`COMPONENT_CONTRACT.md`（仅 11 行）、`TDD_GUIDE.md` 是给人看的概述，不是 AI 可执行的操作手册（缺具体命令、验收判据、失败恢复步骤）。
- **生成后不自动注册**：`platform/fragment-registry/src/registry.ts` 与页面 `apps/page-*/src/manifest.ts` 的 slots 均需手工编辑；没有注册脚本，没有 `dependsOn` 依赖推断工具。
- **防重复机制偏弱**：`component-similarity-check` 是文本 token Jaccard 启发式（默认阈值 0.82，name 仅占 16% 权重），能挡"抄出来的重复"，挡不住"功能相同、实现不同"的重复，也不会给出复用建议。

### 2.2 验证 — 约 65% 就位，两个硬伤

已有：

- `scripts/verify.mts` 串联 typecheck / lint / format / test / build + 6 类审计，报告为 JSON + Markdown 双格式，落盘 `reports/`。
- 性能预算阈值明确（component/fragment/page/shell 四级），超标即 exit 1。

缺口：

- **90% 覆盖率门禁未启用**：`@vitest/coverage-v8` 已装、阈值已配，但 coverage 模式在本地环境卡死。这是文档自认的"发布前第一门禁"。
- **e2e 零用例**：`playwright.config.ts` 配好了 chromium + no-js 两个 profile 和 baseURL（shell 4100），但 `e2e/` 目录为空，verify 也不执行 e2e。
- **无契约兼容性测试**：registry 支持 stable/canary/preview 与多版本，但没有任何 fragment API breaking change 检测或 schema 演进测试。
- 审计报告对 AI 不够可操作：缺文件行号，各工具错误码字段不统一（`id` vs `code`），报告无版本化 schema。

### 2.3 发布 — 约 20% 就位（最大断层）

已有：

- 每个可部署单元有 Dockerfile；`infra/docker/docker-compose.yml` 可本地起全部 5 个服务并通过冒烟。
- `infra/k8s/`、`infra/argo-rollouts/`（10%→50%→100% 金丝雀）、`infra/verdaccio/` 有示例配置。
- `ReleaseManifestSchema` 已在 `@mvp/contracts` 定义。

缺口：

- **CI 只跑 verify**：`.github/workflows/ci.yml` 不构建、不推送镜像，无镜像 tag 策略；K8s manifests 硬编码 `:dev` 标签。
- **Nx 是摆设**：`nx.json` 存在但 CI 未用 `nx affected`，任何变更全量构建。"fragment 变更只发 fragment 镜像"的验收目标无从实现。
- **promote / canary / rollback 脚本完全不存在**：ReleaseManifest 定义了无人消费；registry 的 channel 是全有全无，没有金丝雀流量权重字段。
- Argo Rollouts 配置没有任何流程触发，也没有基于 metrics 的自动回滚判据。
- K8s 侧：shell-gateway 与 page-home 缺 readiness probe，无 resource limits / PDB / network policy。

### 2.4 观测 — 约 20% 就位

已有：

- `@mvp/observability` 的 trace 节点/边/时长/依赖图为真实现；home/product 演示页可展示单请求调度路径。

缺口：

- **trace 出不了进程**：只存活于单次 SSR 请求的内存对象中，容器里最多进 stdout。无 OTLP 导出、无文件持久化、无采样、无聚合后端。这直接饿死下游优化器。
- **零 metrics / SLO / 告警**：无 Prometheus 端点（shell 仅一个 `server-timing` header），无 SLO 定义，无告警规则。
- **运行时性能指标无采集**：TTFB/LCP/INP/CLS 阈值在 `PerformanceBudgetSchema` 中定义，但没有任何 Web Vitals / RUM 采集与之对照。
- 健康检查仅 `/health` 返回 ok，无深度检查（依赖服务、缓存状态）。

### 2.5 优化（AI 闭环）— 完成度 <25%

已有：

- `@mvp/optimizer` 4 条规则：重复网络请求、重复数据读取、静态数据候选（public + request-time）、静态 slot 候选（dynamic-ssr 且无依赖）。
- `tools/optimization-audit` 产出 `reports/optimization-findings.{json,md}`。

缺口（闭环断点）：

1. **输入断**：optimization-audit 实际只解析静态页面 manifest，未消费真实运行时 `RequestTraceSnapshot`——重复请求检测规则写了，但没有 trace 输入管道。
2. **定位断**：finding 的 `target` 只是 slot 名字，无文件路径/行号/manifest 精确定位。
3. **执行断**：建议是自然语言，无 codemod / AST 工具链 / 自动 patch 机制。
4. **验证断**：无"修改后重新采集 trace 对比"的反馈回路。

`reports/progress-report.md` 亦自述：optimizer 仍为 advisory，不会改写 manifest 或提优化补丁。

### 2.6 运行时本体的隐性欠账

计划中承诺、类型已定义、但实现缺失或仅为 stub 的部分：

| 项目 | 现状 | 判定 |
| --- | --- | --- |
| `data.dependsOn` 参与调度 | DAG 只认 `slot.dependsOn`；数据依赖零参与 | 仅契约 |
| `required?: boolean` 依赖 | 类型存在，调度器完全未使用 | 仅契约 |
| 瀑布流检测 hint | runtime 中 0 行代码 | 缺失 |
| 缓存可插拔 | `@mvp/data` 仅内存 Map；contracts 定义的 Redis/CDN/Cache API 适配器无任何实现；多实例无失效协调 | 仅契约 |
| `subscribeData` / realtime | stub（调用一次 handler 即返回空 unsubscribe）；无 WebSocket/SSE | 仅契约 |
| 客户端层 | 全仓库无 `use client` / hydrate / useState；无流式 SSR、无 client island、无水合 | 缺失 |
| 请求弹性 | `@mvp/request` 仅重试+超时；断路器/bulkhead/限流 0 行代码；AbortSignal 不对外暴露 | 部分实现 |
| `@mvp/storage` / `@mvp/workers` | 仅 schema 校验与 key 生成，无一行真实 I/O 或 worker 生命周期代码 | 仅契约 |
| `@mvp/interaction` | 包不存在；`InteractionContractSchema` 为死代码 | 缺失 |
| CSP / SRI | contracts 有字段；shell 仅 3 个基础安全头，无 CSP header、无 nonce，而页面正用 `dangerouslySetInnerHTML` 嵌 fragment HTML | 仅契约 |
| 页面级 SSG/ISR | 渲染策略停留在 slot/数据策略级，无页面级构建与 CDN 重验证 | 缺失 |
| PRR 生成器 | `docs/PRODUCTION_READINESS_REVIEW.md` 不存在，无生成器 | 缺失 |

注：客户端层缺失意味着"realtime 只更新订阅孤岛、不重渲染静态槽位"这一核心卖点目前无法演示。

## 3. AI agent 上线路径的具体卡点

假设 AI agent 今天要独立完成"新增业务 fragment 并上线"：

1. ✅ 脚手架生成代码（`create-component --type fragment`）
2. ✅ 本地测试与 `pnpm verify`
3. ❌ **卡点 1**：注册到 fragment-registry —— 需手工编辑 TS 文件，无脚本、无校验、无回滚
4. ❌ **卡点 2**：挂载到页面 manifest slots —— 需手工编辑，无依赖推断，无契约测试验证 fragment 与页面期望匹配
5. ❌ **卡点 3**：编排配置 —— docker-compose / K8s YAML 需手工添加，端口分配无约定
6. ❌ **卡点 4**：跨容器集成验证 —— 无 contract test，verify 不含 Docker 冒烟
7. ❌ **卡点 5**：发布与流量 —— 无镜像推送、无 canary、无回滚

## 4. 建议补齐顺序（按杠杆排序）

1. **git init + 初始提交**。当前全部文件 untracked，任何后续迭代都没有回滚基线。
2. **打通 AI 上线路径（最高杠杆）**：
   - 新增 `register-fragment` / `mount-slot` 脚本，消除两处手工编辑；
   - 新增 CLAUDE.md，把"生成 → 注册 → 挂载 → 验证"写成 AI 可执行清单。
3. **修复验证硬伤**：解决 coverage 卡死（尝试 `pool: 'forks'` 或换 istanbul provider）；补 3~5 条 shell/home/product 的 Playwright e2e 并纳入 verify。
4. **发布最小闭环**：CI 加 docker build + push（git sha 打 tag）→ `promote.mts` / `rollback.mts` 更新 registry → canary 冒烟脚本。先脚本化，不急于接 Argo。
5. **观测出进程**：trace 落盘 / OTLP 导出 + 每服务最小 metrics 端点，让优化器改吃真实 trace。
6. **补运行时语义**：`data.dependsOn` 进调度图、`required/optional` 生效、缓存适配器接口（先 memory + 文件，留 Redis 口子）。
7. **再做差异化卖点**：client island 水合、subscribeData 真实现、`@mvp/interaction`——依赖上面 1–6 的地基。

## 5. 一句话概括

这个框架的"合同"写得很好，"履约"集中在生成和本地验证两段。要达成 AI 原生目标，最缺的不是更多 schema，而是**把注册、发布、观测、优化四段从文档和类型变成可执行的脚本与管道**。

## 6. 修复进展（2026-07-06，两波并行修复后）

第 1–4 节是修复前的点位诊断，保留作为历史记录。以下是两波修复后的实际状态。全程 `pnpm verify` 11 项门禁全绿，并有 fragment 运行时冒烟佐证（`/metrics`、`/health` uptime、trace 落盘）。

### 已闭合

| 环节 | 修复内容 |
| --- | --- |
| 生成 | `CLAUDE.md` 生命周期操作手册；`register-fragment` / `mount-slot` / `promote-fragment` / `rollback-fragment` 脚本消除两处手工编辑；registry 与 page manifest slots 数据化 |
| 验证 | v8 coverage 卡死修复（`pool: "forks"`）；Playwright e2e 套件（shell/product/fragments/no-js 约 20 用例） |
| 发布 | git-diff affected 检测（传播规则）；CI docker 矩阵构建（secrets 门控推送）；K8s probe/limits + kustomize 镜像参数化；Argo 成功率/P95 分析模板；docker 冒烟 CLI |
| 观测 | Trace 文件/Console/OTLP 导出器 + 采样；Prometheus metrics 注册表；Web Vitals 入口；shell 与两个 fragment 挂 `/metrics` 并导出 trace |
| 优化 | 优化器消费真实 trace JSONL；新增瀑布流、缓存命中率规则；跨请求聚合升 severity；finding 带精确 location + trace 证据；audit 融合静态 manifest + trace |
| 运行时 | `executeFragmentSlots` 落地 required/optional 传播、`data.dependsOn` 进 DAG、瀑布流 hint |
| 数据/存储/Worker | 可插拔 `CacheAdapter`；轮询式 `subscribeData` + 可插拔 transport；真实 storage 适配器（cookie 签名/TTL/分区）；带重试/死信/优雅停止的后台 worker |
| 交互 | 新建 `@mvp/interaction`：类型化事件总线 + mutation 失效契约 + BroadcastChannel 桥 |
| Demo | shell/home/product/fragments 端到端展示上述能力（含真实 `use client` 实时岛、跨容器交互、签名 cookie、后台任务、调度 health/hints） |
| 审计 | 依赖 + 服务端/客户端边界审计新增对 Next.js RSC 孤岛模式的作用域放行（仅 page 应用），fastify fragment/shell 仍拦截；加回归测试 |

### 仍未闭合（后续工作）

- **90% 覆盖率门禁**：coverage 卡死已解，但全仓 90% 达标未逐包验证——阈值仍为 90%，实际覆盖率差距待补。
- **实时数据传输**：`subscribeData` 走轮询 + 内存 transport；生产级 WebSocket/SSE transport 仅留接口未实现。demo 实时岛用确定性生成器演示订阅链路，非真实推送源。
- **CI→集群闭环**：Argo 分析模板引用的 `/metrics` 已存在，但金丝雀自动评估需要在集群里跑 Prometheus；CI 应用 kustomize/rollout 镜像更新因无集群凭据未接线。
- **优化器执行/验证回路**：finding 已带精确定位，但"自动 codemod 改写 + 改后重采 trace 对比"仍是 advisory，未自动改代码。
- **存储加密**：cookie 签名已实现；`policy.encrypted` 的值加密未实现。
- **页面级 SSG/ISR**：渲染策略仍在 slot/数据策略级，页面级构建与 CDN 重验证未做。
- **PRR 生成器**：`docs/PRODUCTION_READINESS_REVIEW.md` 及其生成器仍缺。
