/**
 * JWT 认证中间件
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'synccanvas-secret-key-change-in-production';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

/**
 * 生成 JWT token
 */
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
}

/**
 * 验证 JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * 认证中间件 - 验证请求头中的 Bearer token
 * 成功时将 user 信息附加到 req.user
 * 失败时返回 401
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({
      success: false,
      error: { code: 1001, message: '未提供认证令牌' }
    }));
    return;
  }

  const token = authHeader.slice(7);
  const decoded = verifyToken(token);

  if (!decoded) {
    res.writeHead(401, { 'Content-Type': 'application/json', ...CORS_HEADERS });
    res.end(JSON.stringify({
      success: false,
      error: { code: 1002, message: '令牌无效或已过期' }
    }));
    return;
  }

  req.user = decoded;
  next();
}

/**
 * 选中的认证中间件 - 允许未登录访问
 * 如果有 token 则验证并附加 user，无 token 则继续
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }

  next();
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken,
  authMiddleware,
  optionalAuth,
};
