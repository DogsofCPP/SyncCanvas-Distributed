/**
<<<<<<< HEAD
 * MongoDB 客户端模块 - 画布痕迹存储
 * - 存储画布操作（stroke）到 MongoDB
 * - 支持按 canvas_id 查询操作历史
 * - 支持批量查询和分页
=======
 * MongoDB 客户端模块，负责按照 SCHEMA.md 初始化集合、索引，并暴露基础数据库操作。
>>>>>>> a66d64461534e09cb4b99881e507207735be6354
 */

const { MongoClient } = require('mongodb');

/**
<<<<<<< HEAD
 * MongoDB 配置
 */
const MONGO_HOST = process.env.MONGO_HOST || 'localhost';
const MONGO_PORT = process.env.MONGO_PORT || 27017;
const MONGO_URI = process.env.MONGO_URI || `mongodb://${MONGO_HOST}:${MONGO_PORT}`;
const DB_NAME = process.env.MONGO_DB_NAME || 'synccanvas';
const COLLECTION_STROKES = 'strokes';

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
  connectMongo,
  saveStroke,
  saveStrokesBatch,
  getStrokesByCanvas,
  getStrokeById,
  getStrokesByUser,
  getLatestSequenceId,
  clearCanvas,
  getStrokesCount,
  closeMongo,
  healthCheck,
=======
 * MongoDB 默认连接地址。
 */
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sync_canvas';

/**
 * 默认画布 ID，当前前端还没有多画布选择时使用。
 */
const DEFAULT_CANVAS_ID = 'canvas-001';

/**
 * MongoDB 集合名称。
 */
const COLLECTIONS = {
  users: 'users',
  canvases: 'canvases',
  operations: 'operations',
  snapshots: 'snapshots',
};

/**
 * MongoDB 客户端实例。
 */
const mongoClient = new MongoClient(MONGO_URI);

/**
 * 当前数据库实例。
 */
let database = null;

/**
 * 初始化 MongoDB 连接，并按照 SCHEMA.md 创建 users、canvases、operations、snapshots 的索引。
 */
async function initMongo() {
  if (database) {
    return database;
  }

  // Node 服务启动时连接 MongoDB，Kafka Consumer 和 HTTP API 共用该连接。
  await mongoClient.connect();
  database = mongoClient.db();

  await ensureUsersIndexes();
  await ensureCanvasesIndexes();
  await ensureOperationsIndexes();
  await ensureSnapshotsIndexes();

  console.log(`[MongoDB] 已连接并初始化集合索引: ${MONGO_URI}`);
  return database;
}

/**
 * 获取指定 MongoDB 集合。
 *
 * @param {string} name 集合名称
 * @returns {import('mongodb').Collection} MongoDB 集合
 */
function getCollection(name) {
  if (!database) {
    throw new Error('MongoDB 尚未初始化');
  }

  return database.collection(name);
}

/**
 * 获取 users 集合。
 *
 * @returns {import('mongodb').Collection} users 集合
 */
function getUsersCollection() {
  return getCollection(COLLECTIONS.users);
}

/**
 * 获取 canvases 集合。
 *
 * @returns {import('mongodb').Collection} canvases 集合
 */
function getCanvasesCollection() {
  return getCollection(COLLECTIONS.canvases);
}

/**
 * 获取 operations 集合。
 *
 * @returns {import('mongodb').Collection} operations 集合
 */
function getOperationsCollection() {
  return getCollection(COLLECTIONS.operations);
}

/**
 * 获取 snapshots 集合。
 *
 * @returns {import('mongodb').Collection} snapshots 集合
 */
function getSnapshotsCollection() {
  return getCollection(COLLECTIONS.snapshots);
}

/**
 * 为 users 集合创建 SCHEMA.md 要求的索引。
 */
async function ensureUsersIndexes() {
  await getUsersCollection().createIndexes([
    { key: { user_id: 1 }, name: 'idx_user_id_unique', unique: true },
    { key: { username: 1 }, name: 'idx_username_unique', unique: true },
  ]);
}

/**
 * 为 canvases 集合创建 SCHEMA.md 要求的索引。
 */
async function ensureCanvasesIndexes() {
  await getCanvasesCollection().createIndexes([
    { key: { canvas_id: 1 }, name: 'idx_canvas_id_unique', unique: true },
    { key: { owner_id: 1 }, name: 'idx_owner_id' },
    { key: { created_at: -1 }, name: 'idx_canvas_created_at_desc' },
  ]);
}

/**
 * 为 operations 集合创建 SCHEMA.md 要求的索引。
 */
async function ensureOperationsIndexes() {
  await getOperationsCollection().createIndexes([
    { key: { canvas_id: 1, sequence_id: 1 }, name: 'idx_canvas_sequence_unique', unique: true },
    { key: { canvas_id: 1, timestamp: 1 }, name: 'idx_canvas_timestamp' },
    { key: { canvas_id: 1, user_id: 1 }, name: 'idx_canvas_user' },
  ]);
}

