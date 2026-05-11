# SyncCanvas-Distributed

**分布式实时协作画布** - 武汉大学分布式系统大作业

## Summary

一个高性能的分布式实时协作画布平台，支持多人同时绘画、实时同步。采用"边画边出"策略，50ms 内将用户笔画同步给所有在线用户。基于 WebSocket + Redis Pub/Sub 进行实时广播，Kafka 作为异步消息队列，MongoDB 持久化存储操作日志。无需房间功能，所有用户共享同一个全局画布。

## Description

### 核心技术栈

| 层级 | 技术 | 用途 |
|------|------|------|
| 通信 | WebSocket + Redis Pub/Sub | 实时双向通信与广播 |
| 队列 | Kafka | 异步消息缓冲 |
| 存储 | MongoDB | 操作日志持久化、SVG 快照 |
| 前端 | HTML5 Canvas | 矢量绘画引擎 |
| 测试 | Locust + Prometheus | 压测与监控 |

### 核心特性

- **边画边出**：50ms 定时器触发发送，无需等待抬笔
- **全局画布**：所有用户共享同一画布，无房间隔离
- **历史重放**：支持从任意 sequence_id 恢复画布状态
- **冲突处理**：乐观更新 + sequence_id 序号同步
- **流量压缩**：Douglas-Peucker 算法点压缩

### 团队分工

| 成员 | 职责 |
|------|------|
| A | Redis 序列号、Kafka/MongoDB 持久化、快照生成 |
| B | WebSocket 网关、Redis Pub/Sub 广播、HTTP 接口 |
| C | Canvas 渲染、历史重放、光标同步、UI 交互 |
| D | 输入采集节流、DP 压缩、压测脚本、监控 |

### 快速启动

```bash
# 1. 启动基础设施
docker-compose up -d

# 2. 安装依赖
npm install ws express ioredis kafkajs mongoose

# 3. 启动 WebSocket 服务
node server/ws-server.js

# 4. 打开浏览器
# http://localhost:3000
```

### 项目结构

```
SyncCanvas-Distributed/
├── server/               # B: WebSocket 网关 + Redis 广播
│   ├── ws-server.js      # B: WebSocket 服务端
│   ├── redis-client.js   # B: Redis 操作
│   ├── kafka-producer.js  # A: 消息入队
│   ├── kafka-consumer.js  # A: 消息消费
│   └── api.js            # A: HTTP 接口
├── public/               # C: 前端渲染
│   ├── index.html        # C: 主页面
│   ├── draw.js           # C: Canvas 渲染引擎
│   └── collector.js      # D: 输入采集器（50ms 定时）
├── models/               # A: MongoDB Schema
├── docs/
│   └── PROTOCOL.md       # 通信协议文档
├── docker-compose.yml    # A: 基础设施
└── TASK_ASSIGNMENT.md    # 任务分配
```

### 通信协议

详见 [docs/PROTOCOL.md](docs/PROTOCOL.md)

- WebSocket 端点：`ws://localhost:3000/ws`
- 消息格式：`{ action: "stroke"|"erase", stroke_id, points[], color, width }`
- 全局序列号：Redis INCR 生成，保证顺序一致
