# SyncCanvas 通信协议

> **版本**: v1.0
> **日期**: 2026-05-11
> **状态**: 已确认，全员必须遵守

---

## 一、设计原则

1. **实时优先**：采用 WebSocket 双向通信
2. **边画边出**：50ms 定时器触发发送，无需等待抬笔
3. **全局画布**：所有用户共享同一画布，无房间隔离
4. **乐观更新**：本地先画，服务端确认后保持

---

## 二、WebSocket 消息

### 2.1 端点

```
ws://localhost:3000/ws
```

### 2.2 客户端 → 服务端

#### 笔画消息 (stroke)

```json
{
  "action": "stroke",
  "stroke_id": "550e8400-e29b-41d4-a716-446655440000",
  "points": [
    { "x": 100, "y": 200, "t": 1700000000000 },
    { "x": 105, "y": 210, "t": 1700000000050 }
  ],
  "color": "#FF5733",
  "width": 3
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 固定值 `"stroke"` |
| `stroke_id` | string | ✅ | UUID v4，同一次完整笔画共享 |
| `points` | array | ✅ | 坐标点数组（50ms 累积） |
| `points[].x` | number | ✅ | X 坐标（像素） |
| `points[].y` | number | ✅ | Y 坐标（像素） |
| `points[].t` | number | ✅ | 时间戳（毫秒 Unix Epoch） |
| `color` | string | ✅ | HEX 颜色，如 `#FF5733` |
| `width` | number | ✅ | 线条宽度（像素） |

#### 橡皮擦消息 (erase)

```json
{
  "action": "erase",
  "stroke_id": "550e8400-e29b-41d4-a716-446655440001",
  "points": [
    { "x": 300, "y": 400, "t": 1700000000100 }
  ],
  "width": 20
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 固定值 `"erase"` |
| `stroke_id` | string | ✅ | UUID v4 |
| `points` | array | ✅ | 坐标点数组 |
| `width` | number | ✅ | 橡皮擦宽度（通常为画笔的 3 倍） |
| `color` | ❌ | 无需填写 | 橡皮擦使用背景色 |

#### 光标同步 (cursor)

```json
{
  "action": "cursor",
  "x": 500,
  "y": 300
}
```

### 2.3 服务端 → 客户端

#### 广播消息

```json
{
  "type": "broadcast",
  "sequence_id": 10001,
  "user_id": "user-abc123",
  "action": "stroke",
  "stroke_id": "550e8400-e29b-41d4-a716-446655440000",
  "points": [
    { "x": 100, "y": 200, "t": 1700000000000 }
  ],
  "color": "#FF5733",
  "width": 3,
  "timestamp": 1700000000050
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `type` | string | ✅ | 固定值 `"broadcast"` |
| `sequence_id` | number | ✅ | 全局单调递增序号 |
| `user_id` | string | ✅ | 发送者用户 ID |
| 其他字段 | - | - | 与客户端消息相同 |

#### 欢迎消息 (welcome)

```json
{
  "type": "welcome",
  "user_id": "user-abc123",
  "message": "连接成功！"
}
```

#### 错误消息 (error)

```json
{
  "type": "error",
  "code": 1001,
  "message": "序列号跳号，请重新同步"
}
```

| 错误码 | 含义 |
|--------|------|
| 1001 | 序列号跳号，需要发起 sync_request |
| 1002 | 消息格式错误 |
| 1003 | 未知 action |

#### 心跳消息

```json
// Ping (服务端 → 客户端)
{ "type": "ping" }

// Pong (客户端 → 服务端)
{ "type": "pong" }
```

#### 同步请求 (sync_request)

```json
// 客户端 → 服务端
{ "type": "sync_request", "from_sequence_id": 1000 }

// 服务端 → 客户端
{
  "type": "sync_response",
  "operations": [
    { "sequence_id": 1001, "action": "stroke", ... },
    { "sequence_id": 1002, "action": "stroke", ... }
  ],
  "latest_sequence_id": 1050
}
```

---

## 三、HTTP 接口

### 3.1 获取历史操作

```
GET /api/v1/operations?from=0&limit=1000
```

**响应**:

```json
{
  "success": true,
  "data": [
    {
      "sequence_id": 10001,
      "user_id": "user-abc123",
      "action": "stroke",
      "stroke_id": "...",
      "points": [...],
      "color": "#FF5733",
      "width": 3,
      "timestamp": 1700000000000
    }
  ],
  "pagination": {
    "from": 0,
    "limit": 1000,
    "total": 5000
  }
}
```

### 3.2 获取最新快照

```
GET /api/v1/snapshots/latest
```

**响应**:

```json
{
  "success": true,
  "data": {
    "sequence_id": 10500,
    "svg_data": "<svg>...</svg>",
    "created_at": "2026-05-11T10:00:00Z"
  }
}
```

### 3.3 获取统计信息

```
GET /api/v1/stats
```

**响应**:

```json
{
  "success": true,
  "data": {
    "online_users": 42,
    "latest_sequence_id": 10500,
    "total_operations": 5000
  }
}
```

---

## 四、协议流程

### 4.1 连接流程

```
客户端                      服务端
  |                           |
  |------ TCP 连接 ---------->|
  |                           |
  |<----- WebSocket 握手 ------|
  |                           |
  |<----- welcome ------------|
  |     (包含 user_id)        |
  |                           |
```

### 4.2 发送笔画流程

```
用户画一条线：
  1. mousedown → 生成 stroke_id
  2. mousemove → 记录点
  3. 50ms 后 → flush() → 发送 segment
  4. mousemove → 记录点
  5. 50ms 后 → flush() → 发送 segment
  ...
  n. mouseup → 发送最后 segment
```

### 4.3 广播流程

```
客户端 A                服务端                  客户端 B
    |                     |                        |
    |---- stroke msg ---->|                        |
    |                     |---- broadcast -------->|
    |                     |    (含 sequence_id)    |
    |                     |                        |
    |<--- 确认 OK --------|                        |
    |                     |                        |
```

### 4.4 同步流程

```
客户端                      服务端
  |                           |
  | 发现 sequence_id 跳号      |
  |                           |
  |-- sync_request (from) --->|
  |                           |
  |<-- sync_response (ops) ---|
  |                           |
  | 重放所有 missed ops        |
  |                           |
```

---

## 五、数据校验

### 5.1 客户端校验

| 字段 | 校验规则 |
|------|----------|
| `action` | 必须是 `"stroke"`, `"erase"`, `"cursor"`, `"pong"` 之一 |
| `stroke_id` | 必须是有效的 UUID v4 |
| `points` | 数组长度 1-1000 |
| `points[].x` | 必须是数字，范围 0-65535 |
| `points[].y` | 必须是数字，范围 0-65535 |
| `points[].t` | 必须是正整数 |
| `color` | 必须是 `#` 开头，后跟 6 位 HEX |
| `width` | 必须是正整数，范围 1-100 |

### 5.2 服务端校验

| 字段 | 校验规则 |
|------|----------|
| `sequence_id` | 必须是上一个 +1 |
| `user_id` | 必须是已连接的用户 |
| `timestamp` | 必须在当前时间 ±10 秒内 |

---

## 六、版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| v1.0 | 2026-05-11 | 初始版本 |

---

## 七、负责人

| 模块 | 负责人 |
|------|--------|
| WebSocket 服务端 | B |
| 前端采集器 | D |
| HTTP 接口 | A |
