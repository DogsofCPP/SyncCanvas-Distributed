/**
 * 这是一个画布应用的主函数，使用IIFE（立即调用函数表达式）封装，避免全局变量污染
 */
(function () {

  // 获取DOM元素
  const canvas = document.getElementById('canvas'); // 画布元素
  const ctx = canvas.getContext('2d'); // 画布2D上下文
  const penBtn = document.getElementById('penBtn'); // 画笔按钮
  const eraserBtn = document.getElementById('eraserBtn'); // 橡皮擦按钮
  const colorPicker = document.getElementById('colorPicker'); // 颜色选择器
  const strokeWidth = document.getElementById('strokeWidth'); // 笔画宽度滑块
  const widthValue = document.getElementById('widthValue'); // 宽度显示值
  const undoBtn = document.getElementById('undoBtn'); // 撤销按钮
  const redoBtn = document.getElementById('redoBtn'); // 重做按钮
  const clearBtn = document.getElementById('clearBtn'); // 清空按钮
  const wsStatus = document.getElementById('wsStatus'); // WebSocket状态显示
  const userIdEl = document.getElementById('userId'); // 用户ID显示
  const onlineCountEl = document.getElementById('onlineCount'); // 在线人数显示
  const sequenceIdEl = document.getElementById('sequenceId'); // 序列ID显示



  // 常量定义
  const backgroundColor = '#ffffff'; // 背景色
  const wsUrl = 'ws://localhost:3000/ws'; // WebSocket连接URL


  // 操作历史和状态管理
  const operations = []; // 存储所有操作记录
  const undoneKeys = new Set(); // 存储已撤销操作的键（已废弃，改用 undoneStrokes）
  const undoneStrokes = new Set(); // 存储已撤销的 stroke_id
  const strokeRenderState = new Map(); // 存储笔画渲染状态



  // 变量声明
  let currentUserId = null; // 当前用户ID
  let latestSequenceId = 0; // 最新序列ID
  let localSequenceId = Date.now(); // 本地序列ID
  let isDrawing = false; // 是否正在绘制的标志
  let lastPoint = null; // 上一个点的坐标

  /**
   * 调整画布大小以适应窗口
   */
  function resizeCanvas() {
    canvas.width = window.innerWidth; // 设置画布宽度为窗口宽度
    canvas.height = window.innerHeight; // 设置画布高度为窗口高度
    redrawCanvas(); // 重绘画布内容
  }

  /**
   * 清空画布
   */
  function clearCanvas() {
    ctx.setTransform(1, 0, 0, 1, 0, 0); // 重置变换矩阵
    ctx.fillStyle = backgroundColor; // 设置填充色为背景色
    ctx.fillRect(0, 0, canvas.width, canvas.height); // 填充整个画布
  }

  /**
   * 获取鼠标在画布上的坐标
   * @param {Object} event - 鼠标事件对象
   * @returns {Object} 包含x和y坐标的对象
   */
  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect(); // 获取画布的位置信息
    return {
      x: event.clientX - rect.left, // 计算相对于画布的x坐标
      y: event.clientY - rect.top  // 计算相对于画布的y坐标
    };
  }

  /**
   * 获取当前激活的工具
   * @returns {string} 当前工具名称
   */
  function getActiveTool() {
    return collector.getStatus().tool; // 从collector获取当前工具状态
  }

  function getDrawStyle(action, color, width) {
    if (action === 'erase') {
      return {
        color: backgroundColor,
        width: Math.max(Number(width) || 1, 1) * 3
      };
    }

    return {
      color: color || '#000000',
      width: Math.max(Number(width) || 1, 1)
    };
  }

  function drawLine(fromPoint, toPoint) {
    const action = getActiveTool() === 'eraser' ? 'erase' : 'stroke';
    const style = getDrawStyle(action, colorPicker.value, strokeWidth.value);

    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(fromPoint.x, fromPoint.y);
    ctx.lineTo(toPoint.x, toPoint.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawDot(point) {
    const action = getActiveTool() === 'eraser' ? 'erase' : 'stroke';
    const style = getDrawStyle(action, colorPicker.value, strokeWidth.value);

    ctx.save();
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(style.width / 2, 1), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawSmoothPoints(points, color, width) {
    if (points.length === 0) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (points.length === 1) {
      const point = points[0];
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(width / 2, 1), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const midX = (current.x + next.x) / 2;
      const midY = (current.y + next.y) / 2;
      ctx.quadraticCurveTo(current.x, current.y, midX, midY);
    }

    const last = points[points.length - 1];
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.restore();
  }

  function normalizeOperation(message, options = {}) {
    const points = Array.isArray(message.points)
      ? message.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];
    const action = message.action || message.msg_type || 'stroke';

    return {
      action: action === 'erase' ? 'erase' : 'stroke',
      stroke_id: message.stroke_id || crypto.randomUUID(),
      points,
      color: message.color || '#000000',
      width: Number(message.width) || 3,
      user_id: message.user_id || currentUserId || 'local',
      timestamp: Number(message.timestamp) || Date.now(),
      sequence_id: Number.isFinite(message.sequence_id) ? message.sequence_id : null,
      local_sequence_id: options.localSequenceId || null,
      local_key: options.localKey || null,
      optimistic: Boolean(options.optimistic)
    };
  }

  function getOperationKey(operation) {
    if (Number.isFinite(operation.sequence_id)) {
      return `seq:${operation.sequence_id}`;
    }

    return `local:${operation.local_sequence_id}`;
  }

  function getOperationOrder(operation) {
    if (Number.isFinite(operation.sequence_id)) {
      return operation.sequence_id;
    }

    return operation.local_sequence_id;
  }

  function compareOperations(a, b) {
    return getOperationOrder(a) - getOperationOrder(b);
  }

  function addOperation(operation) {
    if (operation.points.length === 0) return;

    if (Number.isFinite(operation.sequence_id)) {
      latestSequenceId = Math.max(latestSequenceId, operation.sequence_id);
    }

    const duplicateIndex = operations.findIndex((item) => {
      if (operation.local_key && item.local_key === operation.local_key) return true;
      return getOperationKey(item) === getOperationKey(operation);
    });

    if (duplicateIndex >= 0) {
      operations[duplicateIndex] = operation;
    } else {
      operations.push(operation);
    }

    operations.sort(compareOperations);
    updateSequenceStatus();
    updateUndoRedoButtons();
  }

  function drawOperation(operation, stateMap) {
    const style = getDrawStyle(operation.action, operation.color, operation.width);
    const history = stateMap.get(operation.stroke_id) || [];
    const points = history.concat(operation.points);

    drawSmoothPoints(points, style.color, style.width);
    stateMap.set(operation.stroke_id, points.slice(-2));
  }

  function redrawCanvas() {
    clearCanvas();
    strokeRenderState.clear();
    operations
      .filter((operation) => {
        if (undoneStrokes.has(operation.stroke_id)) return false;
        if (undoneKeys.has(getOperationKey(operation))) return false;
        return true;
      })
      .sort(compareOperations)
      .forEach((operation) => drawOperation(operation, strokeRenderState));
  }

  function handleLocalSegment(segment) {
    localSequenceId = Math.max(localSequenceId + 1, latestSequenceId + 1, Date.now());
    const localKey = `${segment.stroke_id}:${segment.timestamp}:${localSequenceId}`;
    const operation = normalizeOperation(segment, {
      localSequenceId,
      localKey,
      optimistic: true
    });

    addOperation(operation);
  }

  function handleRemoteOperation(message) {
    const operation = normalizeOperation(message);

    if (operation.user_id === currentUserId) {
      const pending = operations.find((item) => (
        item.optimistic &&
        item.stroke_id === operation.stroke_id &&
        item.points.length === operation.points.length
      ));

      if (pending) {
        operation.local_key = pending.local_key;
      }
    }

    addOperation(operation);
    redrawCanvas();
  }

  function handleCollectorMessage(rawData) {
    let message;

    try {
      message = JSON.parse(rawData);
    } catch (error) {
      console.warn('[SyncCanvas] 无法解析 WebSocket 消息', error);
      return;
    }

    if (message.type === 'welcome') {
      currentUserId = message.user_id || currentUserId;
      userIdEl.textContent = currentUserId || '-';
      return;
    }

    if (Number.isFinite(message.online_count)) {
      onlineCountEl.textContent = String(message.online_count);
    }

    if (message.type === 'broadcast' || message.points || message.msg_type || message.action) {
      handleRemoteOperation(message);
    }
  }

  function setActiveTool(tool) {
    collector.setTool(tool);
    penBtn.classList.toggle('active', tool === 'pen');
    eraserBtn.classList.toggle('active', tool === 'eraser');
    canvas.style.cursor = tool === 'eraser' ? 'cell' : 'crosshair';
  }

  function updateSequenceStatus() {
    sequenceIdEl.textContent = String(latestSequenceId);
  }

  function updateUndoRedoButtons() {
    const hasVisibleOperation = operations.some((operation) => !undoneKeys.has(getOperationKey(operation)));
    undoBtn.disabled = !hasVisibleOperation;
    redoBtn.disabled = undoneKeys.size === 0;
  }

  function undoLastOperation() {
    // 找到最后一个可见笔画的 stroke_id
    const visibleStrokes = new Set();
    const visibleOperations = operations
      .filter((operation) => {
        if (undoneStrokes.has(operation.stroke_id)) return false;
        if (undoneKeys.has(getOperationKey(operation))) return false;
        return true;
      })
      .sort(compareOperations);

    if (visibleOperations.length === 0) return;

    // 获取最后一个操作的 stroke_id
    const lastOperation = visibleOperations[visibleOperations.length - 1];
    const lastStrokeId = lastOperation.stroke_id;

    // 撤销整个笔画（所有相同 stroke_id 的操作）
    undoneStrokes.add(lastStrokeId);
    redrawCanvas();
    updateUndoRedoButtons();
  }

  function redoLastOperation() {
    // 找到最后一个被撤销的笔画
    const undoneOperations = operations
      .filter((operation) => undoneKeys.has(getOperationKey(operation)) || undoneStrokes.has(operation.stroke_id))
      .sort(compareOperations);

    if (undoneOperations.length === 0) return;

    // 获取最后一个被撤销操作的 stroke_id
    const lastOperation = undoneOperations[undoneOperations.length - 1];
    const lastStrokeId = lastOperation.stroke_id;

    // 恢复整个笔画
    undoneStrokes.delete(lastStrokeId);
    redrawCanvas();
    updateUndoRedoButtons();
  }

  penBtn.addEventListener('click', () => setActiveTool('pen'));
  eraserBtn.addEventListener('click', () => setActiveTool('eraser'));

  colorPicker.addEventListener('input', (event) => {
    collector.setColor(event.target.value);
  });

  strokeWidth.addEventListener('input', (event) => {
    const width = Number(event.target.value);
    widthValue.textContent = String(width);
    collector.setWidth(width);
  });

  undoBtn.addEventListener('click', undoLastOperation);
  redoBtn.addEventListener('click', redoLastOperation);

  clearBtn.addEventListener('click', () => {
    operations.length = 0;
    undoneKeys.clear();
    undoneStrokes.clear();
    latestSequenceId = 0;
    redrawCanvas();
    updateSequenceStatus();
    updateUndoRedoButtons();
  });

  canvas.addEventListener('mousedown', (event) => {
    isDrawing = true;
    lastPoint = getCanvasPoint(event);
    drawDot(lastPoint);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!isDrawing || !lastPoint) return;

    const point = getCanvasPoint(event);
    drawLine(lastPoint, point);
    lastPoint = point;
  });

  canvas.addEventListener('mouseup', () => {
    isDrawing = false;
    lastPoint = null;
  });

  canvas.addEventListener('mouseleave', () => {
    isDrawing = false;
    lastPoint = null;
  });

  collector.on('segment', handleLocalSegment);
  collector.on('message', handleCollectorMessage);
  collector.on('connect', () => {
    wsStatus.textContent = '已连接';
    wsStatus.className = 'connected';
  });
  collector.on('disconnect', () => {
    wsStatus.textContent = '未连接';
    wsStatus.className = 'disconnected';
  });
  collector.on('error', () => {
    wsStatus.textContent = '连接错误';
    wsStatus.className = 'disconnected';
  });

  window.addEventListener('resize', resizeCanvas);

  resizeCanvas();
  setActiveTool('pen');
  collector.setColor(colorPicker.value);
  collector.setWidth(Number(strokeWidth.value));
  updateSequenceStatus();
  updateUndoRedoButtons();
  collector.start({ wsUrl });
}());
