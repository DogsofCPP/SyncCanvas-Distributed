/**
 * SyncCanvas 输入采集器
 * 成员 D：负责输入采集、DP 压缩、WebSocket 发送
 *
 * 功能清单：
 * - 50ms 定时器采样
 * - 鼠标/触摸双支持
 * - requestAnimationFrame 节流
 * - Douglas-Peucker 曲线压缩
 * - WebSocket 自动重连
 * - 笔迹平滑与速度检测
 * - 性能统计
 * - 离线缓存
 *
 * 使用方式:
 * <script src="collector.js"></script>
 * <script>
 *   collector.start({ wsUrl: 'ws://localhost:3000' });
 * </script>
 */

// ==================== Douglas-Peucker 算法 ====================
class DouglasPeucker {
  /**
   * 简化点数组
   * @param {Array} points 点数组 [{x, y}]
   * @param {number} epsilon 容差值
   * @returns {Array} 简化后的点数组
   */
  static simplify(points, epsilon = 1.0) {
    if (!points || points.length <= 2) return points;

    let maxDistance = 0;
    let maxIndex = 0;
    const end = points.length - 1;

    for (let i = 1; i < end; i++) {
      const distance = this.perpendicularDistance(points[i], points[0], points[end]);
      if (distance > maxDistance) {
        maxDistance = distance;
        maxIndex = i;
      }
    }

    if (maxDistance > epsilon) {
      const left = this.simplify(points.slice(0, maxIndex + 1), epsilon);
      const right = this.simplify(points.slice(maxIndex), epsilon);
      return left.slice(0, -1).concat(right);
    }

    return [points[0], points[end]];
  }

  static perpendicularDistance(point, lineStart, lineEnd) {
    const dx = lineEnd.x - lineStart.x;
    const dy = lineEnd.y - lineStart.y;
    const mag = Math.sqrt(dx * dx + dy * dy);

    if (mag === 0) {
      return Math.sqrt(
        Math.pow(point.x - lineStart.x, 2) +
        Math.pow(point.y - lineStart.y, 2)
      );
    }

    const u = ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (mag * mag);
    const closestX = lineStart.x + u * dx;
    const closestY = lineStart.y + u * dy;

    return Math.sqrt(
      Math.pow(point.x - closestX, 2) +
      Math.pow(point.y - closestY, 2)
    );
  }
}

// ==================== 笔迹平滑器 ====================
class StrokeSmoother {
  constructor(windowSize = 3) {
    this.windowSize = windowSize;
    this.buffer = [];
  }

  /**
   * 添加点并返回平滑后的点
   */
  addPoint(point) {
    this.buffer.push(point);

    if (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }

    return this.getSmoothedPoint();
  }

  getSmoothedPoint() {
    if (this.buffer.length === 0) return null;
    if (this.buffer.length === 1) return { ...this.buffer[0] };

    const sum = this.buffer.reduce(
      (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y, t: p.t }),
      { x: 0, y: 0, t: 0 }
    );

    return {
      x: sum.x / this.buffer.length,
      y: sum.y / this.buffer.length,
      t: this.buffer[this.buffer.length - 1].t
    };
  }

  reset() {
    this.buffer = [];
  }
}

// ==================== 速度计算器 ====================
class VelocityCalculator {
  constructor() {
    this.lastPoint = null;
    this.lastTime = 0;
  }

  /**
   * 计算两个点之间的速度
   * @param {Object} point 当前点 {x, y, t}
   * @returns {number} 速度（像素/毫秒）
   */
  calculateVelocity(point) {
    if (!this.lastPoint || !this.lastTime) {
      this.lastPoint = point;
      this.lastTime = point.t;
      return 0;
    }

    const dx = point.x - this.lastPoint.x;
    const dy = point.y - this.lastPoint.y;
    const dt = point.t - this.lastTime;

    const distance = Math.sqrt(dx * dx + dy * dy);
    const velocity = dt > 0 ? distance / dt : 0;

    this.lastPoint = point;
    this.lastTime = point.t;

    return velocity;
  }

  /**
   * 根据速度动态调整宽度
   * @param {number} baseWidth 基础宽度
   * @param {number} velocity 当前速度
   * @param {number} minFactor 最小系数
   * @param {number} maxFactor 最大系数
   */
  getVelocityWidth(baseWidth, velocity, minFactor = 0.3, maxFactor = 1.5) {
    const velocityThreshold = 2.0;
    const factor = Math.max(
      minFactor,
      Math.min(maxFactor, 1.5 - velocity / velocityThreshold)
    );
    return Math.round(baseWidth * factor * 10) / 10;
  }

