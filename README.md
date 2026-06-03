# SyncCanvas-Distributed

一个面向分布式系统课程设计的实时协作画布项目。支持多人同时在线绘制、实时同步、历史回放与画布数据持久化，适合演示分布式消息广播、状态一致性和协同编辑等核心能力。

## 项目概览

- **实时协作**：基于 WebSocket 实现低延迟双向通信
- **边画边出**：通过 50ms 级别的增量发送机制，尽量缩短笔迹同步延迟
- **全局或多画布协作**：支持按画布隔离协作空间，便于多人同时使用
- **状态同步**：依赖全局序列号与同步接口，保证断线重连和补包恢复
- **持久化存储**：可将操作日志、画布快照等数据写入数据库，便于回放和恢复
- **流量优化**：对采样点做压缩，降低网络与存储开销

## 技术栈

| 模块 | 技术 | 作用 |
| --- | --- | --- |
| 实时通信 | WebSocket | 客户端与服务端双向通信 |
| 广播与缓存 | Redis Pub/Sub | 协同消息广播与序列控制 |
| 异步处理 | Kafka | 消息缓冲与解耦 |
| 数据存储 | MongoDB | 操作日志与画布数据持久化 |
| 前端绘制 | HTML5 Canvas | 矢量绘图与交互渲染 |
| 测试监控 | Locust / Prometheus | 压测与指标观测 |

## 核心功能

- 画笔绘制与橡皮擦操作
- 光标位置同步
- 画布历史回放
- 断线重连与增量同步
- 点序列压缩与数据裁剪
- 压测与可观测性支持

## 目录结构

```text
SyncCanvas-Distributed/
├── server/            # 服务端逻辑：WebSocket、HTTP、消息队列、Redis
├── public/            # 前端页面与 Canvas 交互逻辑
├── models/             # 数据模型定义
├── docs/               # 协议、接口等说明文档
├── locust/             # 压测脚本与结果
├── docker-compose.yml # 基础设施编排
└── README.md           # 项目说明
```

## 快速开始

### 1. 启动基础设施

```bash
docker-compose up -d
```

### 2. 安装依赖

根据实际运行环境安装项目依赖，例如：

```bash
npm install
```

如果项目分服务运行，也可以按各自目录分别安装所需依赖。

### 3. 启动服务

```bash
node server/ws-server.js
```

如果项目还包含 HTTP 接口或前端静态服务，请按项目中的实际入口分别启动。

### 4. 打开页面

在浏览器中访问项目提供的前端入口地址，开始协同绘画。

## 通信协议

详细协议请参见 `docs/PROTOCOL.md`。

常见端点示例：

- WebSocket：`ws://localhost:3000/ws?canvas_id=<canvas_id>`
- 认证接口：`POST /api/v1/auth/register`
- 认证接口：`POST /api/v1/auth/login`
- 画布接口：`POST /api/v1/canvases`
- 画布接口：`GET /api/v1/canvases`

## 使用说明

1. 先完成注册或登录。
2. 创建或选择一个画布。
3. 进入画布后即可开始绘制。
4. 断线后可通过同步接口恢复缺失操作。

## 相关文档

- `docs/PROTOCOL.md`：通信协议说明
- `locust/README.md`：压测说明
- `locust/LOADTEST.md`：压测方案
- `locust/FORMAL_PRESSURE_TEST_RESULTS.md`：正式压测结果
- `SCHEMA.md`：数据结构说明

## 说明

仓库中原先用于课程分工的文档已移除，README 仅保留项目本身的使用与技术说明，便于后续维护与展示。
