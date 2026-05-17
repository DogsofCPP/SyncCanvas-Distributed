# SyncCanvas-Distributed 任务分配与开发路线图

> 分布式实时协作画布 - 武汉大学分布式系统大作业
>
> **多画布原则**：支持创建多个画布，用户选择画布后进入，不同画布数据隔离
> **认证原则**：用户需先注册/登录才能使用，无需验证码

---

## 一、团队分工

> **⚠️ 边界约束**：
> - A/B 只写 `server/` 下的文件
> - C/D 只写 `public/` 下的文件
> - 任何人不得修改他人负责的文件
> - 所有接口通过 `docs/PROTOCOL.md` 约定

| 成员 | 角色 | 核心职责 |
|------|------|----------|
| **A** | 架构与持久化 | Redis 序列号、Kafka/MongoDB 持久化链路、快照生成、**用户数据模型、画布数据模型** |
| **B** | 网关与通信 | WebSocket 服务端、Redis Pub/Sub 广播、HTTP 接口、**认证接口、画布管理接口、WebSocket 画布隔离** |
| **C** | 前端渲染引擎 | Canvas 绘画渲染、历史重放、光标同步、UI 交互、**画布列表 UI** |
| **D** | 输入采集与测试 | 采集器节流、DP 压缩、压测脚本、监控 |

---

## 二、协议约定（全员确认，第 1 天必须敲定）

### 2.1 认证与画布

```json
// 注册
POST /api/v1/auth/register
{ "username": "alice", "password": "secret123" }

// 登录
POST /api/v1/auth/login
{ "username": "alice", "password": "secret123" }
// 返回: { "user_id": "...", "token": "..." }

// 创建画布 (需认证)
POST /api/v1/canvases
Authorization: Bearer <token>
{ "name": "我的画布" }
// 返回: { "canvas_id": "..." }

// 画布列表 (需认证)
GET /api/v1/canvases
Authorization: Bearer <token>
```

### 2.2 WebSocket 消息格式

```json
// 客户端 → 服务端（笔画）
{
  "action": "stroke",
  "canvas_id": "canvas-001",
  "stroke_id": "uuid-v4",
  "points": [
    {"x": 100, "y": 200, "t": 1700000000000}
  ],
  "color": "#FF5733",
  "width": 3
}

// 客户端 → 服务端（橡皮擦 = 画背景色线条）
{
  "action": "erase",
  "canvas_id": "canvas-001",
  "stroke_id": "uuid-v4",
  "points": [
    {"x": 100, "y": 200, "t": 1700000000000}
  ],
  "width": 20
}

// 服务端 → 所有客户端（广播，仅限同一 canvas_id）
{
  "sequence_id": 10001,
  "canvas_id": "canvas-001",
  "user_id": "user-abc123",
  "action": "stroke",
  "stroke_id": "uuid-v4",
  "points": [...],
  "color": "#FF5733",
  "width": 3,
  "timestamp": 1700000000000
}
```

### 2.3 HTTP 接口

| 方法 | 路径 | 描述 | 负责人 |
|------|------|------|--------|
| POST | `/api/v1/auth/register` | 用户注册 | B |
| POST | `/api/v1/auth/login` | 用户登录 | B |
| POST | `/api/v1/canvases` | 创建画布 | B |
| GET | `/api/v1/canvases` | 获取画布列表 | B |
| GET | `/api/v1/canvases/:canvas_id/operations?from=0&limit=1000` | 获取历史操作 | A |
| GET | `/api/v1/canvases/:canvas_id/snapshots/latest` | 获取最新快照 | A |
| GET | `/api/v1/canvases/:canvas_id/stats` | 获取在线人数等统计 | B |

### 2.4 状态定义

| 状态码 | 含义 |
|--------|------|
| 1001 | 序列号跳号，需要发起 sync_request |
| 1002 | 心跳 Ping |
| 1003 | 心跳 Pong |
| 2001 | 用户名已被注册 |
| 2002 | 用户名或密码错误 |