/**
 * 为 snapshots 集合创建 SCHEMA.md 要求的索引。
 */
async function ensureSnapshotsIndexes() {
  await getSnapshotsCollection().createIndexes([
    { key: { canvas_id: 1, sequence_id: 1 }, name: 'idx_snapshot_canvas_sequence_unique', unique: true },
    { key: { canvas_id: 1, created_at: -1 }, name: 'idx_snapshot_canvas_created_at_desc' },
  ]);
}

/**
 * 创建用户文档。
 *
 * @param {object} user 用户文档
 * @returns {Promise<import('mongodb').InsertOneResult>} 插入结果
 */
async function createUser(user) {
  const now = new Date();
  return await getUsersCollection().insertOne({
    ...user,
    created_at: user.created_at || now,
  });
}

/**
 * 根据用户名查询用户。
 *
 * @param {string} username 用户名
 * @returns {Promise<object|null>} 用户文档
 */
async function findUserByUsername(username) {
  return await getUsersCollection().findOne({ username });
}

/**
 * 创建画布文档。
 *
 * @param {object} canvas 画布文档
 * @returns {Promise<import('mongodb').InsertOneResult>} 插入结果
 */
async function createCanvas(canvas) {
  const now = new Date();
  return await getCanvasesCollection().insertOne({
    ...canvas,
    canvas_id: canvas.canvas_id || DEFAULT_CANVAS_ID,
    created_at: canvas.created_at || now,
  });
}

/**
 * 查询画布列表。
 *
 * @param {number} limit 返回数量限制
 * @returns {Promise<object[]>} 画布列表
 */
async function listCanvases(limit = 100) {
  return await getCanvasesCollection()
    .find({})
    .sort({ created_at: -1 })
    .limit(limit)
    .toArray();
}

/**
 * 批量保存 Canvas 操作日志。
 *
 * @param {object[]} operations Canvas 操作数组
 */
async function saveOperations(operations) {
  if (!operations.length) {
    return;
  }

  const now = new Date();
  const writes = operations.map((operation) => {
    const doc = {
      ...operation,
      canvas_id: operation.canvas_id || DEFAULT_CANVAS_ID,
      created_at: operation.created_at || now,
    };

    // 使用 upsert 避免 Kafka 重复投递时因唯一索引导致无限重试。
    return {
      updateOne: {
        filter: {
          canvas_id: doc.canvas_id,
          sequence_id: doc.sequence_id,
        },
        update: { $setOnInsert: doc },
        upsert: true,
      },
    };
  });

  await getOperationsCollection().bulkWrite(writes, { ordered: false });
}

/**
 * 查询指定画布中 sequence_id 之后的历史操作。
 *
 * @param {string} canvasId 画布 ID
 * @param {number} from 起始 sequence_id
 * @param {number} limit 返回数量限制
 * @returns {Promise<object[]>} 历史操作列表
 */
async function findOperationsAfter(canvasId, from, limit) {
  return await getOperationsCollection()
    .find({
      canvas_id: canvasId || DEFAULT_CANVAS_ID,
      sequence_id: { $gt: from },
    })
    .sort({ sequence_id: 1 })
    .limit(limit)
    .toArray();
}

/**
 * 保存画布快照。
 *
 * @param {object} snapshot 快照文档
 * @returns {Promise<import('mongodb').InsertOneResult>} 插入结果
 */
async function saveSnapshot(snapshot) {
  const now = new Date();
  const svgData = snapshot.svg_data || '';

  return await getSnapshotsCollection().insertOne({
    ...snapshot,
    canvas_id: snapshot.canvas_id || DEFAULT_CANVAS_ID,
    compressed: Boolean(snapshot.compressed),
    size_bytes: snapshot.size_bytes || Buffer.byteLength(svgData),
    created_at: snapshot.created_at || now,
  });
}

/**
 * 查询指定画布的最新快照。
 *
 * @param {string} canvasId 画布 ID
 * @returns {Promise<object|null>} 最新快照
 */
async function findLatestSnapshot(canvasId) {
  return await getSnapshotsCollection()
    .findOne({ canvas_id: canvasId || DEFAULT_CANVAS_ID }, { sort: { sequence_id: -1 } });
}

/**
 * 关闭 MongoDB 连接。
 */
async function closeMongo() {
  await mongoClient.close();
  database = null;
  console.log('[MongoDB] 连接已关闭');
}

module.exports = {
  DEFAULT_CANVAS_ID,
  initMongo,
  createUser,
  findUserByUsername,
  createCanvas,
  listCanvases,
  saveOperations,
  findOperationsAfter,
  saveSnapshot,
  findLatestSnapshot,
  closeMongo,
>>>>>>> a66d64461534e09cb4b99881e507207735be6354
};
