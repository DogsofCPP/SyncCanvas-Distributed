# SyncCanvas 压测工具集

> 分布式实时协作画布 - 武汉大学分布式系统大作业

## 目录结构

```
locust/
├── README.md                  # 本文件
├── locustfile.py             # Locust WebSocket 并发压测（场景一/二）
├── compare_dp.js             # Douglas-Peucker 压缩率基准测试
├── test-runner.js            # 端到端延迟压测（P50/P95/P99）
├── dp_epsilon_comparison.csv # DP Epsilon 对比数据（自动生成）
└── dp_stroke_type_comparison.csv  # DP 笔画类型对比数据（自动生成）
```

---

## 一、环境准备

```bash
# 1. 启动基础设施
docker-compose up -d

# 2. 启动 WebSocket 网关
node server/index.js

# 3. 启动 Kafka 消费者（Java persistence-service）
cd persistence-service
mvn package -DskipTests -q
java -jar target/persistence-service-0.0.1-SNAPSHOT.jar

# 4. 安装压测依赖
npm install              # 已包含 ws
pip install locust       # Windows: python -m pip install locust
```

---

## 二、快速开始

### 场景一：Douglas-Peucker 压缩率对比

```bash
node locust/compare_dp.js
```

**输出示例：**

| Epsilon | 原点数 | 压缩后 | 点压缩率 | 字节压缩率 |
|---------|--------|--------|----------|------------|
| 0.5     | 500    | 492    | 1.6%     | 1.6%       |
| 1.0     | 500    | 485    | 3.0%     | 3.0%       |
| 2.0     | 500    | 472    | 5.6%     | 5.6%       |
| 5.0     | 500    | 424    | 15.2%    | 15.2%      |
| 10.0    | 500    | 347    | 30.6%    | 30.6%      |
| 20.0    | 500    | 252    | 49.6%    | 49.6%      |

**结论：**
- epsilon=1.0 适合精细绘画（笔刷 3px）
- epsilon=5.0 适合粗略草图
- 直线类笔画压缩效果最好（90%+），随机抖动最差（<30%）
- 建议默认值：**epsilon=2.0**

### 场景二：端到端延迟压测

```bash
node locust/test-runner.js
```

**环境变量：**
```bash
CONCURRENCY=200          # 并发用户数（默认 200）
STROKES_PER_USER=50      # 每用户发送消息数（默认 50）
POINTS_PER_STROKE=5      # 每条消息点数（默认 5）
WS_URL=ws://localhost:3000/ws
```

**实测结果（2026-05-17）：**

```
======================================================================
  场景 1: 单连接延迟基准（50 条消息）
======================================================================
  P50: 4.53ms
  P95: 6.23ms
  P99: 29.42ms
  平均: 5.25ms
  范围: 3.61ms ~ 29.42ms

======================================================================
  场景 2: 200 用户并发（10000 条消息）
======================================================================
  送达率:  100.0%   ✓ (目标 ≥95%)
  P50:     7.24ms   ✓
  P95:     39.40ms  ✓ (目标 ≤200ms)
  P99:     187.40ms ✓ (目标 ≤500ms)
  吞吐量:  192.2 msg/s

======================================================================
  场景 3: 基础设施健康检查
======================================================================
  WebSocket 网关:     13.33ms  [200]
  Persistence 服务:   82.22ms  [200]
  Kafka UI:           363.71ms [200]
  Operations API:     188.32ms [200], count=1 历史操作
  WebSocket RTT:      0.57ms
```

### 场景三：Locust WebSocket 并发压测

```bash
# 场景一：高频作画（200 用户，每用户持续作画）
locust -f locust/locustfile.py --headless -u 200 -r 20 --run-time 60s --host=http://localhost:3000

# 场景二：冷启动（50 用户同时拉取历史）
locust -f locust/locustfile.py --headless -u 50 -r 10 --run-time 30s --host=http://localhost:3000 --mode=history

# Web UI 模式（浏览器访问 http://localhost:8089）
locust -f locust/locustfile.py --host=http://localhost:3000
```

---

## 三、压测报告模板

### 场景一：高频作画（200 并发）

| 指标 | 实测 | 目标 | 达标 |
|------|------|------|------|
| 送达率 | 100% | ≥95% | ✓ |
| P95 延迟 | 39.40ms | ≤200ms | ✓ |
| P99 延迟 | 187.40ms | ≤500ms | ✓ |
| 吞吐量 | 192 msg/s | — | — |

### 场景二：冷启动（加载历史）

| 指标 | 实测 | 目标 | 达标 |
|------|------|------|------|
| 历史拉取延迟 | 188.32ms | ≤200ms | ✓ |
| 历史操作数 | 1 条 | — | — |

### DP 压缩率

| epsilon | 压缩率 | 适用场景 |
|---------|--------|----------|
| 1.0 | ~3% | 精细绘画 |
| 2.0 | ~6% | 平衡（默认） |
| 5.0 | ~15% | 草图 |
| 20.0 | ~50% | 低保真度压缩 |

---

## 四、已知问题与修复

### Redis Pub/Sub 订阅竞态条件

**问题**：`server/index.js` 中 `await subscribe(...)` 未正确等待，导致 `messageHandler` 在 Redis 消息到达时仍为 null，广播功能失效。

**修复**：`server/redis-client.js` 的 `subscribe()` 增加了等待 subscriber `ready` 事件的逻辑：

```javascript
// redis-client.js
await new Promise((resolve) => {
  if (redisSubscriber.status === 'ready') {
    resolve();
  } else {
    redisSubscriber.once('ready', resolve);
  }
});
```