---

## 三、开发阶段

### 📅 第 1 天：基建与契约日

**目标**：环境跑起来，协议定死

| 成员 | 任务 | 产出物 |
|------|------|--------|
| A | 编写 `docker-compose.yml`，启动 Redis、Kafka、MongoDB | docker-compose.yml |
| A | 设计 MongoDB 集合结构（operations, snapshots, **users, canvases**） | SCHEMA.md |
| **A** | **设计 users 和 canvases 的 MongoDB Schema** | **models/schemas.js** |
| B | 搭建 WebSocket 服务端骨架（接收消息，打印日志） | server/index.js |
| **B** | **设计 HTTP 认证路由框架** | **server/routes/auth.js** |
| C | 创建 `index.html` + Canvas 骨架，绑定鼠标事件 | index.html |
| D | 编写 `collector.js`，50ms 定时采集点，发送到 console | collector.js |
| **全员** | **确认 WebSocket 协议 JSON 格式（含 canvas_id 隔离）** | PROTOCOL.md |

**验收标准**：无（纯准备日）

---

### 📅 第 2-4 天：黑盒并行开发

**原则**：各模块独立开发，通过协议对接

> **⚠️ 边界约束**：
> - A/B 只写 `server/` 下的文件
> - C/D 只写 `public/` 下的文件
> - 任何人不得修改他人负责的文件
> - 所有接口通过 `docs/PROTOCOL.md` 约定

#### 成员 A：数据持久化 + 数据模型

```
第 2 天：
- 编写独立的 kafka-producer.js（不修改 ws-server.js）
- 编写 kafka-consumer.js
- 实现最简单的逻辑：收到消息 → insertOne 到 MongoDB

第 3 天：
- 实现用户数据模型（users 集合）
  - 字段：user_id, username, password_hash, created_at
  - 索引：username（唯一）
- 实现画布数据模型（canvases 集合）
  - 字段：canvas_id, name, owner_id, created_at
  - 索引：canvas_id（唯一）, owner_id

第 4 天：
- 实现 GET /api/v1/canvases/:canvas_id/operations 接口
- 实现 GET /api/v1/canvases/:canvas_id/snapshots/latest 接口
- 编写 MongoDB 索引（sequence_id, timestamp, canvas_id）
- 实现快照机制：每 100 条操作或 30 秒，生成 SVG 快照
```

**产出物**：`server/kafka-producer.js`, `server/kafka-consumer.js`, `server/api.js`, `models/schemas.js`

#### 成员 B：消息网关 + HTTP 认证与画布接口

```
第 2 天：
- 完善 WebSocket 服务端（接收消息）
- 连接 Redis，测试 INCR 获取 sequence_id
- 引入 A 的 kafka-producer.js，收到消息后入队

第 3 天：
- 实现 HTTP 认证接口：
  - POST /api/v1/auth/register（用户注册）
  - POST /api/v1/auth/login（用户登录，返回 JWT token）
- 实现 JWT 验证中间件

第 4 天：
- 实现 HTTP 画布接口：
  - POST /api/v1/canvases（创建画布，需认证）
  - GET /api/v1/canvases（画布列表，需认证）
  - GET /api/v1/canvases/:canvas_id/stats（统计，需认证）
- WebSocket 连接时验证 canvas_id 存在性
- 实现 Redis Pub/Sub 订阅（按 canvas_id 频道隔离）
- 将消息广播给所有连接的 WebSocket 客户端（仅限同一画布）
```

**产出物**：`server/ws-server.js`, `server/redis-client.js`, `server/routes/auth.js`, `server/middleware/auth.js`

#### 成员 C：画布渲染 + 画布列表 UI