  reset() {
    this.lastPoint = null;
    this.lastTime = 0;
  }
}

// ==================== 性能统计器 ====================
class PerformanceStats {
  constructor() {
    this.reset();
  }

  reset() {
    this.pointsCollected = 0;
    this.pointsSent = 0;
    this.pointsCompressed = 0;
    this.segmentsSent = 0;
    this.bytesSent = 0;
    this.startTime = Date.now();
    this.lastReportTime = Date.now();
  }

  recordPoint() {
    this.pointsCollected++;
  }

  recordSend(originalCount, sentCount, segmentSize) {
    this.pointsSent += sentCount;
    this.pointsCompressed += originalCount - sentCount;
    this.segmentsSent++;
    this.bytesSent += segmentSize;
  }

  /**
   * 获取统计报告
   */
  getReport() {
    const elapsed = Date.now() - this.startTime;
    const interval = Date.now() - this.lastReportTime;

    return {
      elapsed: elapsed,
      interval: interval,
      pointsCollected: this.pointsCollected,
      pointsSent: this.pointsSent,
      pointsCompressed: this.pointsCompressed,
      compressionRatio: this.pointsCollected > 0
        ? ((this.pointsCollected - this.pointsSent) / this.pointsCollected * 100).toFixed(1) + '%'
        : '0%',
      segmentsSent: this.segmentsSent,
      bytesSent: this.bytesSent,
      avgPointsPerSecond: this.pointsCollected / (elapsed / 1000) || 0
    };
  }

  logReport() {
    const report = this.getReport();
    console.log('[Collector] 性能统计:', {
      '采集点数': report.pointsCollected,
      '发送点数': report.pointsSent,
      '压缩率': report.compressionRatio,
      '发送段数': report.segmentsSent,
      '发送字节': report.bytesSent,
      '采集速率': report.avgPointsPerSecond.toFixed(1) + ' 点/秒'
    });
    this.lastReportTime = Date.now();
  }
}

// ==================== 离线缓存 ====================
class OfflineCache {
  constructor(maxSize = 100) {
    this.maxSize = maxSize;
    this.queue = [];
  }

  /**
   * 添加到缓存
   */
  push(segment) {
    if (this.queue.length >= this.maxSize) {
      this.queue.shift();
    }
    this.queue.push({ segment, timestamp: Date.now() });
  }

  /**
   * 获取并清空缓存
   */
  flush() {
    const items = [...this.queue];
    this.queue = [];
    return items;
  }

  isEmpty() {
    return this.queue.length === 0;
  }

  size() {
    return this.queue.length;
  }
}

// ==================== 事件发射器 ====================
class EventEmitter {
  constructor() {
    this.listeners = {};
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error(`[Collector] 事件回调错误 [${event}]:`, error);
      }
    });
  }
}

// ==================== 输入采集器 ====================
class StrokeCollector extends EventEmitter {
  constructor(options = {}) {
    super();

    // 工具配置
    this.currentTool = options.tool || 'pen';
    this.currentColor = options.color || '#ffffff';
    this.currentWidth = options.width || 3;

    // 画布 ID（协议要求）
    this.canvasId = options.canvasId || null;

    // 笔画状态
    this.isDrawing = false;
    this.currentStrokeId = null;
    this.currentPoints = [];

    // 定时器
    this.timerId = null;
    this.flushInterval = options.flushInterval || 50; // ms

    // WebSocket
    this.ws = null;
    this.wsUrl = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = options.maxReconnectAttempts || 5;
    this.reconnectDelay = options.reconnectDelay || 1000;

    // 节流
    this.rafId = null;
    this.lastRafTime = 0;
    this.rafThreshold = options.rafThreshold || 16; // ~60fps

    // DP 压缩
    this.dpEnabled = options.dpEnabled !== false;
    this.dpEpsilon = options.dpEpsilon || 1.0;

    // 笔迹平滑
    this.smoothingEnabled = options.smoothingEnabled !== false;
    this.smoother = new StrokeSmoother(options.smoothWindowSize || 3);

    // 速度检测
    this.velocityEnabled = options.velocityEnabled !== false;
    this.velocityCalculator = new VelocityCalculator();

    // 性能统计
    this.stats = new PerformanceStats();
    this.statsInterval = options.statsInterval || 10000; // 10秒报告一次
    this.statsTimerId = null;

    // 离线缓存
    this.offlineCache = new OfflineCache(options.offlineCacheSize || 100);
    this.offlineMode = false;

    // 工具栏选择器
    this.toolbarSelector = options.toolbarSelector || '#toolbar';

    // 事件处理器引用
    this._handlers = {};
  }

