# Harness 兼容依据

目标发布标签：**`dsh-v0.2.1-rc.2`**（当前主目标）。

同时兼容：**`dsh-v0.1.5-rc.2`** 与 **`dsh-v0.1.3-alpha.2`**（接口相同，会话格式分别 v3 / v2）。

核对提交：`687f282e8625c6b8d11ff58211a90524be2e4317`（`dsh-v0.2.1-rc.2`）。

| 使用的接口 | 该发布版本源码 |
| --- | --- |
| `SessionPersistence.list()`、`open(id, 'read')`，快照包含 `header` 与 `revision` | [session-persistence/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-persistence/src/index.ts) |
| `SessionHandle.inheritedEventCount`、`read(offset, length, options).events`、`close()` | [session-persistence/src/handle.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-persistence/src/handle.ts) |
| 会话格式 **v2–v4**（`SESSION_FORMAT_VERSION = 4`；运行时把历史日志翻译到当前代次再交给读取方）、header/context、message/attempt | [core/session/src/types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/core/session/src/types.ts) |
| 物理日志文件名带格式代次（`session.v3.jsonl.zstd`） | [session-format/src/filename.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/session/session-format/src/filename.ts) |
| `TokenUsage.inputTokens` 为未缓存输入，缓存计数独立字段 | [llm/src/types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm/src/types.ts) |
| `stream` 的 `chunk` 类型 usage 快照 | [llm/src/assistant-stream.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/llm/llm/src/assistant-stream.ts) |
| `webServer.register` 和 `webserver/index-inject` | [host/webserver/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/host/webserver/src/index.ts) |
| `{kind:'script-src', placement:'body', src}` | [host/webserver/src/injections.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/host/webserver/src/injections.ts) |
| `connection.requestRejection(req)` | [client/connection/src/rpc-host.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/connection/src/rpc-host.ts) |

这是一个 Host 插件，使用注入的服务对象，ESM 运行时只导入 Node 内置模块与本包相对文件；不会给宿主额外安装其他版本的核心包。发布包携带完整 JavaScript 与网页资源，无需 TS 编译。

版本范围声明 `0.2.1-rc.2`、`0.1.5-rc.2` 与 `0.1.3-alpha.2`。其他版本应核对上述接口后再使用。

**会话格式代次（0.1.4 起修正，0.2.0 起向前兼容）**：Harness 0.1.5 把逻辑格式从 v2 升到 v3，0.2.1 又升到 v4（`SESSION_FORMAT_VERSION = 4`），物理日志名带代次（`session.v3.jsonl.zstd`、`session.v4.jsonl.zstd`），运行时先把历史日志翻译到当前代次再交给读取方，因此读取方看到的 `header.version` 恒为当前代次。本插件读取的 `request/header`、`request/context`、`assistant/message`、`assistant/attempt` 载荷在 v2–v4 之间没有变化；`createFold` 接受 **v2 及更新的任何整数代次**（v2/v3/v4 已验证，更新代次按尽力读取），只拒绝结构更旧的日志。0.1.3 及更早只接受 v2，遇到 v3/v4 会把每个会话判为读取失败（表现为用量全 0 + 大量「读取问题」）。

侧栏入口依赖 `[data-slot="sidebar.settings"]` DOM 标记及其 Settings 区域、footer 父级结构，见 [SidebarRoot.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/client/ui-sidebar/src/client/SidebarRoot.tsx)。入口插入 Settings 区域之前；观察 footer 宽度适配收起状态，并在宿主重挂载后重新附着。独立 Shadow DOM 对话框挂在 body，避免被侧栏裁切。此方式没有导入 Harness 浏览器运行时，但 DOM 结构仍是版本兼容约束；找不到该标记时可使用独立 `/dsh-bill-visualization` 页面。