```
第 2 天：
- HTML5 Canvas 绑定鼠标事件（mousedown, mousemove, mouseup）
- 实现单一黑色画笔画线（moveTo, lineTo, stroke）

第 3 天：
- 连接 WebSocket 服务端（ws://localhost:3000/ws?canvas_id=xxx）
- 收到消息后在 Canvas 上画出来
- 处理平滑曲线（使用 quadraticCurveTo 或 bezierCurveTo）

第 4 天：
- 调用 collector.js 暴露的 UI 方法（setTool/setColor/setWidth）
- 展示颜色选择器、线条粗细调节 UI
- 实现撤销/重做功能（基于 sequence_id）
- **实现画布列表 UI**：
  - 登录成功后显示画布列表
  - 显示"创建新画布"按钮
  - 点击画布进入对应的 WebSocket 连接
```

**注意**：Canvas 的绘制逻辑由 C 负责，但工具切换必须通过 `collector.setTool('pen'|'eraser')`

**产出物**：`public/index.html`, `public/style.css`, `public/draw.js`, `public/canvas-list.js`（新增）

#### 成员 D：输入采集

```
第 2 天：
- 实现 50ms 定时器
- 鼠标移动时将点存入数组
- 暴露 collector.setTool() / setColor() / setWidth() 供 C 调用

第 3 天：
- 实现 50ms 定时器发包逻辑
- 检查是否有新点（currentPoints.length > 0）
- 有新点则立即通过 WebSocket 发送
- 同一笔 stroke 用同一个 stroke_id，分多次发送（segment）
- erase 逻辑：tool='eraser' 时发送 erase action
- **每个消息需携带 canvas_id**（从全局配置读取）

第 4 天：
- 添加节流优化（requestAnimationFrame）
- 准备 Douglas-Peucker 算法代码框架
```

**注意**：collector.js 是 D 的唯一产出物，所有采集逻辑（笔/橡皮擦切换）由 D 实现

**产出物**：`public/collector.js`

---

### 📅 第 5 天：初版大联调 (Milestone 1)

**目标**：两人打开网页，能互相看到画的黑色线条（在同一画布内）

#### 联调步骤

```
1. A 启动：docker-compose up
2. B 启动：node server/ws-server.js
3. A 启动：node server/kafka-consumer.js
4. C+D 打开浏览器访问 http://localhost:3000
5. 用户注册/登录 → 创建或选择画布
6. D 画一笔 → B 收到并广播（仅限同画布）→ C 看到
7. C 画一笔 → B 收到并广播（仅限同画布）→ D 看到
8. A 检查 MongoDB 里有数据
```

#### 验收标准

| 验收项 | 标准 |
|--------|------|
| 实时性 | 延迟 < 200ms（人眼可接受） |
| 持久化 | MongoDB operations 集合有记录 |
| 可见性 | 同一画布内的两台电脑互相能看到对方的线条 |
| 隔离性 | 不同画布的消息不会互相干扰 |

**如果通过**：初版达成！

---

### 📅 第 6-8 天：高阶特性开发

#### 成员 A：防数据库雪崩

```
第 6 天：
- 重构 Kafka Consumer，加入微批处理
- 暂存消息，满 500 条或 1 秒，执行 insertMany
- 性能对比：单条插入 vs 批量插入

第 7 天：
- 优化快照机制：Canvas → SVG 转换
- 实现快照压缩（GZIP）
- 快照存储到 MongoDB snapshots 集合

第 8 天：
- 实现增量快照（只存储差异，而非全量）
```

**验收项**：压测时 MongoDB 写入 QPS > 1000

#### 成员 B：防网关扇出雪崩

```
第 6 天：
- 重构 WebSocket 广播逻辑
- 10ms 批处理窗口：累积多个坐标包，合并成数组一次性发送

第 7 天：
- 实现跳号检测（sequence_id 不连续 → 通知客户端请求同步）
- 实现 sync_request / sync_response 机制
- **WebSocket 房间隔离测试**：验证不同 canvas_id 不会互相干扰

第 8 天：
- Nginx 反向代理配置
- WebSocket 负载均衡测试
```