  // ==================== 生命周期 ====================

  /**
   * 开始采集
   */
  start(options = {}) {
    this._applyOptions(options);

    // 启动统计
    this._startStatsTimer();

    // 连接 WebSocket
    if (this.wsUrl) {
      this.connect(this.wsUrl);
    }

    // 启动定时器
    this.timerId = setInterval(() => this.flush(), this.flushInterval);

    // 绑定事件
    this.bindEvents();

    console.log('[Collector] 输入采集器已启动', {
      flushInterval: this.flushInterval + 'ms',
      dpEnabled: this.dpEnabled,
      smoothingEnabled: this.smoothingEnabled,
      velocityEnabled: this.velocityEnabled
    });

    this.emit('start', this.getStatus());
  }

  /**
   * 停止采集
   */
  stop() {
    // 停止定时器
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
    }

    // 停止统计
    if (this.statsTimerId) {
      clearInterval(this.statsTimerId);
      this.statsTimerId = null;
    }
    this.stats.logReport();

    // 取消 RAF
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // 发送剩余点
    if (this.isDrawing && this.currentPoints.length > 0) {
      this.emitSegment();
    }

    // 解绑事件
    this.unbindEvents();

    // 断开连接
    this.disconnect();

    console.log('[Collector] 输入采集器已停止');
    this.emit('stop', {});
  }

  /**
   * 应用配置
   */
  _applyOptions(options) {
    if (options.wsUrl) this.wsUrl = options.wsUrl;
    if (options.canvasId) this.canvasId = options.canvasId;
    if (options.flushInterval) this.flushInterval = options.flushInterval;
    if (options.dpEnabled !== undefined) this.dpEnabled = options.dpEnabled;
    if (options.dpEpsilon !== undefined) this.dpEpsilon = options.dpEpsilon;
    if (options.smoothingEnabled !== undefined) this.smoothingEnabled = options.smoothingEnabled;
    if (options.velocityEnabled !== undefined) this.velocityEnabled = options.velocityEnabled;
  }

  // ==================== 统计 ====================

  _startStatsTimer() {
    this.statsTimerId = setInterval(() => {
      if (this.stats.pointsCollected > 0) {
        this.stats.logReport();
      }
    }, this.statsInterval);
  }

  // ==================== 工具设置 ====================

  /**
   * 设置工具类型
   * @param {string} tool 'pen' | 'eraser' | 'highlighter'
   */
  setTool(tool) {
    const validTools = ['pen', 'eraser', 'highlighter'];
    if (!validTools.includes(tool)) {
      console.warn('[Collector] 无效工具类型:', tool, '有效值:', validTools);
      return false;
    }

    const oldTool = this.currentTool;
    this.currentTool = tool;
    console.log('[Collector] 工具切换:', oldTool, '->', tool);
    this.emit('toolChange', { oldTool, newTool: tool });
    return true;
  }

  /**
   * 设置画布 ID（协议要求）
   * @param {string} canvasId 画布 ID
   */
  setCanvasId(canvasId) {
    if (!canvasId) {
      console.warn('[Collector] canvas_id 不能为空');
      return false;
    }
    const oldId = this.canvasId;
    this.canvasId = canvasId;
    console.log('[Collector] 画布切换:', oldId || '(无)', '->', canvasId);
    this.emit('canvasIdChange', { oldCanvasId: oldId, newCanvasId: canvasId });
    return true;
  }

  /**
   * 设置颜色
   */
  setColor(color) {
    this.currentColor = color;
    console.log('[Collector] 颜色切换:', color);
    this.emit('colorChange', { color });
  }

  /**
   * 设置线条宽度
   */
  setWidth(width) {
    const clampedWidth = Math.max(1, Math.min(50, width));
    this.currentWidth = clampedWidth;
    console.log('[Collector] 宽度切换:', clampedWidth);
    this.emit('widthChange', { width: clampedWidth });
  }

  /**
   * 设置 DP 压缩参数
   */
  setDpEpsilon(epsilon) {
    this.dpEpsilon = Math.max(0, epsilon);
    console.log('[Collector] DP 容差设置:', this.dpEpsilon);
    this.emit('dpEpsilonChange', { epsilon: this.dpEpsilon });
  }

  /**
   * 启用/禁用 DP 压缩
   */
  setDpEnabled(enabled) {
    this.dpEnabled = enabled;
    console.log('[Collector] DP 压缩:', enabled ? '启用' : '禁用');
  }

  // ==================== 事件绑定 ====================

  /**
   * 绑定鼠标和触摸事件
   */
  bindEvents() {
    // 鼠标事件
    this._handlers.mousedown = this.handlePointerDown.bind(this);
    this._handlers.mousemove = this.handlePointerMove.bind(this);
    this._handlers.mouseup = this.handlePointerUp.bind(this);
    this._handlers.mouseleave = this.handlePointerUp.bind(this);

    // 触摸事件
    this._handlers.touchstart = this.handleTouchStart.bind(this);
    this._handlers.touchmove = this.handleTouchMove.bind(this);
    this._handlers.touchend = this.handleTouchEnd.bind(this);
    this._handlers.touchcancel = this.handleTouchEnd.bind(this);

    // 添加事件监听
    document.addEventListener('mousedown', this._handlers.mousedown, { passive: false });
    document.addEventListener('mousemove', this._handlers.mousemove, { passive: false });
    document.addEventListener('mouseup', this._handlers.mouseup);
    document.addEventListener('mouseleave', this._handlers.mouseleave);
    document.addEventListener('touchstart', this._handlers.touchstart, { passive: false });
    document.addEventListener('touchmove', this._handlers.touchmove, { passive: false });
    document.addEventListener('touchend', this._handlers.touchend);
    document.addEventListener('touchcancel', this._handlers.touchcancel);
  }

  /**
   * 解绑事件
   */
  unbindEvents() {
    document.removeEventListener('mousedown', this._handlers.mousedown);
    document.removeEventListener('mousemove', this._handlers.mousemove);
    document.removeEventListener('mouseup', this._handlers.mouseup);
    document.removeEventListener('mouseleave', this._handlers.mouseleave);
    document.removeEventListener('touchstart', this._handlers.touchstart);
    document.removeEventListener('touchmove', this._handlers.touchmove);
    document.removeEventListener('touchend', this._handlers.touchend);
    document.removeEventListener('touchcancel', this._handlers.touchcancel);
  }

  // ==================== 指针事件处理 ====================

  /**
   * 获取事件坐标
   */
  _getEventCoords(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  /**
   * 检查是否点击工具栏
   */
  _isToolbarClick(e) {
    return e.target.closest(this.toolbarSelector);
  }

  /**
   * 指针按下
   */
  handlePointerDown(e) {
    if (this._isToolbarClick(e)) return;
    e.preventDefault();
    this._startStroke(this._getEventCoords(e));
  }

  /**
   * 指针移动
   */
  handlePointerMove(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    this._addPoint(this._getEventCoords(e));
  }

  /**
   * 指针抬起
   */
  handlePointerUp(e) {
    if (!this.isDrawing) return;
    this._endStroke();
  }

  // ==================== 触摸事件处理 ====================

  handleTouchStart(e) {
    if (this._isToolbarClick(e)) return;
    e.preventDefault();
    const coords = this._getEventCoords(e);
    this._startStroke(coords);
  }

  handleTouchMove(e) {
    if (!this.isDrawing) return;
    e.preventDefault();
    this._addPoint(this._getEventCoords(e));
  }

  handleTouchEnd(e) {
    if (!this.isDrawing) return;
    this._endStroke();
  }

  // ==================== 笔画操作 ====================

  /**
   * 开始笔画
   */
  _startStroke(coords) {
    const point = this._createPoint(coords);

    this.isDrawing = true;
    this.currentStrokeId = crypto.randomUUID();
    this.currentPoints = [point];

    // 重置平滑器和速度计算器
    this.smoother.reset();
    this.velocityCalculator.reset();
    if (this.smoothingEnabled) {
      this.smoother.addPoint(point);
    }
    if (this.velocityEnabled) {
      this.velocityCalculator.calculateVelocity(point);
    }

    this.stats.recordPoint();
    console.log('[Collector] 笔画开始:', this.currentStrokeId, point);
    this.emit('strokeStart', { strokeId: this.currentStrokeId, point });
  }

  /**
   * 添加点
   */
  _addPoint(coords) {
    const point = this._createPoint(coords);

    // 速度检测
    let width = this.currentWidth;
    if (this.velocityEnabled) {
      const velocity = this.velocityCalculator.calculateVelocity(point);
      width = this.velocityCalculator.getVelocityWidth(this.currentWidth, velocity);
    }

    // 笔迹平滑
    if (this.smoothingEnabled) {
      const smoothed = this.smoother.addPoint(point);
      this.currentPoints.push(smoothed);
    } else {
      this.currentPoints.push(point);
    }

    this.stats.recordPoint();

    // RAF 节流（仅用于性能监控，不阻塞点采集）
    this._scheduleRaf();
  }

  /**
   * 创建点对象
   */
  _createPoint(coords) {
    return {
      x: coords.x,
      y: coords.y,
      t: Date.now()
    };
  }

  /**
   * 结束笔画
   */
  _endStroke() {
    this.isDrawing = false;

    if (this.currentPoints.length > 0) {
      // 发送最终片段
      this.emitSegment(true);
    }

    console.log('[Collector] 笔画结束:', this.currentStrokeId, {
      points: this.currentPoints.length
    });
    this.emit('strokeEnd', {
      strokeId: this.currentStrokeId,
      points: this.currentPoints.length
    });

    this.currentStrokeId = null;
    this.currentPoints = [];
  }

  // ==================== RAF 节流 ====================

  _scheduleRaf() {
    if (this.rafId) return;

    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.lastRafTime = performance.now();
    });
  }

  // ==================== 发送逻辑 ====================

  /**
   * 定时器触发 - 发送累积的点（仅用于本地预览，不发送到服务器）
   */
  flush() {
    if (!this.isDrawing || this.currentPoints.length === 0) {
      return;
    }

    // 只触发回调用于本地预览，不发送到服务器
    const segment = {
      action: this._getAction(),
      stroke_id: this.currentStrokeId,
      points: this.currentPoints,
      color: this.currentColor,
      width: this.currentWidth,
      timestamp: Date.now(),
      is_preview: true
    };

    // 触发回调（用于本地渲染）
    this.emit('segment', segment);
    // 不调用 _sendSegment，避免发送到服务器
  }

  /**
   * 发送片段
   * @param {boolean} isFinal - 是否是最后一个片段（笔画结束）
   */
  emitSegment(isFinal = false) {
    if (this.currentPoints.length === 0) return;

    // 协议要求：必须携带 canvas_id
    if (!this.canvasId) {
      console.warn('[Collector] canvas_id 未设置，无法发送片段');
      return;
    }

    let pointsToSend = this.currentPoints;
    const originalCount = this.currentPoints.length;

    // DP 压缩（只在最终片段时应用）
    if (this.dpEnabled && this.dpEpsilon > 0 && isFinal && originalCount >= 3) {
      pointsToSend = DouglasPeucker.simplify(this.currentPoints, this.dpEpsilon);
    }

    const segment = {
      action: this._getAction(),
      canvas_id: this.canvasId,  // 协议要求：携带 canvas_id
      stroke_id: this.currentStrokeId,
      points: isFinal ? pointsToSend : this.currentPoints,
      color: this.currentColor,
      width: this.currentWidth,
      timestamp: Date.now(),
      is_final: isFinal
    };

    // 记录统计
    this.stats.recordSend(
      originalCount,
      pointsToSend.length,
      JSON.stringify(segment).length
    );

    // 触发回调（用于本地渲染）
    this.emit('segment', segment);

    // 发送（用于服务器存储）
    this._sendSegment(segment);

    // 最终片段后清空点
    if (isFinal) {
      this.currentPoints = [];
    }
  }

  /**
   * 获取 action 类型
   */
  _getAction() {
    switch (this.currentTool) {
      case 'eraser': return 'erase';
      case 'highlighter': return 'stroke'; // 高亮也是 stroke
      default: return 'stroke';
    }
  }

  /**
   * 发送片段
   */
  _sendSegment(segment) {
    if (this.isConnected()) {
      this.send(segment);
    } else {
      // 离线模式，缓存数据
      this.offlineMode = true;
      this.offlineCache.push(segment);
      console.log('[Collector] 离线模式，数据已缓存', {
        cacheSize: this.offlineCache.size()
      });
    }
  }

  // ==================== WebSocket ====================

  /**
   * 连接 WebSocket
   */
  connect(url) {
    this.wsUrl = url;
    this.maxReconnectAttempts = 0; // 初始连接不重试

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[Collector] WebSocket 已连接:', url);
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.offlineMode = false;
        this.emit('connect', {});

        // 发送离线缓存
        this._flushOfflineCache();
      };

      this.ws.onmessage = (event) => {
        this.emit('message', event.data);
      };

      this.ws.onerror = (error) => {
        console.error('[Collector] WebSocket 错误:', error);
        this.emit('error', error);
      };

      this.ws.onclose = () => {
        console.log('[Collector] WebSocket 已断开');
        this.emit('disconnect', {});
        this._attemptReconnect();
      };
    } catch (error) {
      console.error('[Collector] WebSocket 连接失败:', error);
      this.emit('error', error);
    }
  }

  /**
   * 断开连接
   */
  disconnect() {
    this.maxReconnectAttempts = 0;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * 重连
   */
  _attemptReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[Collector] 重连次数已达上限');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * this.reconnectAttempts;

    console.log(`[Collector] ${delay}ms 后尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      if (this.wsUrl) {
        this.connect(this.wsUrl);
      }
    }, delay);
  }

  /**
   * 发送数据
   */
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
      return true;
    }
    return false;
  }

  /**
   * 检查连接状态
   */
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * 发送离线缓存
   */
  _flushOfflineCache() {
    if (this.offlineCache.isEmpty()) return;

    const items = this.offlineCache.flush();
    console.log('[Collector] 发送离线缓存:', items.length, '条');

    items.forEach(item => {
      this.send(item.segment);
    });
  }

  // ==================== 状态查询 ====================

  /**
   * 获取状态
   */
  getStatus() {
    return {
      isDrawing: this.isDrawing,
      strokeId: this.currentStrokeId,
      pointsCount: this.currentPoints.length,
      canvasId: this.canvasId,
      tool: this.currentTool,
      color: this.currentColor,
      width: this.currentWidth,
      wsConnected: this.isConnected(),
      offlineMode: this.offlineMode,
      offlineCacheSize: this.offlineCache.size(),
      dpEnabled: this.dpEnabled,
      dpEpsilon: this.dpEpsilon,
      smoothingEnabled: this.smoothingEnabled,
      velocityEnabled: this.velocityEnabled,
      stats: this.stats.getReport()
    };
  }

  /**
   * 导出配置
   */
  exportConfig() {
    return {
      tool: this.currentTool,
      color: this.currentColor,
      width: this.currentWidth,
      dpEpsilon: this.dpEpsilon
    };
  }

  /**
   * 导入配置
   */
  importConfig(config) {
    if (config.tool) this.setTool(config.tool);
    if (config.color) this.setColor(config.color);
    if (config.width) this.setWidth(config.width);
    if (config.dpEpsilon !== undefined) this.setDpEpsilon(config.dpEpsilon);
  }
}

// ==================== 全局实例 ====================
const collector = new StrokeCollector();

// ==================== 导出 ====================
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    StrokeCollector,
    DouglasPeucker,
    StrokeSmoother,
    VelocityCalculator,
    PerformanceStats,
    OfflineCache,
    collector
  };
}

// ==================== 控制台帮助 ====================
console.log(`
╔════════════════════════════════════════════════════════════╗
║              SyncCanvas Collector v2.1                      ║
╠════════════════════════════════════════════════════════════╣
║  启动: collector.start({                                   ║
║    wsUrl: 'ws://localhost:3000',                          ║
║    canvasId: 'canvas-001'                                  ║
║  })                                                        ║
║  停止: collector.stop()                                    ║
╠════════════════════════════════════════════════════════════╣
║  工具设置:                                                 ║
║    collector.setTool('pen'|'eraser'|'highlighter')        ║
║    collector.setColor('#ffffff')                          ║
║    collector.setWidth(3)                                  ║
║    collector.setCanvasId('canvas-001')  // 设置画布       ║
╠════════════════════════════════════════════════════════════╣
║  压缩设置:                                                 ║
║    collector.setDpEpsilon(1.0)  // DP 容差                 ║
║    collector.setDpEnabled(true)  // 启用/禁用压缩          ║
╠════════════════════════════════════════════════════════════╣
║  状态查询:                                                 ║
║    collector.getStatus()   // 完整状态                     ║
║    collector.isConnected() // 连接状态                    ║
║    collector.exportConfig() // 导出配置                    ║
║    collector.importConfig({}) // 导入配置                  ║
╠════════════════════════════════════════════════════════════╣
║  事件监听:                                                 ║
║    collector.on('segment', (seg) => {})                    ║
║    collector.on('canvasIdChange', ({old, new}) => {})      ║
║    collector.on('connect', () => {})                       ║
║    collector.on('disconnect', () => {})                    ║
╚════════════════════════════════════════════════════════════╝
`);
