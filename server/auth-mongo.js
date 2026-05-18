/**
 * MongoDB 用户和画布集合操作模块
 * - 用户注册/登录
 * - 画布创建/列表/查询
 */

const { connectMongo, getStrokesCollection } = require('./mongo-client');

const COLLECTION_USERS = 'users';
const COLLECTION_CANVASES = 'canvases';

let db = null;

/**
 * 获取数据库实例
 */
function getDb() {
  if (!db) {
    throw new Error('[MongoDB] 未连接，请先调用 connectMongo()');
  }
  return db;
}

/**
 * 连接并初始化
 */
async function initAuthCollections() {
  db = await connectMongo();

  const usersCollection = db.collection(COLLECTION_USERS);
  await usersCollection.createIndex({ user_id: 1 }, { unique: true });
  await usersCollection.createIndex({ username: 1 }, { unique: true });

  const canvasesCollection = db.collection(COLLECTION_CANVASES);
  await canvasesCollection.createIndex({ canvas_id: 1 }, { unique: true });
  await canvasesCollection.createIndex({ owner_id: 1 });
  await canvasesCollection.createIndex({ created_at: -1 });

  console.log('[MongoDB] 用户和画布集合索引已初始化');
}

// ==================== 用户操作 ====================

/**
 * 创建用户
 */
async function createUser(userId, username, passwordHash) {
  const collection = getDb().collection(COLLECTION_USERS);
  const result = await collection.insertOne({
    user_id: userId,
    username,
    password_hash: passwordHash,
    created_at: new Date(),
  });
  return result;
}

/**
 * 按用户名查找用户
 */
async function findUserByUsername(username) {
  const collection = getDb().collection(COLLECTION_USERS);
  return await collection.findOne({ username });
}

/**
 * 按 userId 查找用户
 */
async function findUserById(userId) {
  const collection = getDb().collection(COLLECTION_USERS);
  return await collection.findOne({ user_id: userId });
}

// ==================== 画布操作 ====================

/**
 * 创建画布
 */
async function createCanvas(canvasId, name, ownerId) {
  const collection = getDb().collection(COLLECTION_CANVASES);
  const result = await collection.insertOne({
    canvas_id: canvasId,
    name,
    owner_id: ownerId,
    created_at: new Date(),
  });
  return result;
}

/**
 * 按 canvasId 查找画布
 */
async function findCanvasById(canvasId) {
  const collection = getDb().collection(COLLECTION_CANVASES);
  return await collection.findOne({ canvas_id: canvasId });
}

/**
 * 获取画布列表（按创建时间倒序）
 */
async function listCanvases(options = {}) {
  const collection = getDb().collection(COLLECTION_CANVASES);
  const cursor = collection
    .find(options.filter || {})
    .sort({ created_at: -1 });

  if (options.skip) {
    cursor.skip(options.skip);
  }
  if (options.limit) {
    cursor.limit(options.limit);
  }

  const canvases = await cursor.toArray();
  return canvases;
}

/**
 * 获取画布总数
 */
async function countCanvases(filter = {}) {
  const collection = getDb().collection(COLLECTION_CANVASES);
  return await collection.countDocuments(filter);
}

/**
 * 删除画布
 */
async function deleteCanvas(canvasId, ownerId) {
  const collection = getDb().collection(COLLECTION_CANVASES);
  const result = await collection.deleteOne({
    canvas_id: canvasId,
    owner_id: ownerId,
  });

  if (result.deletedCount > 0) {
    const strokesCollection = getDb().collection('strokes');
    await strokesCollection.deleteMany({ canvas_id: canvasId });
  }

  return result;
}

module.exports = {
  initAuthCollections,
  createUser,
  findUserByUsername,
  findUserById,
  createCanvas,
  findCanvasById,
  listCanvases,
  countCanvases,
  deleteCanvas,
};
