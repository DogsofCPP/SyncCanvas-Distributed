# SyncCanvas 通信协议

> **版本**: v2.0
> **日期**: 2026-05-17
> **状态**: 已确认，全员必须遵守

---

## 一、设计原则

1. **实时优先**：采用 WebSocket 双向通信
2. **边画边出**：50ms 定时器触发发送，无需等待抬笔
3. **多画布隔离**：支持创建多个画布，用户选择画布后进入，不同画布数据隔离
4. **乐观更新**：本地先画，服务端确认后保持
5. **认证先行**：WebSocket 连接前需先完成登录/注册

---

## 二、WebSocket 消息

### 2.1 端点

```
ws://localhost:3000/ws?canvas_id=<canvas_id>
```

> 连接时通过 URL 参数传入 `canvas_id`，服务据此隔离广播范围。

### 2.2 客户端 → 服务端

#### 笔画消息 (stroke)

```json
{
  "action": "stroke",
  "canvas_id": "canvas-001",
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
| `canvas_id` | string | ✅ | 画布 ID，连接时必须一致 |
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
  "canvas_id": "canvas-001",
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
| `canvas_id` | string | ✅ | 画布 ID |
| `stroke_id` | string | ✅ | UUID v4 |
| `points` | array | ✅ | 坐标点数组 |
| `width` | number | ✅ | 橡皮擦宽度（通常为画笔的 3 倍） |
| `color` | ❌ | 无需填写 | 橡皮擦使用背景色 |

#### 光标同步 (cursor)

```json
{
  "action": "cursor",
  "canvas_id": "canvas-001",
  "x": 500,
  "y": 300
}
```

#### 绘图元素新增 (element_add)

> 用于同步 Excalidraw 风格的“图形/文字元素”。
>
> - `stroke/erase` 仍用于自由绘制（点序列）。
> - `element_add` 用于一次性落地一个元素（矩形/椭圆/直线/文字）。
>
> 说明：第一版只要求 `element_add`。`element_update`/`element_delete` 可后续补齐。

**消息体**：

```json
{
  "action": "element_add",
  "canvas_id": "canvas-001",
  "element_id": "550e8400-e29b-41d4-a716-4466554400aa",
  "kind": "rect",
  "data": {
    "x1": 120,
    "y1": 180,
    "x2": 420,
    "y2": 360
  },
  "style": {
    "stroke": "#2563eb",
    "fill": "transparent",
    "stroke_width": 3,
    "opacity": 1
  },
  "timestamp": 1700000000050
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | ✅ | 固定值 `"element_add"` |
| `canvas_id` | string | ✅ | 画布 ID |
| `element_id` | string | ✅ | 元素 UUID v4（全局唯一） |
| `kind` | string | ✅ | 元素类型：`rect`/`ellipse`/`line`/`text` |
| `data` | object | ✅ | 元素数据，随 `kind` 不同而变化（见下） |
| `style` | object | ✅ | 元素样式（描边/填充/透明度等） |
| `timestamp` | number | ✅ | 客户端时间戳（毫秒） |

`data` 字段约定：

- `rect` / `ellipse` / `line`：

```json
{ "x1": 0, "y1": 0, "x2": 100, "y2": 100 }
```

- `text`：

```json
{
  "x": 200,
  "y": 150,
  "text": "Hello SyncCanvas",
  "font_size": 20,
  "font_family": "Arial",
  "align": "left"
}
```

`style` 字段约定：

```json
{
  "stroke": "#111827",
  "fill": "transparent",
  "stroke_width": 3,
  "opacity": 1
}
```

### 2.3 服务端 → 客户端

#### 广播消息

```json
{
  "type": "broadcast",
  "sequence_id": 10001,
  "canvas_id": "canvas-001",
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
| `sequence_id` | number | ✅ | 该画布内全局单调递增序号 |
| `canvas_id` | string | ✅ | 画布 ID |
| `user_id` | string | ✅ | 发送者用户 ID |
| 其他字段 | - | - | 与客户端消息相同 |

#### 欢迎消息 (welcome)

```json
{
  "type": "welcome",
  "user_id": "user-abc123",
  "canvas_id": "canvas-001",
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
| 1004 | 未提供 canvas_id |
| 1005 | 画布不存在 |

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
{ "type": "sync_request", "canvas_id": "canvas-001", "from_sequence_id": 1000 }

// 服务端 → 客户端
{
  "type": "sync_response",
  "canvas_id": "canvas-001",
  "operations": [
    { "sequence_id": 1001, "action": "stroke", ... },
    { "sequence_id": 1002, "action": "stroke", ... }
  ],
  "latest_sequence_id": 1050
}
```

---

## 三、HTTP 接口

### 3.1 认证接口

#### 注册

```
POST /api/v1/auth/register
Content-Type: application/json
```

**请求体**：

```json
{
  "username": "alice",
  "password": "secret123"
}
```

**响应** (201)：

```json
{
  "success": true,
  "data": {
    "user_id": "user-abc123",
    "username": "alice"
  }
}
```

**错误响应** (409 用户名已存在)：

```json
{
  "success": false,
  "error": {
    "code": 2001,
    "message": "用户名已被注册"
  }
}
```

#### 登录

```
POST /api/v1/auth/login
Content-Type: application/json
```

**请求体**：

```json
{
  "username": "alice",
  "password": "secret123"
}
```

**响应** (200)：

```json
{
  "success": true,
  "data": {
    "user_id": "user-abc123",
    "username": "alice",
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**错误响应** (401 认证失败)：

```json
{
  "success": false,
  "error": {
    "code": 2002,
    "message": "用户名或密码错误"
  }
}
```

### 3.2 画布接口

#### 创建画布

> ⚠️ 需要认证 Header：`Authorization: Bearer <token>`

```
POST /api/v1/canvases
Content-Type: application/json
Authorization: Bearer <token>
```

**请求体**：

```json
{
  "name": "我的画布"
}
```

> `name` 可选，不填时服务端自动生成名称（如 "Canvas-xxx"）。

**响应** (201)：

```json
{
  "success": true,
  "data": {
    "canvas_id": "canvas-001",
    "name": "我的画布",
    "owner_id": "user-abc123",
    "created_at": "2026-05-17T10:00:00Z"
  }
}
```

#### 获取画布列表

> ⚠️ 需要认证

```
GET /api/v1/canvases
Authorization: Bearer <token>
```

**响应** (200)：

```json
{
  "success": true,
  "data": [
    {
      "canvas_id": "canvas-001",
      "name": "我的画布",
      "owner_id": "user-abc123",
      "created_at": "2026-05-17T10:00:00Z"
    },
    {
      "canvas_id": "canvas-002",
      "name": "团队协作",
      "owner_id": "user-def456",
      "created_at": "2026-05-17T11:00:00Z"
    }
  ]
}
```

#### 获取历史操作

```
GET /api/v1/canvases/:canvas_id/operations?from=0&limit=1000
```

**响应**：

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

#### 获取最新快照

```
GET /api/v1/canvases/:canvas_id/snapshots/latest
```

**响应**：

```json
{
  "success": true,
  "data": {
    "sequence_id": 10500,
    "svg_data": "<svg>...</svg>",
    "created_at": "2026-05-17T10:00:00Z"
  }
}
```

#### 获取统计信息

```
GET /api/v1/canvases/:canvas_id/stats
```

**响应**：

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

### 4.1 整体流程

```
步骤 1: 注册/登录 → 获取 token
步骤 2: 创建/选择画布 → 获取 canvas_id
步骤 3: WebSocket 连接 → 进入画布
步骤 4: 开始绘画
```

### 4.2 连接流程

```
客户端                      服务端
  |                           |
  |------ 注册/登录 ---------->|
  |<----- token --------------|
  |                           |
  |------ 创建/列表画布 ------>|
  |<----- canvas_id ----------|
  |                           |
  |------ TCP 连接 ---------->|
  |                           |
  |<----- WebSocket 握手 ------|
  |                           |
  |<----- welcome ------------|
  |     (含 user_id, canvas_id)|
  |                           |
```

### 4.3 发送笔画流程

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

### 4.4 广播流程

```
客户端 A (canvas-001)     服务端                  客户端 B (canvas-001)
    |                        |                        |
    |---- stroke msg ------>|                        |
    |   (canvas_id=001)      |---- broadcast -------->|
    |                        |   (仅限 canvas-001)    |
    |<--- 确认 OK -----------|                        |
    |                        |                        |
    |                                           (canvas-002 的用户不受影响)
```

> 不同 `canvas_id` 的消息完全隔离。

### 4.5 同步流程

```
客户端                      服务端
  |                           |
  | 发现 sequence_id 跳号      |
  | (在当前 canvas_id 内)     |
  |                           |
  |-- sync_request (canvas, from) -->|
  |                           |
  |<-- sync_response (ops) ---|
  |                           |
  | 重放所有 missed ops        |
  | (仅限当前 canvas_id)       |
  |                           |
```

---

## 五、数据校验

### 5.1 客户端校验

| 字段 | 校验规则 |
|------|----------|
| `action` | 必须是 `"stroke"`, `"erase"`, `"cursor"`, `"pong"`, `"element_add"` 之一 |
| `canvas_id` | 必须是字符串，非空 |
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
| `sequence_id` | 必须是上一个 +1（在同一 canvas_id 内） |
| `user_id` | 必须是已连接的用户 |
| `timestamp` | 必须在当前时间 ±10 秒内 |
| `canvas_id` | 必须存在 |

---

## 六、负责人

| 模块 | 负责人 | 说明 |
|------|--------|------|
| 用户数据模型、画布数据模型 | A | MongoDB Schema + 认证逻辑 |
| HTTP 认证接口、HTTP 画布接口 | B | 路由 + 业务逻辑 |
| WebSocket 认证与画布隔离 | B | 连接时验证 canvas_id |
| 前端画布选择 UI | C | 列表展示、创建画布、选择画布 |
| 前端采集器 | D | 不变 |

---

## 七、版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| v1.0 | 2026-05-11 | 初始版本，全局单画布 |
| v2.0 | 2026-05-17 | 新增用户注册/登录、新增多画布管理、更新序列号作用域为按画布隔离 |
