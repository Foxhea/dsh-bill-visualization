# 验证记录

日期：2026-09-09。插件：`dsh-bill-visualization@0.1.2`（重命名自 `dsh-token-ledger`，含官方 Flash 系列 2026-09-10 调价快照更新）。

## 单元与 HTTP 集成

`node --test tests/*.test.js`：**36 / 36 通过**，Windows Node 24 与目标 Ubuntu Node 22 均通过。

新增覆盖：官方价格快照、北京时间工作日峰谷边界、周末、峰谷费用计算、导入幂等与保留手动费率、旧模型不自动定价、费率元数据校验。

覆盖：四类 Token 的互斥计数、推理 Token 不重复累加、usage 缺失、失败尝试的最后快照、message 与 stream 去重、分叉继承前缀、普通恢复、路由变更、历史生效费率、免费与未定价区分、上海时区边界、隐私字段过滤、CSV 公式转义、费率校验、分页读取、revision 缓存、扫描并发合并、损坏会话与关闭句柄、会话删除、读取上限、列表失败、原子保存与重启、并发冲突、损坏配置保留、401/403、JSON/CSRF/请求体上限、日期校验、导出、静态资源与卸载 disposer。

## 浏览器

真实 Chrome + Playwright：**19 项检查通过**，无 JavaScript 控制台错误。桌面 1440px、窄屏 390px。

检查：空数据、刷新、未定价提示、读取问题折叠、大 Token 数格式、表单保存、即时重新估算、官方价导入与幂等、编辑保留峰谷规则、全部时间范围、CSV 下载、窄屏无页面横向溢出、侧栏设置上方入口、收起布局、重挂载无重复、iframe 仪表盘、关闭对话框、控制台错误检查。

`qa/overview-demo.png`、`qa/rates-demo.png`、`qa/mobile-demo.png` 为**合成用量和示例价格**，不代表用户数据或供应商现价。原始结果在 `qa/browser-results.json`。

## 真实 Harness 验证

在用户可访问的 Ubuntu 源码环境中，以全新临时 `DSH_HOME` 验证 npm tarball；没有修改正常 `web` profile、读取正常会话或调用模型。

- Harness：`0.1.3-alpha.2`
- Commit：`82a5fd61a7cf5c293cec4bdff68f455398d685e9`
- Node：`v22.23.1`
- 通过 CLI 的 `plugin --profile web add <tgz>` 安装，**只添加本插件一个包**。
- 真实 Cordis 加载、`webserver/index-inject` 注入成功。
- 由专用测试插件向真实 SessionPersistence 写入一条合成 usage：100 未缓存输入 + 50 缓存读取 + 10 缓存写入 + 20 输出。
- 本插件以只读 SessionHandle 读取并汇总为 **180 Token、1 次尝试、无读取错误**。
- 使用真实 Harness 登录 token 交换 cookie；未登录的统计请求收到 **401**。
- 保存合成测试费率后，费用与计算结果一致：**0.000415 CNY**；费率文件真实落盘。
- 仪表盘 HTML 和启动脚本在认证后均返回 **200**。
- 模型请求数：**0**。

原始结果在 `qa/harness-results.json`，启动 token 不写入报告。

真实 Harness 页面另通过 **6 项浏览器检查**：侧栏 DOM 挂载、入口位于设置上方的几何位置、认证 iframe、官方费率保存、iframe 内 Escape 关闭、真实侧栏收起与展开。没有页面 JavaScript 错误，结果在 `qa/harness-browser-results.json`。

`qa/sidebar-real-harness.png` 为实际宿主侧栏；`qa/official-prices-real-harness.png` 为实际宿主中的费率页。两者均使用隔离测试配置。首次运行提示通过正常按钮关闭，未输入 API 密钥。

## 验证范围

已验证目标发布版的实际加载、持久化、认证、保存、计算和侧栏交互。没有对用户真实账单作核对，也没有验证其他 Harness 版本、Electron 或静态 Web Worker 部署。首次正式安装后，可导入官方价格快照或填写实际费率；没有适用费率时仅显示 Token 和未定价状态。截图中的读取问题仅用于验证提示样式，不代表修复了用户的损坏会话。