**验收项**：200 人并发时网关 CPU < 70%

#### 成员 C：历史追平与 UI

```
第 6 天：
- 实现页面加载时的"重放（Replay）"逻辑
- 调用 GET /api/v1/canvases/:canvas_id/operations 拉取历史
- 按 sequence_id 顺序重放所有操作

第 7 天：
- 实现光标同步（显示其他用户的鼠标位置）
- 优化 Canvas 渲染性能（离屏 Canvas + requestAnimationFrame）

第 8 天：
- 美化 UI：工具栏、颜色面板
- 实现撤销/重做功能（基于 sequence_id）
- 画布列表增加"最后修改时间"等元信息展示
```

**验收项**：加载历史后重放流畅，无卡顿

#### 成员 D：流量压缩与压测

```
第 6 天：
- 纯手写 Douglas-Peucker 算法
- 过滤 50ms 内多余的坐标点
- 对比压缩前后的发包体积

第 7 天：
- 编写 Locust 压测脚本
- 模拟 200 人并发发包（需携带 token 和 canvas_id）

第 8 天：
- 搭建 Prometheus + Grafana 监控
- 追踪端到端延迟（P99 < 50ms）
```

**验收项**：DP 压缩后发包体积减少 > 70%

---

### 📅 第 9 天：分布式压测与抗压

**目标**：验证系统在极端负载下的表现

#### 压测场景

| 场景 | 并发人数 | 每秒消息数 | 目标 P99 |
|------|----------|------------|----------|
| 场景一：高频作画 | 200 | 2000 | < 50ms |
| 场景二：冷启动（加载历史） | 50 | 500 | < 200ms |
| 场景三：多画布隔离 | 100（跨 5 画布） | 1000 | < 50ms |

#### 职责分工

| 成员 | 监控项 |
|------|--------|
| D | 运行压测脚本，收集数据 |
| A | 监控 MongoDB 写入 QPS、CPU |
| B | 监控网关 CPU、连接数 |
| C | 真人测试：压测期间打开浏览器画图，验证延迟 |

#### 压测工具

```python
# locustfile.py 示例结构（需携带 token 和 canvas_id）
class WebSocketUser(HttpUser):
    @task
    def draw_stroke(self):
        # 发送 stroke 消息（包含 canvas_id）
        self.ws.send(json.dumps({...}))
```

---

### 📅 第 10 天：封装与文档 (Milestone 2)

**原则**：停止一切代码修改！

| 成员 | 任务 |
|------|------|
| A | 导出 docker-compose.yml、数据库 schema |
| B | 导出 Nginx 配置、API 文档 |
| C | 录制双端同步演示视频 |
| D | 导出压测图表（Grafana 截图） |
| **全员** | 撰写《软件工程》大作业报告 |

#### 文档清单

- [ ] README.md（项目简介、技术栈）
- [ ] PROTOCOL.md（协议详细说明）
- [ ] ARCHITECTURE.md（系统架构图）
- [ ] DEPLOYMENT.md（部署指南）
- [ ] TEST_REPORT.md（压测报告）
- [ ] 演示视频.mp4

---

## 四、技术栈清单

### 后端

| 技术 | 用途 | 负责人 |
|------|------|--------|
| Node.js | WebSocket 服务端 | B |
| Redis | Pub/Sub、序列号生成 | B |
| Kafka | 异步消息队列 | A |
| MongoDB | 持久化存储 | A |
| JWT | 用户认证 | B |
| Nginx | 反向代理、负载均衡 | B |

### 前端

| 技术 | 用途 | 负责人 |
|------|------|--------|
| HTML5 Canvas | 绘画引擎 | C |
| Vanilla JS | 无框架，保持简单 | C/D |
| WebSocket | 实时通信 | C |
| Locust | 压测 | D |

### 运维

