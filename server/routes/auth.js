/**
 * 认证路由
 * POST /api/v1/auth/register - 用户注册
 * POST /api/v1/auth/login  - 用户登录
 */

const url = require('url');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { createUser, findUserByUsername } = require('../auth-mongo');
const { generateToken } = require('../middleware/auth');

const SALT_ROUNDS = 10;

/**
 * 注册路由处理
 */
async function handleRegister(req, res, body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    sendError(res, 400, 2001, '请求体必须是有效的 JSON');
    return;
  }

  const { username, password } = data;

  if (!username || typeof username !== 'string' || username.trim().length === 0) {
    sendError(res, 400, 2001, '用户名不能为空');
    return;
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    sendError(res, 400, 2001, '密码至少需要 6 个字符');
    return;
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername.length > 50) {
    sendError(res, 400, 2001, '用户名不能超过 50 个字符');
    return;
  }

  try {
    const existing = await findUserByUsername(trimmedUsername);
    if (existing) {
      sendError(res, 409, 2001, '用户名已被注册');
      return;
    }

    const userId = 'user-' + uuidv4().replace(/-/g, '').slice(0, 12);
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    await createUser(userId, trimmedUsername, passwordHash);

    sendSuccess(res, 201, {
      user_id: userId,
      username: trimmedUsername
    });
  } catch (err) {
    console.error('[Auth] 注册失败:', err.message);
    sendError(res, 500, 5001, '服务器内部错误');
  }
}

/**
 * 登录路由处理
 */
async function handleLogin(req, res, body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    sendError(res, 400, 2002, '请求体必须是有效的 JSON');
    return;
  }

  const { username, password } = data;

  if (!username || !password) {
    sendError(res, 401, 2002, '用户名或密码不能为空');
    return;
  }

  try {
    const user = await findUserByUsername(username.trim());
    if (!user) {
      sendError(res, 401, 2002, '用户名或密码错误');
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      sendError(res, 401, 2002, '用户名或密码错误');
      return;
    }

    const token = generateToken({
      user_id: user.user_id,
      username: user.username
    });

    sendSuccess(res, 200, {
      user_id: user.user_id,
      username: user.username,
      token
    });
  } catch (err) {
    console.error('[Auth] 登录失败:', err.message);
    sendError(res, 500, 5001, '服务器内部错误');
  }
}

/**
 * 注册路由解析和分发
 */
async function handleAuthRoute(req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (req.method !== 'POST') {
    sendError(res, 405, 1003, '只支持 POST 方法');
    return;
  }

  let body = '';
  for await (const chunk of req) {
    body += chunk;
  }

  if (pathname === '/api/v1/auth/register') {
    await handleRegister(req, res, body);
  } else if (pathname === '/api/v1/auth/login') {
    await handleLogin(req, res, body);
  } else {
    sendError(res, 404, 1004, '路由不存在');
  }
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

module.exports = { handleAuthRoute };
