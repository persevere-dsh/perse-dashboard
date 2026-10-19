# 工作看板 — Persevere with DSH

`perse` = persevere。

基于 DSH 官方 Cordis 插件、UI slots、Typert Remote、Storage Domain 和 Session Controller 实现的原生工作看板。

支持工作区任务、分配、自动分析、原子认领、执行、独立复核及完成记录。新建任务可配置三种完成策略：人工验收、逐项文件验证、独立原生会话复核。低风险 express 任务在全部规则通过后可自动完成；staged、人工标记、失败或有疑点的任务保留人工验收。完成提示词和文件规则可在表单中配置，详见 [自动化规则](docs/automation.md)。

选定工作区后，可启动一次队列，或开启“持续分析与处理”，在本次议题预算（1–100）内自动处理后续看板议题。重启后需重新开启，不会自动重跑已认领任务。当前范围仅限看板内议题。

## 安装

验证目标为 DSH **0.2.1-rc.2**、Cordis **4.0.5**、Node **24**。

```sh
npm ci
npm run check
npm pack
dsh plugin --profile web add ./perse-dashboard-1.4.1.tgz
# 本机 Desktop 未将 dsh 加入 PATH 时：
scripts/dsh plugin --profile desktop add ./perse-dashboard-1.4.1.tgz
```

重启所选实例后，从原生侧栏打开“工作看板”。必须使用打包后的 tgz 安装，不使用目录链接。此仓库不会修改 DSH 应用文件。

本插件及其会话历史要求 DSH **0.2.1-rc.2**。若侧栏没有“工作看板”，或打开会话显示 `resume failed` / `历史加载失败`（`unknown event type "job/registered"`），说明实际启动的是旧的 **0.2.0-rc.2** 实例。请确认正在运行的 App 版本，改用 0.2.1 实例并重启。0.2.0 会跳过这个固定版本的插件，且无法读取 0.2.1 写入的会话日志；不要降级或改写这些日志。详见[兼容性说明](docs/compatibility.md#runtime-generation-and-session-logs)。

## 分配和自动认领

创建任务时写清结果和验收标准，可指定工作区中的一个会话，也可放入工作区队列。点击“准备 DSH 草稿”只准备未发送的原生输入；发送后 agent 可通过 `dashboard_claim_next` 领取任务，通过 `dashboard_report` 提交版本和证据。认领由 Host 串行、原子地决定，避免两个会话重复领取。

“启动队列”会通过官方 Session Controller 派发任务。暂停只阻止后续派发；停止当前 Agent 请使用原生会话控制。认领不自动过期，失败任务需查看真实会话后手动退回队列。人工模式需逐项勾选标准并明确确认；自动模式由 Host 检查风险、路由、证据、规则和复核身份后决定完成。完成后证据被冻结，需重新打开任务才能修改。

插件提供认领、报告、分析和复核工具，agent 无权修改完成策略或调用人工验收。Owner Remote 仍处于 DSH 的所有者信任边界内，插件无法证明点击按钮的是物理用户还是被授权的所有者自动化。

## Agent 开发与自验证

借鉴 Hermex 的 sim 资源管理方式，每次验证拥有独立 home、工作目录、端口、进程组和证据目录。不会将真实 DSH home 当作测试夹具。

```sh
npm ci
npx playwright install chromium
npm run sim -- --lane lab --scenario all --repeat 2
npm run sim -- --lane native
npm run sim -- --lane live
npm run sim -- --lane native --keep
```

`lab` 复用正式 BoardController、Dispatcher 和 CompletionCoordinator，提供完整任务、会话、工作区数据与 23 个可选场景；覆盖故障、断线、重放、恢复及自动化分支。它只模拟 DSH 执行与传输，不发送外部模型请求；`--scenario offline` 可聚焦单场景。对照依据和边界见 [Hermex 审计](docs/hermex-parity.md)。

`native` 运行真实 DSH Host、原生页面、Gateway、Agent loop、工具和存储，仅模型使用确定性适配器，不发送外部模型请求。`live` 临时复制凭据到隔离目录，以真实模型写入并读回测试文件，清理时删除凭据副本。设置 `PERSEVERE_DSH_CREDENTIALS` 可指定其他凭据文件。结果、截图和失败日志保存在 `.build/sim/<run-id>/`，以 `summary.json` 为入口。

`--keep` 用于保留测试实例供目视检查，Ctrl-C 仅清理本次创建的进程。没有 macOS Desktop 时，可通过 `PERSEVERE_DSH_COMMAND` JSON 参数数组指定 DSH 命令。设置 `PERSEVERE_DSH_BROWSER=msedge` 可复用 Edge。

目录、状态归属、契约和兼容依据见 [架构](docs/architecture.md)、[契约](docs/contracts.md)、[开发说明](docs/development.md)、[兼容性](docs/compatibility.md)。生产类型检查使用真实 DSH 声明，Remote 由官方 Typert generator 生成。CI 验证离线契约、完整浏览器 Lab 与打包面，真实原生与模型测试由 sim 验收。

一个安装对应一个 DSH Host。远程使用时在对应 Host 安装，通过已有的受信 Web/SSH 通道访问。本版不跨 Host 聚合、不代管 SSH 凭据、不增加定时调度，也不会自动合并或部署 agent 的改动。

指定会话的任务请打开该会话认领，或启动队列；准备新会话草稿的按钮会禁用，避免把任务交给无权认领的会话。

MIT.

Part of Persevere with DSH
