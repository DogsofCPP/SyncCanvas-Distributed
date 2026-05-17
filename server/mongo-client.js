/**
 * MongoDB 客户端模块，负责连接数据库并暴露 operations 集合操作。
 */

const { MongoClient } = require('mongodb');

/**
 * MongoDB 默认连接地址。
 */
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sync_canvas';

/**
 * MongoDB 集合名称。
 */
const OPERATIONS_COLLECTION = 'operations';

/**
 * MongoDB 客户端实例。
 */
const mongoClient = new MongoClient(MONGO_URI);

/**
 * 当前数据库实例。
 */
let database = null;

/**
 * 初始化 MongoDB 连接，并创建查询需要的索引。
 */
async function initMongo() {
  if (database) {
    return database;
  }

  // Node 服务启动时连接 MongoDB，后续 Kafka Consumer 和 HTTP API 共用该连接。
  await mongoClient.connect();
  database = mongoClient.db();

  // sequence_id 用于历史增量查询，timestamp 用于后续统计或快照范围查询。
  await getOperationsCollection().createIndexes([
    { key: { sequence_id: 1 }, name: 'idx_sequence_id' },
    { key: { timestamp: 1 }, name: 'idx_timestamp' },
  ]);

  console.log(`[MongoDB] 已连接: ${MONGO_URI}`);
  return database;
}

/**
 * 获取 operations 集合。
 *
 * @returns {import('mongodb').Collection} operations 集合
 */
function getOperationsCollection() {
  if (!database) {
    throw new Error('MongoDB 尚未初始化');
  }

  return database.collection(OPERATIONS_COLLECTION);
}

/**
 * 批量保存 Canvas 操作。
 *
 * @param {object[]} operations Canvas 操作数组
 */
async function saveOperations(operations) {
  if (!operations.length) {
    return;
  }

  // 为每条操作补充服务端写入时间，方便后续排查和统计。
  const now = new Date();
  const docs = operations.map((operation) => ({
    ...operation,
    created_at: operation.created_at || now,
  }));

  await getOperationsCollection().insertMany(docs, { ordered: false });
}

/**
 * 查询指定 sequence_id 之后的历史操作。
 *
 * @param {number} from 起始 sequence_id
 * @param {number} limit 返回数量限制
 * @returns {Promise<object[]>} 历史操作列表
 */
async function findOperationsAfter(from, limit) {
  return await getOperationsCollection()
    .find({ sequence_id: { $gt: from } })
    .sort({ sequence_id: 1 })
    .limit(limit)
    .toArray();
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
  initMongo,
  saveOperations,
  findOperationsAfter,
  closeMongo,
};
