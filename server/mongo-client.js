/**
 * MongoDB 客户端模块 - 画布痕迹存储
 * - 存储画布操作（stroke）到 MongoDB
 * - 支持按 canvas_id 查询操作历史
 * - 支持批量查询和分页
 */

const { MongoClient } = require('mongodb');

/**
 * MongoDB 配置
 */
const MONGO_HOST = process.env.MONGO_HOST || 'localhost';
const MONGO_PORT = process.env.MONGO_PORT || 27017;
const MONGO_URI = process.env.MONGO_URI || `mongodb://${MONGO_HOST}:${MONGO_PORT}`;
const DB_NAME = process.env.MONGO_DB_NAME || 'synccanvas';
const COLLECTION_STROKES = 'strokes';
const COLLECTION_SNAPSHOTS = 'snapshots';

/**
 * MongoDB 客户端实例
 */
let mongoClient = null;
let db = null;

/**
 * 连接 MongoDB
 */
async function connectMongo() {
  if (mongoClient && mongoClient.topology && mongoClient.topology.isConnected()) {
    return db;
  }

  mongoClient = new MongoClient(MONGO_URI, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  await mongoClient.connect();
  db = mongoClient.db(DB_NAME);

  console.log(`[MongoDB] 已连接: ${MONGO_URI}/${DB_NAME}`);

  await ensureIndexes();
  return db;
}

/**
 * 确保索引存在
 */
async function ensureIndexes() {
  const collection = db.collection(COLLECTION_STROKES);

  // stroke_id 唯一索引（每个笔画一个文档）
  await collection.createIndex(
    { stroke_id: 1 },
    { unique: true }
  );
  // 画布内按顺序查询
  await collection.createIndex({ canvas_id: 1, sequence_id: 1 });
  // 用户操作历史
  await collection.createIndex({ user_id: 1, timestamp: -1 });

  // snapshots 集合索引
  const snapshotsCollection = db.collection(COLLECTION_SNAPSHOTS);
  await snapshotsCollection.createIndex(
    { canvas_id: 1, sequence_id: 1 },
    { unique: true }
  );
  await snapshotsCollection.createIndex(
    { canvas_id: 1, created_at: -1 }
  );

  console.log('[MongoDB] 索引已创建');
}

/**
 * 获取集合引用
 */
function getStrokesCollection() {
  if (!db) {
    throw new Error('[MongoDB] 未连接，请先调用 connectMongo()');
  }
  return db.collection(COLLECTION_STROKES);
}

/**
 * 存储单条画布操作（每个笔画存储为一个完整的文档）
 *
 * @param {object} operation 画布操作对象
 * @param {string} canvasId 画布 ID（默认 'default'）
 * @returns {Promise<object>} 插入结果
 */
async function saveStroke(operation, canvasId = 'default') {
  const collection = getStrokesCollection();
  const points = operation.points || [];

  if (points.length === 0) {
    return { insertedCount: 0 };
  }

  // 存储完整的笔画数据
  const document = {
    canvas_id: canvasId,
    stroke_id: operation.stroke_id,
    sequence_id: operation.sequence_id,
    user_id: operation.user_id,
    msg_type: operation.msg_type || 'stroke',
    action: operation.action || operation.msg_type || 'stroke',
    color: operation.color || '#000000',
    width: operation.width || 3,
    timestamp: operation.timestamp || Date.now(),
    created_at: new Date(),
    // 存储所有点（10ms 间隔）
    points: points.map((p, i) => ({
      x: p.x,
      y: p.y,
      t: p.t || (operation.timestamp || Date.now()) + i * 10
    })),
    point_count: points.length,
  };

  // 使用 upsert 确保同一 stroke_id 只存储一条记录
  const result = await collection.updateOne(
    { stroke_id: operation.stroke_id },
    { $set: document },
    { upsert: true }
  );

  return result;
}

/**
 * 批量存储画布操作
 *
 * @param {Array<object>} operations 画布操作数组
 * @param {string} canvasId 画布 ID（默认 'default'）
 * @returns {Promise<object>} 批量插入结果
 */
async function saveStrokesBatch(operations, canvasId = 'default') {
  if (!operations || operations.length === 0) {
    return { insertedCount: 0 };
  }

  const collection = getStrokesCollection();
  const documents = [];

  for (const operation of operations) {
    const points = operation.points || [];
    if (points.length === 0) continue;

    documents.push({
      canvas_id: canvasId,
      stroke_id: operation.stroke_id,
      sequence_id: operation.sequence_id,
      user_id: operation.user_id,
      msg_type: operation.msg_type || 'stroke',
      action: operation.action || operation.msg_type || 'stroke',
      color: operation.color || '#000000',
      width: operation.width || 3,
      timestamp: operation.timestamp || Date.now(),
      created_at: new Date(),
      points: points.map((p, i) => ({
        x: p.x,
        y: p.y,
        t: p.t || (operation.timestamp || Date.now()) + i * 10
      })),
      point_count: points.length,
    });
  }

  if (documents.length === 0) {
    return { insertedCount: 0 };
  }

  // 批量 upsert
  const results = await Promise.all(
    documents.map(doc =>
      collection.updateOne(
        { stroke_id: doc.stroke_id },
        { $set: doc },
        { upsert: true }
      )
    )
  );

  return { insertedCount: results.filter(r => r.upsertedCount > 0).length };
}

/**
 * 按 canvas_id 查询所有笔画（直接返回，每个笔画是一个完整的文档）
 *
 * @param {string} canvasId 画布 ID
 * @param {object} options 查询选项 { limit, skip, sinceSequenceId }
 * @returns {Promise<Array<object>>} 笔画数组
 */
async function getStrokesByCanvas(canvasId = 'default', options = {}) {
  const collection = getStrokesCollection();

  const query = { canvas_id: canvasId };

  if (options.sinceSequenceId !== undefined) {
    query.sequence_id = { $gt: options.sinceSequenceId };
  }

  const strokes = await collection
    .find(query)
    .sort({ sequence_id: 1 })
    .skip(options.skip || 0)
    .limit(options.limit || 10000)
    .toArray();

  return strokes;
}

/**
 * 按 stroke_id 查询单条操作
 *
 * @param {string} strokeId 笔画 ID
 * @returns {Promise<object|null>} 操作对象或 null
 */
async function getStrokeById(strokeId) {
  const collection = getStrokesCollection();
  const stroke = await collection.findOne({ stroke_id: strokeId });
  return stroke;
}

/**
 * 按 user_id 查询用户的操作历史
 *
 * @param {string} userId 用户 ID
 * @param {object} options 查询选项 { limit, skip, startTime, endTime }
 * @returns {Promise<Array<object>>} 操作数组
 */
async function getStrokesByUser(userId, options = {}) {
  const collection = getStrokesCollection();

  const query = { user_id: userId };

  if (options.startTime || options.endTime) {
    query.timestamp = {};
    if (options.startTime) query.timestamp.$gte = options.startTime;
    if (options.endTime) query.timestamp.$lte = options.endTime;
  }

  const cursor = collection
    .find(query)
    .sort({ timestamp: -1 })
    .skip(options.skip || 0)
    .limit(options.limit || 100);

  const strokes = await cursor.toArray();
  return strokes;
}

/**
 * 获取画布的最新 sequence_id
 *
 * @param {string} canvasId 画布 ID
 * @returns {Promise<number>} 最新序列号，0 表示无数据
 */
async function getLatestSequenceId(canvasId = 'default') {
  const collection = getStrokesCollection();

  const result = await collection
    .find({ canvas_id: canvasId })
    .sort({ sequence_id: -1 })
    .limit(1)
    .toArray();

  if (result.length === 0) {
    return 0;
  }

  return result[0].sequence_id;
}

/**
 * 删除画布的所有操作
 *
 * @param {string} canvasId 画布 ID
 * @returns {Promise<object>} 删除结果
 */
async function clearCanvas(canvasId = 'default') {
  const collection = getStrokesCollection();
  const result = await collection.deleteMany({ canvas_id: canvasId });
  return result;
}

/**
 * 按 stroke_id 删除单条操作
 *
 * @param {string} strokeId 笔画 ID
 * @returns {Promise<object>} 删除结果
 */
async function deleteStrokeById(strokeId) {
  const collection = getStrokesCollection();
  const result = await collection.deleteOne({ stroke_id: strokeId });
  return result;
}

/**
 * 获取画布的操作数量
 *
 * @param {string} canvasId 画布 ID
 * @returns {Promise<number>} 操作数量
 */
async function getStrokesCount(canvasId = 'default') {
  const collection = getStrokesCollection();
  const count = await collection.countDocuments({ canvas_id: canvasId });
  return count;
}

/**
 * 保存画布快照
 *
 * @param {string} canvasId 画布 ID
 * @param {number} sequenceId 快照对应的最新 sequence_id
 * @param {string} svgData SVG 数据
 * @returns {Promise<object>} 保存结果
 */
async function saveSnapshot(canvasId, sequenceId, svgData) {
  const collection = db.collection(COLLECTION_SNAPSHOTS);
  const result = await collection.updateOne(
    { canvas_id: canvasId, sequence_id: sequenceId },
    {
      $set: {
        canvas_id: canvasId,
        sequence_id: sequenceId,
        svg_data: svgData,
        created_at: new Date()
      }
    },
    { upsert: true }
  );
  return result;
}

/**
 * 获取画布的最新快照
 *
 * @param {string} canvasId 画布 ID
 * @returns {Promise<object|null>} 快照对象或 null
 */
async function getLatestSnapshot(canvasId) {
  const collection = db.collection(COLLECTION_SNAPSHOTS);
  const snapshot = await collection
    .find({ canvas_id: canvasId })
    .sort({ sequence_id: -1 })
    .limit(1)
    .toArray();

  return snapshot.length > 0 ? snapshot[0] : null;
}

/**
 * 获取指定 sequence_id 的快照
 *
 * @param {string} canvasId 画布 ID
 * @param {number} sequenceId 序列号
 * @returns {Promise<object|null>} 快照对象或 null
 */
async function getSnapshotBySequenceId(canvasId, sequenceId) {
  const collection = db.collection(COLLECTION_SNAPSHOTS);
  const snapshot = await collection.findOne({
    canvas_id: canvasId,
    sequence_id: sequenceId
  });
  return snapshot;
}

/**
 * 删除画布的所有快照
 *
 * @param {string} canvasId 画布 ID
 * @returns {Promise<object>} 删除结果
 */
async function clearSnapshots(canvasId) {
  const collection = db.collection(COLLECTION_SNAPSHOTS);
  const result = await collection.deleteMany({ canvas_id: canvasId });
  return result;
}

/**
 * 关闭 MongoDB 连接
 */
async function closeMongo() {
  if (mongoClient) {
    await mongoClient.close();
    mongoClient = null;
    db = null;
    console.log('[MongoDB] 连接已关闭');
  }
}

/**
 * 健康检查
 */
async function healthCheck() {
  try {
    if (!db) {
      return { status: 'disconnected' };
    }
    await db.command({ ping: 1 });
    return { status: 'connected', uri: MONGO_URI, database: DB_NAME };
  } catch (err) {
    return { status: 'error', message: err.message };
  }
}

module.exports = {
  MONGO_URI,
  DB_NAME,
  COLLECTION_STROKES,
  COLLECTION_SNAPSHOTS,
  connectMongo,
  saveStroke,
  saveStrokesBatch,
  getStrokesByCanvas,
  getStrokeById,
  getStrokesByUser,
  getLatestSequenceId,
  clearCanvas,
  deleteStrokeById,
  getStrokesCount,
  saveSnapshot,
  getLatestSnapshot,
  getSnapshotBySequenceId,
  clearSnapshots,
  closeMongo,
  healthCheck,
};
