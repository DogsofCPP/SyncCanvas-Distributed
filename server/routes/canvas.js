/**
 * 画布路由
 * POST /api/v1/canvases        - 创建画布（需认证）
 * GET  /api/v1/canvases        - 获取画布列表（需认证）
 * GET  /api/v1/canvases/:id    - 获取单个画布
 * DELETE /api/v1/canvases/:id  - 删除画布（需认证，仅所有者）
 * GET  /api/v1/canvases/:id/stats - 获取画布统计
 */

const url = require('url');
const { v4: uuidv4 } = require('uuid');
const {
  createCanvas,
  findCanvasById,
  listCanvases,
  countCanvases,
  deleteCanvas
} = require('../auth-mongo');
const { getStrokesCount } = require('../mongo-client');

/**
 * 创建画布
 */
async function handleCreateCanvas(req, res, query) {
  let data;
  try {
    data = JSON.parse(query || '{}');
  } catch {
    sendError(res, 400, 1002, '请求体必须是有效的 JSON');
    return;
  }

  const { name } = data;
  const canvasId = 'canvas-' + uuidv4().replace(/-/g, '').slice(0, 12);
  const canvasName = (name && typeof name === 'string' && name.trim())
    ? name.trim()
    : '未命名画布';

  try {
    await createCanvas(canvasId, canvasName, req.user.user_id);

    const canvas = await findCanvasById(canvasId);
    sendSuccess(res, 201, {
      canvas_id: canvas.canvas_id,
      name: canvas.name,
      owner_id: canvas.owner_id,
      created_at: canvas.created_at
    });
  } catch (err) {
    console.error('[Canvas] 创建画布失败:', err.message);
    sendError(res, 500, 5001, '服务器内部错误');
  }
}

/**
 * 获取画布列表
 */
async function handleListCanvases(req, res, query) {
  const parsed = url.parse(req.url, true);
  const page = Math.max(1, parseInt(parsed.query.page) || 1);
  const pageSize = Math.min(50, Math.max(1, parseInt(parsed.query.pageSize) || 20));
  const skip = (page - 1) * pageSize;

  try {
    const canvases = await listCanvases({ skip, limit: pageSize });
    const total = await countCanvases();

    sendSuccess(res, 200, {
      canvases: canvases.map(c => ({
        canvas_id: c.canvas_id,
        name: c.name,
        owner_id: c.owner_id,
        created_at: c.created_at
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize)
      }
    });
  } catch (err) {
    console.error('[Canvas] 获取画布列表失败:', err.message);
    sendError(res, 500, 5001, '服务器内部错误');
  }
}

/**
 * 获取单个画布
 */
async function handleGetCanvas(req, res, canvasId) {
  try {
    const canvas = await findCanvasById(canvasId);
    if (!canvas) {
      sendError(res, 404, 1005, '画布不存在');
      return;
    }

    sendSuccess(res, 200, {
      canvas_id: canvas.canvas_id,
      name: canvas.name,
      owner_id: canvas.owner_id,
      created_at: canvas.created_at
    });
  } catch (err) {
    console.error('[Canvas] 获取画布失败:', err.message);
    sendError(res, 500, 5001, '服务器内部错误');
  }
}

/**
 * 删除画布（仅所有者）
 */
async function handleDeleteCanvas(req, res, canvasId) {
  try {
    const canvas = await findCanvasById(canvasId);
    if (!canvas) {
      sendError(res, 404, 1005, '画布不存在');
      return;
    }

    if (canvas.owner_id !== req.user.user_id) {
      sendError(res, 403, 1006, '只有画布所有者才能删除画布');
      return;
    }

    const result = await deleteCanvas(canvasId, req.user.user_id);

    if (result.deletedCount > 0) {
      sendSuccess(res, 200, { deleted: true, canvas_id: canvasId });
    } else {
      sendError(res, 500, 5001, '删除失败');
    }
  } catch (err) {
    console.error('[Canvas] 删除画布失败:', err.message);
    sendError(res, 500, 5001, '服务器内部错误');
  }
}

/**
 * 获取画布统计
 */
async function handleCanvasStats(req, res, canvasId) {
  try {
    const canvas = await findCanvasById(canvasId);
    if (!canvas) {
      sendError(res, 404, 1005, '画布不存在');
      return;
    }

    const totalOperations = await getStrokesCount(canvasId);

    sendSuccess(res, 200, {
      canvas_id: canvasId,
      total_operations: totalOperations
    });
  } catch (err) {
    console.error('[Canvas] 获取统计失败:', err.message);
    sendError(res, 500, 5001, '服务器内部错误');
  }
}

/**
 * 画布路由分发
 */
async function handleCanvasRoute(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  const canvasMatch = pathname.match(/^\/api\/v1\/canvases\/([^/]+)(\/stats)?$/);

  if (req.method === 'POST' && pathname === '/api/v1/canvases') {
    let body = '';
    for await (const chunk of req) { body += chunk; }
    await handleCreateCanvas(req, res, body);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/v1/canvases') {
    await handleListCanvases(req, res, parsed.query);
    return;
  }

  if (canvasMatch) {
    const canvasId = decodeURIComponent(canvasMatch[1]);
    const isStats = !!canvasMatch[2];

    if (req.method === 'GET' && isStats) {
      await handleCanvasStats(req, res, canvasId);
      return;
    }
    if (req.method === 'GET') {
      await handleGetCanvas(req, res, canvasId);
      return;
    }
    if (req.method === 'DELETE') {
      let body = '';
      for await (const chunk of req) { body += chunk; }
      await handleDeleteCanvas(req, res, canvasId);
      return;
    }
  }

  sendError(res, 404, 1004, '路由不存在');
}

function sendSuccess(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify({ success: true, data }));
}

function sendError(res, statusCode, code, message) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify({
    success: false,
    error: { code, message }
  }));
}

module.exports = { handleCanvasRoute };
