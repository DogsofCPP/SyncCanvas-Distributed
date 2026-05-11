# MongoDB 数据模型设计

## 集合 1: operations（操作日志）

存储所有笔画操作，用于历史重放和持久化。

```javascript
db.operations.createIndex({ "sequence_id": 1 }, { unique: true })
db.operations.createIndex({ "timestamp": 1 })
db.operations.createIndex({ "user_id": 1 })
```

### 文档结构

```json
{
  "_id": ObjectId("..."),
  "sequence_id": 10001,           // 全局单调递增序号（唯一索引）
  "user_id": "user-abc123",      // 用户标识
  "action": "stroke",            // stroke | erase
  "stroke_id": "uuid-v4",        // 一次完整笔画的唯一 ID
  "segment_index": 0,            // 同一笔画的第几个片段（0, 1, 2...）
  "points": [
    { "x": 100, "y": 200, "t": 1700000000000 }
  ],
  "color": "#FF5733",            // 十六进制颜色（erase 时为背景色）
  "width": 3,                    // 线条宽度
  "timestamp": 1700000000000,    // 服务端收到时间
  "created_at": ISODate("...")
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `sequence_id` | integer | ✅ | 全局单调递增，由 Redis INCR 生成 |
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

## 集合 2: snapshots（快照）

存储画布的 SVG 快照，用于加速冷启动和灾难恢复。

```javascript
db.snapshots.createIndex({ "sequence_id": 1 }, { unique: true })
db.snapshots.createIndex({ "created_at": -1 })
```

### 文档结构

```json
{
  "_id": ObjectId("..."),
  "sequence_id": 10500,           // 快照对应的最新 sequence_id
  "svg_data": "<svg>...</svg>",  // SVG 格式的画布快照
  "thumbnail": "base64...",       // 缩略图（可选）
  "compressed": true,             // 是否 GZIP 压缩
  "size_bytes": 45000,           // 压缩后大小
  "created_at": ISODate("...")
}
```

### 字段说明

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
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
| 手动触发 | API 调用 `/api/v1/snapshots/trigger` |

---

## 集合 3: users（用户会话，可选）

存储在线用户信息（可选，非核心功能）。

```javascript
db.users.createIndex({ "user_id": 1 }, { unique: true })
db.users.createIndex({ "last_seen": 1 })
```

### 文档结构

```json
{
  "_id": ObjectId("..."),
  "user_id": "user-abc123",
  "display_name": "用户 A",
  "cursor_x": 500,
  "cursor_y": 300,
  "color": "#FF5733",
  "connected_at": ISODate("..."),
  "last_seen": ISODate("...")
}
```

---

## 查询示例

### 获取最新操作（用于重放）

```javascript
db.operations
  .find({})
  .sort({ sequence_id: 1 })
  .limit(1000)
```

### 获取指定范围操作

```javascript
db.operations
  .find({ sequence_id: { $gte: 1000, $lte: 2000 } })
  .sort({ sequence_id: 1 })
```

### 获取最新快照

```javascript
db.snapshots
  .findOne({})
  .sort({ sequence_id: -1 })
```

### 统计在线人数

```javascript
db.users.countDocuments({
  last_seen: { $gte: ISODate("...") }
})
```
