# Harness 兼容依据

目标发布标签：`dsh-v0.1.3-alpha.2`。

源码提交：`82a5fd61a7cf5c293cec4bdff68f455398d685e9`。

| 使用的接口 | 该发布版本源码 |
| --- | --- |
| `SessionPersistence.list()`、`open(id, 'read')`，快照包含 `header` 与 `revision` | [session-persistence/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence/src/index.ts) |
| `SessionHandle.inheritedEventCount`、`read(offset, length, options).events`、`close()` | [session-persistence/src/handle.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/session/session-persistence/src/handle.ts) |
| 格式版本 2、header/context、message/attempt | [core/session/src/types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/core/session/src/types.ts) |
| inputTokens 与缓存计数互不包含 | [llm/src/types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/llm/llm/src/types.ts) |
| `stream` 的 `chunk` 类型 usage 快照 | [llm/src/assistant-stream.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/llm/llm/src/assistant-stream.ts) |
| `webServer.register` 和 `webserver/index-inject` | [host/webserver/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/host/webserver/src/index.ts) |
| `{kind:'script-src', placement:'body', src}` | [host/webserver/src/injections.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/host/webserver/src/injections.ts) |
| `connection.requestRejection(req)` | [client/connection/src/rpc-host.ts](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/client/connection/src/rpc-host.ts) |

这是一个 Host 插件，使用注入的服务对象，ESM 运行时只导入 Node 内置模块与本包相对文件；不会给宿主额外安装其他版本的核心包。发布包携带完整 JavaScript 与网页资源，无需 TS 编译。

版本范围刻意只声明 `0.1.3-alpha.2`。其他版本应核对上述接口后再使用。

0.1.3 的侧栏入口依赖该版本的 `[data-slot="sidebar.settings"]` DOM 标记及其 Settings 区域、footer 父级结构，见 [SidebarRoot.tsx](https://github.com/deepseek-ai/deepseek-harness/blob/82a5fd61a7cf5c293cec4bdff68f455398d685e9/packages/client/ui-sidebar/src/client/SidebarRoot.tsx)。入口插入 Settings 区域之前；观察 footer 宽度适配收起状态，并在宿主重挂载后重新附着。独立 Shadow DOM 对话框挂在 body，避免被侧栏裁切。此方式没有导入 Harness 浏览器运行时，但 DOM 结构仍是版本兼容约束；找不到该标记时可使用独立 `/dsh-bill-visualization` 页面。
