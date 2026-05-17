# MongoDB 数据模型设计

> **版本**: v2.0
> **日期**: 2026-05-17
> **说明**：v2.0 新增用户认证和多画布支持

---

## 集合 1: users（注册用户）

存储注册用户信息，用于登录认证。

```javascript
db.users.createIndex({ "user_id": 1 }, { unique: true })
db.users.createIndex({ "username": 1 }, { unique: true })
```

### 文档结构

```json
{
  "_id": ObjectId("..."),
  "user_id": "user-abc123",
  "username": "alice",
  "password_hash": "$2b$10$...",
  "created_at": ISODate("2026-05-17T10:00:00Z")
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `user_id` | string | ✅ | 用户唯一标识（UUID） |
| `username` | string | ✅ | 用户名（唯一索引） |
| `password_hash` | string | ✅ | bcrypt 哈希后的密码 |
| `created_at` | Date | ✅ | 注册时间 |

---

## 集合 2: canvases（画布）

存储画布元数据。

```javascript
db.canvases.createIndex({ "canvas_id": 1 }, { unique: true })
db.canvases.createIndex({ "owner_id": 1 })
db.canvases.createIndex({ "created_at": -1 })
```

### 文档结构

```json
{
  "_id": ObjectId("..."),
  "canvas_id": "canvas-001",
  "name": "我的画布",
  "owner_id": "user-abc123",
  "created_at": ISODate("2026-05-17T10:00:00Z")
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `canvas_id` | string | ✅ | 画布唯一标识（UUID） |
| `name` | string | ✅ | 画布名称 |
| `owner_id` | string | ✅ | 创建者用户 ID |
| `created_at` | Date | ✅ | 创建时间 |

---

## 集合 3: operations（操作日志）

存储所有笔画操作，**按 canvas_id 隔离**，用于历史重放和持久化。

```javascript
db.operations.createIndex({ "canvas_id": 1, "sequence_id": 1 }, { unique: true })
db.operations.createIndex({ "canvas_id": 1, "timestamp": 1 })
db.operations.createIndex({ "canvas_id": 1, "user_id": 1 })
```

> **关键**：sequence_id 在每个 canvas_id 内独立递增。

### 文档结构

```json
{
  "_id": ObjectId("..."),
  "canvas_id": "canvas-001",
  "sequence_id": 10001,
  "user_id": "user-abc123",
  "action": "stroke",
  "stroke_id": "uuid-v4",
  "segment_index": 0,
  "points": [
    { "x": 100, "y": 200, "t": 1700000000000 }
  ],
  "color": "#FF5733",
  "width": 3,
  "timestamp": 1700000000000,
  "created_at": ISODate("...")
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `canvas_id` | string | ✅ | 画布 ID（隔离广播范围） |
| `sequence_id` | integer | ✅ | 画布内单调递增，由 Redis INCR 生成 |
| `user_id` | string | ✅ | 用户唯一标识 |
| `action` | string | ✅ | `stroke`（笔画）或 `erase`（橡皮擦） |
| `stroke_id` | string | ✅ | UUID v4，同一次完整笔画的所有 segment 共享 |
| `segment_index` | integer | ✅ | 分段序号，用于前端还原笔画顺序 |
| `points` | array | ✅ | 坐标点数组 |
| `points[].x` | number | ✅ | X 坐标（像素） |
| `points[].y` | number | ✅ | Y 坐标（像素） |
| `points[].t` | number | ✅ | 时间戳（毫秒 Unix Epoch） |
| `color` | string | ✅ | HEX 颜色，如 `#FF5733` |
| `width` | number | ✅ | 线条宽度（像素） |
| `timestamp` | number | ✅ | 服务端收到消息的时间戳 |
| `created_at` | Date | ✅ | MongoDB 文档创建时间 |

---

## 集合 4: snapshots（快照）

存储画布的 SVG 快照，**按 canvas_id 隔离**，用于加速冷启动和灾难恢复。

```javascript
db.snapshots.createIndex({ "canvas_id": 1, "sequence_id": 1 }, { unique: true })
db.snapshots.createIndex({ "canvas_id": 1, "created_at": -1 })
```

### 文档结构

```json
{
  "_id": ObjectId("..."),
  "canvas_id": "canvas-001",
  "sequence_id": 10500,
  "svg_data": "<svg>...</svg>",
  "thumbnail": "base64...",
  "compressed": true,
  "size_bytes": 45000,
  "created_at": ISODate("...")
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `canvas_id` | string | ✅ | 画布 ID |
| `sequence_id` | integer | ✅ | 快照对应的最新 sequence_id |
| `svg_data` | string | ✅ | SVG 格式的画布内容 |
| `thumbnail` | string | ❌ | Base64 缩略图 |
| `compressed` | boolean | ✅ | 是否已 GZIP 压缩 |
| `size_bytes` | integer | ✅ | 压缩后字节数 |
| `created_at` | Date | ✅ | 快照创建时间 |

### 快照生成策略

| 触发条件 | 说明 |
|---------|------|
| 每 100 条操作 | operations 集合新增 100 条后触发 |
| 每 30 秒 | 定时任务触发（仅当有新操作时） |
| 手动触发 | API 调用 `/api/v1/canvases/:canvas_id/snapshots/trigger` |

---

## Redis 键设计

```
# 序列号生成器（按画布隔离）
seq:canvas-001  →  10001
seq:canvas-002  →  5001

# Pub/Sub 频道（按画布隔离）
channel:canvas-001
channel:canvas-002

# 在线用户（按画布隔离）
online:canvas-001  →  Set{ "user-abc", "user-def" }
online:canvas-002  →  Set{ "user-xyz" }
```

---

## 查询示例

### 用户注册（插入）

```javascript
db.users.insertOne({
  user_id: "user-abc123",
  username: "alice",
  password_hash: bcrypt.hashSync("secret123", 10),
  created_at: new Date()
})
```

### 用户登录（查询）

```javascript
db.users.findOne({ username: "alice" })
```

### 创建画布（插入）

```javascript
db.canvases.insertOne({
  canvas_id: "canvas-001",
  name: "我的画布",
  owner_id: "user-abc123",
  created_at: new Date()
})
```

### 获取画布列表

```javascript
db.canvases.find({}).sort({ created_at: -1 })
```

### 获取指定画布最新操作（用于重放）

```javascript
db.operations
  .find({ canvas_id: "canvas-001" })
  .sort({ sequence_id: 1 })
  .limit(1000)
```

### 获取指定画布指定范围操作

```javascript
db.operations
  .find({
    canvas_id: "canvas-001",
    sequence_id: { $gte: 1000, $lte: 2000 }
  })
  .sort({ sequence_id: 1 })
```

### 获取指定画布最新快照

```javascript
db.snapshots
  .findOne({ canvas_id: "canvas-001" })
  .sort({ sequence_id: -1 })
```

---

## 版本历史

| 版本 | 日期 | 修改内容 |
|------|------|----------|
| v1.0 | 2026-05-11 | 初始版本，无用户认证，全局单画布 |
| v2.0 | 2026-05-17 | 新增 users 和 canvases 集合，operations 和 snapshots 按 canvas_id 隔离，Redis 键按 canvas_id 隔离 |
