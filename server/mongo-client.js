/**
 * MongoDB 客户端模块，负责按照 SCHEMA.md 初始化集合、索引，并暴露基础数据库操作。
 */

const { MongoClient } = require('mongodb');

/**
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
};