| 技术 | 用途 | 负责人 |
|------|------|--------|
| Docker | 容器化 | A |
| Prometheus | 监控 | D |
| Grafana | 可视化 | D |

---

## 五、依赖关系图

```
                       ┌─────────────┐
                       │   Redis     │
                       │ (序列号/广播) │
                       └──────┬──────┘
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
       ▼                      ▼                      ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│  HTTP Auth    │    │  WebSocket    │    │    Kafka      │
│   (B)         │    │   Gateway     │    │  (消息队列)    │
│   + Canvas    │    │   (B)        │    │    (A)        │
│   Routes      │    │               │    │               │
└───────┬───────┘    └───────┬───────┘    └───────┬───────┘
        │                    │                    │
        ▼                    │                    ▼
┌───────────────┐            │            ┌───────────────┐
│    MongoDB    │            │            │Kafka Consumer │
│  (A: 用户/画布)│            │            │    (A)         │
└───────────────┘            │            └───────┬───────┘
                             │                    │
                             │                    ▼
                             │            ┌───────────────┐
                             │            │  MongoDB      │
                             │            │ (A: operations)│
                             │            └───────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────┐
│              浏览器客户端                      │
│  Canvas (C)  +  Collector (D)               │
│  + Auth UI (C) + Canvas List UI (C)         │
└─────────────────────────────────────────────┘
```

---

## 六、代码仓库结构

```
SyncCanvas-Distributed/
├── docker-compose.yml          # A: 基础设施
├── server/
│   ├── ws-server.js           # B: WebSocket 网关（按 canvas_id 隔离）
│   ├── redis-client.js         # B: Redis 操作
│   ├── kafka-producer.js       # A: 消息入队
│   ├── kafka-consumer.js       # A: 消息消费
│   ├── api.js                  # A: HTTP 操作/统计接口
│   ├── routes/
│   │   ├── auth.js            # B: 认证路由（注册/登录）
│   │   └── canvas.js          # B: 画布路由（创建/列表）
│   └── middleware/
│       └── auth.js            # B: JWT 认证中间件
├── models/
│   └── schemas.js             # A: MongoDB Schema（users + canvases + operations）
├── public/
│   ├── index.html             # C: 主页面 + UI 交互
│   ├── style.css             # C: 样式
│   ├── draw.js               # C: 绘画渲染
│   ├── canvas-list.js        # C: 画布列表 UI（新增）
│   ├── auth.js               # C: 前端登录/注册 UI（新增）
│   └── collector.js          # D: 输入采集
├── locust/
│   └── locustfile.py         # D: 压测脚本
├── monitoring/
│   └── prometheus.yml         # D: 监控配置
├── docs/
│   ├── PROTOCOL.md            # 协议文档（全员遵守）
│   ├── ARCHITECTURE.md        # 架构文档
│   └── DEPLOYMENT.md          # 部署文档
└── README.md
```

---

## 七、风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| WebSocket 连接不稳定 | 中 | 高 | 心跳 + 断线重连 |
| MongoDB 写入成为瓶颈 | 中 | 高 | 微批处理 + 索引优化 |
| 200 人并发时广播风暴 | 高 | 高 | 10ms 批处理窗口 |
| 序列号跳号导致画面错乱 | 低 | 高 | sync_request 同步机制 |
| 多人同时画同一区域 | 低 | 低 | 乐观更新，暂不处理冲突 |
| **画布不存在导致连接失败** | 低 | 中 | **WebSocket 连接时验证 canvas_id** |
| **JWT token 伪造/过期** | 低 | 高 | **服务段验证 token 有效性** |

---

## 八、会议与沟通

| 时间 | 内容 |
|------|------|
| 每天早 9:00 | 站会（15 分钟），每人汇报进度 |
| 第 5 天 | Milestone 1 验收 |
| 第 9 天 | 压测数据分析 |
| 第 10 天 | 项目复盘 |

---

**祝你们的分布式大作业顺利！**
