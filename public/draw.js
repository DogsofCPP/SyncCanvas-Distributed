(function () {
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const penBtn = document.getElementById('penBtn');
  const eraserBtn = document.getElementById('eraserBtn');
  const rectBtn = document.getElementById('rectBtn');
  const ellipseBtn = document.getElementById('ellipseBtn');
  const lineBtn = document.getElementById('lineBtn');
  const textBtn = document.getElementById('textBtn');
  const colorPicker = document.getElementById('colorPicker');
  const colorSwatches = Array.from(document.querySelectorAll('.color-swatch'));
  const strokeWidth = document.getElementById('strokeWidth');
  const widthValue = document.getElementById('widthValue');
  const undoBtn = document.getElementById('undoBtn');
  const clearBtn = document.getElementById('clearBtn');
  const wsStatus = document.getElementById('wsStatus');
  const replayStatus = document.getElementById('replayStatus');
  const userIdEl = document.getElementById('userId');
  const onlineCountEl = document.getElementById('onlineCount');
  const sideOnlineCount = document.getElementById('sideOnlineCount');
  const onlineUserItems = document.getElementById('onlineUserItems');
  const sequenceIdEl = document.getElementById('sequenceId');
  const currentCanvasLabel = document.getElementById('currentCanvasLabel');
  const cursorLayer = document.getElementById('cursorLayer');

  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname) ||
    window.location.hostname.startsWith('192.168.') ||
    window.location.hostname.startsWith('10.') ||
    window.location.hostname.startsWith('198.18.');
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const apiBaseUrl = isLocalhost ? 'http://localhost:3000/api/v1' : `${window.location.origin}/api/v1`;
  const wsBaseUrl = isLocalhost ? 'ws://localhost:3000/ws' : `${wsProtocol}//${window.location.host}/ws`;
  const backgroundColor = '#ffffff';
  const operations = [];
  const remoteCursors = new Map();
  const onlineUsers = new Map();
  const offscreenCanvas = document.createElement('canvas');
  const offscreenCtx = offscreenCanvas.getContext('2d');

  let currentUserId = null;
  let currentCanvasId = null;
  let currentCanvasName = '';
  let latestSequenceId = 0;
  let localSequenceId = Date.now();
  let isDrawing = false;
  let lastPoint = null;
  let activeTool = 'pen';
  let elementStartPoint = null;
  let collectorStarted = false;
  let presentQueued = false;
  let replayRequestId = 0;
  let lastCursorSentAt = 0;
  let baseSnapshotImage = null;
  let presenceTimerId = null;
  let onlinePruneTimerId = null;
  let activeConnectionToken = 0;
  let highlightUserId = null;
  let previewElement = null;
  let textEditor = null;

  function buildWsUrl(canvasId) {
    const token = getAuthToken();
    if (!token) {
      throw new Error('未登录：缺少 token，无法建立 WebSocket 连接');
    }
    return `${wsBaseUrl}?canvas_id=${encodeURIComponent(canvasId)}&token=${encodeURIComponent(token)}`;
  }

  function getAuthToken() {
    return window.SyncCanvasApp?.getToken?.() || localStorage.getItem('synccanvas.token');
  }

  function getCurrentUserName() {
    return window.SyncCanvasApp?.getCurrentUser?.()?.username || currentUserId || '我';
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(Math.floor(rect.width), 1);
    const height = Math.max(Math.floor(rect.height), 1);
    canvas.width = width;
    canvas.height = height;
    offscreenCanvas.width = width;
    offscreenCanvas.height = height;
    redrawCanvas();
  }

  function clearRenderTarget(targetCtx) {
    targetCtx.setTransform(1, 0, 0, 1, 0, 0);
    targetCtx.fillStyle = backgroundColor;
    targetCtx.fillRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
  }

  function schedulePresent() {
    if (presentQueued) return;
    presentQueued = true;
    requestAnimationFrame(() => {
      presentQueued = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(offscreenCanvas, 0, 0);
      if (previewElement) {
        drawElementOn(ctx, previewElement, { isPreview: true });
      }
    });
  }

  function resetCanvasState() {
    operations.length = 0;
    baseSnapshotImage = null;
    latestSequenceId = 0;
    localSequenceId = Date.now();
    isDrawing = false;
    lastPoint = null;
    onlineCountEl.textContent = '0';
    userIdEl.textContent = currentUserId || '-';
    clearRemoteCursors();
    clearOnlineUsers();
    updateSequenceStatus();
    updateUndoButton();
    clearRenderTarget(offscreenCtx);
    schedulePresent();
  }

  function getCanvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  function removeTextEditor() {
    if (!textEditor) return;
    textEditor.remove();
    textEditor = null;
  }

  function commitTextEditor() {
    if (!textEditor || !currentCanvasId) return;

    const text = textEditor.value;
    const x = Number(textEditor.dataset.canvasX);
    const y = Number(textEditor.dataset.canvasY);

    removeTextEditor();

    if (!text || !text.trim()) return;

    const element = {
      action: 'element_add',
      canvas_id: currentCanvasId,
      element_id: crypto.randomUUID(),
      kind: 'text',
      data: {
        x,
        y,
        text: text.trim(),
        font_size: 20,
        font_family: 'Arial',
        align: 'left'
      },
      style: buildElementStyle(),
      timestamp: Date.now()
    };

    collector.send(element);
  }

  function spawnTextEditor(atPoint) {
    if (!currentCanvasId) return;

    removeTextEditor();

    const rect = canvas.getBoundingClientRect();
    const editor = document.createElement('textarea');
    editor.className = 'canvas-text-editor';
    editor.rows = 1;
    editor.placeholder = '输入文字，Enter 确认';
    editor.style.left = `${rect.left + atPoint.x}px`;
    editor.style.top = `${rect.top + atPoint.y}px`;
    editor.style.color = colorPicker.value;

    editor.dataset.canvasX = String(atPoint.x);
    editor.dataset.canvasY = String(atPoint.y);

    document.body.appendChild(editor);
    editor.focus();

    editor.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        commitTextEditor();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        removeTextEditor();
      }
    });

    editor.addEventListener('blur', () => {
      commitTextEditor();
    });

    textEditor = editor;
  }

  function viewportPointToCanvasPoint(point) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / Math.max(rect.width, 1);
    const scaleY = canvas.height / Math.max(rect.height, 1);

    return {
      ...point,
      x: (point.x - rect.left) * scaleX,
      y: (point.y - rect.top) * scaleY
    };
  }

  function normalizeLocalSegmentPoints(segment) {
    if (!Array.isArray(segment.points)) return segment;

    return {
      ...segment,
      points: segment.points
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
        .map(viewportPointToCanvasPoint)
    };
  }

  function getActiveTool() {
    return collector.getStatus().tool;
  }

  function isShapeTool(tool) {
    return tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'text';
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

  function drawLineOn(targetCtx, fromPoint, toPoint, action, color, width) {
    const style = getDrawStyle(action, color, width);
    targetCtx.save();
    targetCtx.strokeStyle = style.color;
    targetCtx.lineWidth = style.width;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';
    targetCtx.beginPath();
    targetCtx.moveTo(fromPoint.x, fromPoint.y);
    targetCtx.lineTo(toPoint.x, toPoint.y);
    targetCtx.stroke();
    targetCtx.restore();
  }

  function normalizeRect(x1, y1, x2, y2) {
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    return { left, top, width, height };
  }

  function buildElementStyle() {
    const stroke = colorPicker.value;
    const width = Math.max(Number(strokeWidth.value) || 1, 1);
    return {
      stroke,
      fill: 'transparent',
      stroke_width: width,
      opacity: 1
    };
  }

  function drawElementOn(targetCtx, element, options = {}) {
    if (!element || !element.kind) return;

    const style = element.style || {};
    const stroke = style.stroke || element.color || '#111827';
    const fill = style.fill || 'transparent';
    const width = Math.max(Number(style.stroke_width ?? element.width ?? 3) || 1, 1);
    const opacity = Math.max(0, Math.min(1, Number(style.opacity ?? 1) || 1));

    targetCtx.save();
    targetCtx.globalAlpha = (options.isPreview ? 0.65 : 1) * opacity;
    targetCtx.lineWidth = width;
    targetCtx.strokeStyle = stroke;
    targetCtx.fillStyle = fill;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';

    if (element.kind === 'rect') {
      const { x1, y1, x2, y2 } = element.data || {};
      const rect = normalizeRect(x1, y1, x2, y2);
      if (fill && fill !== 'transparent') targetCtx.fillRect(rect.left, rect.top, rect.width, rect.height);
      targetCtx.strokeRect(rect.left, rect.top, rect.width, rect.height);
    } else if (element.kind === 'ellipse') {
      const { x1, y1, x2, y2 } = element.data || {};
      const rect = normalizeRect(x1, y1, x2, y2);
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const rx = rect.width / 2;
      const ry = rect.height / 2;
      targetCtx.beginPath();
      targetCtx.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2);
      if (fill && fill !== 'transparent') targetCtx.fill();
      targetCtx.stroke();
    } else if (element.kind === 'line') {
      const { x1, y1, x2, y2 } = element.data || {};
      targetCtx.beginPath();
      targetCtx.moveTo(x1, y1);
      targetCtx.lineTo(x2, y2);
      targetCtx.stroke();
    } else if (element.kind === 'text') {
      const { x, y, text, font_size, font_family, align } = element.data || {};
      const fontSize = Math.max(Number(font_size) || 20, 8);
      const fontFamily = font_family || 'Arial';
      targetCtx.font = `${fontSize}px ${fontFamily}`;
      targetCtx.textBaseline = 'top';
      targetCtx.textAlign = align || 'left';
      targetCtx.fillStyle = stroke;
      targetCtx.fillText(String(text || ''), x, y);
    }

    targetCtx.restore();
  }

  function drawDotOn(targetCtx, point, action, color, width) {
    const style = getDrawStyle(action, color, width);
    targetCtx.save();
    targetCtx.fillStyle = style.color;
    targetCtx.beginPath();
    targetCtx.arc(point.x, point.y, Math.max(style.width / 2, 1), 0, Math.PI * 2);
    targetCtx.fill();
    targetCtx.restore();
  }

  function drawSmoothPoints(targetCtx, points, color, width) {
    if (points.length === 0) return;

    targetCtx.save();
    targetCtx.strokeStyle = color;
    targetCtx.fillStyle = color;
    targetCtx.lineWidth = width;
    targetCtx.lineCap = 'round';
    targetCtx.lineJoin = 'round';

    if (points.length === 1) {
      const point = points[0];
      targetCtx.beginPath();
      targetCtx.arc(point.x, point.y, Math.max(width / 2, 1), 0, Math.PI * 2);
      targetCtx.fill();
      targetCtx.restore();
      return;
    }

    targetCtx.beginPath();
    targetCtx.moveTo(points[0].x, points[0].y);

    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      targetCtx.quadraticCurveTo(current.x, current.y, (current.x + next.x) / 2, (current.y + next.y) / 2);
    }

    const last = points[points.length - 1];
    targetCtx.lineTo(last.x, last.y);
    targetCtx.stroke();
    targetCtx.restore();
  }

  function normalizeOperation(message, options = {}) {
    const action = message.action || message.msg_type || 'stroke';

    if (action === 'element_add') {
      const data = message.data || {};
      const style = message.style || {};

      return {
        action: 'element_add',
        canvas_id: message.canvas_id || currentCanvasId,
        stroke_id: message.stroke_id || message.element_id || crypto.randomUUID(),
        element_id: message.element_id || message.stroke_id || null,
        kind: message.kind,
        data,
        style,
        points: Array.isArray(message.points)
          ? message.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
          : [],
        color: message.color || style.stroke || '#111827',
        width: Number(message.width ?? style.stroke_width) || 3,
        user_id: message.user_id || currentUserId || 'local',
        timestamp: Number(message.timestamp) || Date.now(),
        sequence_id: Number.isFinite(message.sequence_id) ? message.sequence_id : null,
        local_sequence_id: options.localSequenceId || null,
        local_key: options.localKey || null,
        optimistic: Boolean(options.optimistic)
      };
    }

    const points = Array.isArray(message.points)
      ? message.points.filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [];

    return {
      action: action === 'erase' ? 'erase' : 'stroke',
      canvas_id: message.canvas_id || currentCanvasId,
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

  function getMessageKind(message) {
    return message.type || message.action || message.msg_type;
  }

  function isDrawableMessage(message) {
    const kind = getMessageKind(message);
    return kind !== 'cursor' && kind !== 'presence' && kind !== 'leave' && kind !== 'clear' && kind !== 'undo' && kind !== 'noop';
  }

  function getOperationKey(operation) {
    if (Number.isFinite(operation.sequence_id)) {
      return `seq:${operation.sequence_id}`;
    }
    if (operation.local_sequence_id) {
      return `local:${operation.local_sequence_id}`;
    }
    return `id:${operation.element_id || operation.stroke_id}`;
  }

  function getOperationOrder(operation) {
    return Number.isFinite(operation.sequence_id)
      ? operation.sequence_id
      : operation.local_sequence_id;
  }

  function compareOperations(a, b) {
    return getOperationOrder(a) - getOperationOrder(b);
  }

  function addOperation(operation) {
    if (operation.action !== 'element_add' && operation.points.length === 0) return;

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
    updateUndoButton();
  }

  function drawOperation(operation) {
    const shouldDim = highlightUserId && operation.user_id !== highlightUserId;

    offscreenCtx.save();
    if (shouldDim) {
      offscreenCtx.globalAlpha = 0.18;
    } else if (highlightUserId && operation.user_id === highlightUserId) {
      offscreenCtx.globalAlpha = 1;
    }

    if (operation.action === 'element_add') {
      drawElementOn(offscreenCtx, {
        kind: operation.kind,
        data: operation.data,
        style: operation.style,
        color: operation.color,
        width: operation.width
      });
      offscreenCtx.restore();
      return;
    }

    const style = getDrawStyle(operation.action, operation.color, operation.width);
    drawSmoothPoints(offscreenCtx, operation.points, style.color, style.width);

    if (highlightUserId && operation.user_id === highlightUserId) {
      // 给高亮用户增加一层“光晕”描边，避免仅靠透明度不够明显
      drawSmoothPoints(offscreenCtx, operation.points, '#f59e0b', style.width + 3);
    }

    offscreenCtx.restore();
  }

  function redrawCanvas() {
    clearRenderTarget(offscreenCtx);
    if (baseSnapshotImage) {
      offscreenCtx.drawImage(baseSnapshotImage, 0, 0, offscreenCanvas.width, offscreenCanvas.height);
    }
    operations
      .sort(compareOperations)
      .forEach(drawOperation);
    schedulePresent();
  }

  function loadSnapshotImage(svgData) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);

      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('快照加载失败'));
      };
      image.src = url;
    });
  }

  async function replayOperations(rawOperations, source) {
    const snapshot = rawOperations.find((item) => item && item._snapshot && item.svg_data);
    if (snapshot) {
      try {
        baseSnapshotImage = await loadSnapshotImage(snapshot.svg_data);
        latestSequenceId = Math.max(latestSequenceId, Number(snapshot.sequence_id) || 0);
      } catch (error) {
        console.warn('[SyncCanvas] 快照重放失败，将继续重放增量操作:', error.message);
      }
    }

    const normalized = rawOperations
      .filter((item) => item && !item._snapshot && isDrawableMessage(item))
      .map((item) => normalizeOperation(item))
      .filter((operation) => {
        // 保留 element_add（矩形、椭圆等），它们的坐标在 data 字段中
        if (operation.action === 'element_add') return true;
        // 普通笔画必须有 points
        return operation.points.length > 0;
      })
      .sort(compareOperations);

    normalized.forEach(addOperation);
    redrawCanvas();
    replayStatus.textContent = `${source}: ${normalized.length} 条`;
  }

  function extractOperations(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload.operations)) return payload.operations;
    if (payload.data) {
      if (Array.isArray(payload.data)) return payload.data;
      if (Array.isArray(payload.data.operations)) return payload.data.operations;
    }
    return [];
  }

  async function replayHistoryFromApi(canvasId, requestId) {
    replayStatus.textContent = '加载中';
    const headers = {};
    const token = getAuthToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const response = await fetch(`${apiBaseUrl}/canvases/${encodeURIComponent(canvasId)}/operations`, { headers });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      if (requestId !== replayRequestId) return;

      const history = extractOperations(payload);
      operations.length = 0;
      baseSnapshotImage = null;
      latestSequenceId = 0;
      await replayOperations(history, 'REST');
    } catch (error) {
      if (requestId === replayRequestId) {
        replayStatus.textContent = '等待 WebSocket 同步';
        console.warn('[SyncCanvas] REST Replay 失败，等待 WebSocket sync_response 兜底:', error.message);
      }
    }
  }

  function handleLocalSegment(segment) {
    const localSegment = normalizeLocalSegmentPoints(segment);
    segment.points = localSegment.points;
    segment.canvas_id = currentCanvasId;
    localSegment.canvas_id = currentCanvasId;

    if (localSegment.is_preview) {
      return;
    }

    localSequenceId = Math.max(localSequenceId + 1, latestSequenceId + 1, Date.now());
    const localKey = `${localSegment.stroke_id}:${localSegment.timestamp}:${localSequenceId}`;
    const operation = normalizeOperation(localSegment, {
      localSequenceId,
      localKey,
      optimistic: true
    });

    addOperation(operation);
    redrawCanvas();
    window.SyncCanvasApp?.markCanvasModified?.(currentCanvasId, operation.timestamp, latestSequenceId);
  }

  function handleRemoteOperation(message) {
    if (message.canvas_id && currentCanvasId && message.canvas_id !== currentCanvasId) {
      return;
    }

    if (!isDrawableMessage(message)) {
      return;
    }

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
    window.SyncCanvasApp?.markCanvasModified?.(currentCanvasId, operation.timestamp, latestSequenceId);
  }

  function userColor(id) {
    const palette = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#0891b2', '#ea580c'];
    let hash = 0;
    String(id).split('').forEach((char) => {
      hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    });
    return palette[hash % palette.length];
  }

  function upsertOnlineUser(message) {
    const userId = message.user_id || message.client_id || message.stroke_id;
    if (!userId || userId === currentUserId) return;
    if (message.canvas_id && message.canvas_id !== currentCanvasId) return;

    const username = message.username || message.user_name || userId;
    onlineUsers.set(userId, {
      userId,
      username,
      color: message.color || userColor(userId),
      lastSeenAt: Date.now()
    });
    renderOnlineUsers();
  }

  function removeOnlineUser(message) {
    const userId = message.user_id || message.client_id;
    if (!userId || userId === currentUserId) return;
    onlineUsers.delete(userId);
    renderOnlineUsers();
  }

  function renderOnlineUsers() {
    const users = Array.from(onlineUsers.values())
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt);

    sideOnlineCount.textContent = String(users.length);
    onlineUserItems.innerHTML = '';

    if (users.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sidebar-empty';
      empty.textContent = '暂无其他在线用户';
      onlineUserItems.appendChild(empty);
      return;
    }

    users.forEach((user) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'online-user-card';
      item.dataset.userId = user.userId;
      item.classList.toggle('active', highlightUserId === user.userId);
      item.style.setProperty('--user-color', user.color);
      item.innerHTML = `
        <span class="user-avatar"></span>
        <span>
          <strong></strong>
          <span></span>
        </span>
      `;
      item.querySelector('.user-avatar').textContent = user.username.slice(0, 1).toUpperCase();
      item.querySelector('strong').textContent = user.username;
      item.querySelector('span span').textContent = `最近活跃 ${formatRelativeTime(user.lastSeenAt)}`;

      item.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (!currentCanvasId) return;

        highlightUserId = highlightUserId === user.userId ? null : user.userId;
        renderOnlineUsers();
        redrawCanvas();
      });

      onlineUserItems.appendChild(item);
    });
  }

  function formatRelativeTime(timestamp) {
    const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
    if (seconds < 3) return '刚刚';
    if (seconds < 60) return `${seconds} 秒前`;
    return `${Math.round(seconds / 60)} 分钟前`;
  }

  function clearOnlineUsers() {
    onlineUsers.clear();
    renderOnlineUsers();
  }

  function pruneOnlineUsers() {
    const cutoff = Date.now() - 18000;
    let changed = false;
    onlineUsers.forEach((user, userId) => {
      if (user.lastSeenAt < cutoff) {
        onlineUsers.delete(userId);
        changed = true;
      }
    });
    if (changed) renderOnlineUsers();
  }

  function handleCursorMessage(message) {
    if (message.canvas_id && message.canvas_id !== currentCanvasId) return;
    if (message.user_id && message.user_id === currentUserId) return;

    upsertOnlineUser(message);

    const point = Array.isArray(message.points) ? message.points[0] : message.point;
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

    const label = message.username || message.user_name || message.user_id || '协作者';
    upsertRemoteCursor(message.user_id || message.stroke_id || label, label, point, message.color);
  }

  function upsertRemoteCursor(id, label, point, color) {
    let cursor = remoteCursors.get(id);
    if (!cursor) {
      const el = document.createElement('div');
      el.className = 'remote-cursor';
      el.innerHTML = '<span></span>';
      cursorLayer.appendChild(el);
      cursor = { el, timeoutId: null };
      remoteCursors.set(id, cursor);
    }

    cursor.el.style.setProperty('--cursor-color', color || userColor(id));
    cursor.el.style.transform = `translate(${point.x}px, ${point.y}px)`;
    cursor.el.querySelector('span').textContent = label;
    cursor.el.style.opacity = '1';

    clearTimeout(cursor.timeoutId);
    cursor.timeoutId = setTimeout(() => {
      cursor.el.style.opacity = '0';
    }, 1800);
  }

  function clearRemoteCursors() {
    remoteCursors.forEach((cursor) => clearTimeout(cursor.timeoutId));
    remoteCursors.clear();
    cursorLayer.innerHTML = '';
  }

  function sendPresence(type = 'presence') {
    if (!currentCanvasId || !collector.isConnected()) return;
    collector.send({
      type,
      action: type,
      canvas_id: currentCanvasId,
      points: [],
      color: colorPicker.value,
      username: getCurrentUserName(),
      timestamp: Date.now()
    });
  }

  function sendCursor(point) {
    const now = performance.now();
    if (!currentCanvasId || now - lastCursorSentAt < 50 || !collector.isConnected()) return;

    lastCursorSentAt = now;
    collector.send({
      type: 'cursor',
      action: 'cursor',
      canvas_id: currentCanvasId,
      points: [point],
      color: colorPicker.value,
      username: getCurrentUserName(),
      timestamp: Date.now()
    });
  }

  function sendCursorLocal(point) {
    const now = performance.now();
    if (!currentCanvasId || now - lastCursorSentAt < 50 || !collector.isConnected()) return;

    lastCursorSentAt = now;
    // cursor 只做在线状态/光标渲染，不应进入持久化链路（Kafka/Mongo）
    collector.send({
      type: 'cursor_local',
      action: 'cursor_local',
      canvas_id: currentCanvasId,
      points: [point],
      color: colorPicker.value,
      username: getCurrentUserName(),
      timestamp: Date.now()
    });
  }

  function startPresenceTimers() {
    stopPresenceTimers();
    presenceTimerId = setInterval(() => sendPresence('presence'), 5000);
    onlinePruneTimerId = setInterval(() => {
      pruneOnlineUsers();
      renderOnlineUsers();
    }, 5000);
  }

  function stopPresenceTimers() {
    if (presenceTimerId) {
      clearInterval(presenceTimerId);
      presenceTimerId = null;
    }
    if (onlinePruneTimerId) {
      clearInterval(onlinePruneTimerId);
      onlinePruneTimerId = null;
    }
  }

  function protectSidebarInteractions() {
    const blockedEvents = [
      'mousedown',
      'mousemove',
      'mouseup',
      'mouseleave',
      'touchstart',
      'touchmove',
      'touchend',
      'touchcancel'
    ];

    document.querySelectorAll('.draw-sidebar').forEach((sidebar) => {
      blockedEvents.forEach((eventName) => {
        sidebar.addEventListener(eventName, (event) => {
          event.stopPropagation();
        }, { capture: true });
      });
    });
  }

  function handleCollectorMessage(rawData) {
    let message;

    try {
      message = JSON.parse(rawData);
    } catch (error) {
      console.warn('[SyncCanvas] 无法解析 WebSocket 消息', error);
      return;
    }

    const messageKind = getMessageKind(message);

    if (messageKind === 'welcome') {
      currentUserId = message.user_id || currentUserId;
      userIdEl.textContent = currentUserId || '-';
      setTimeout(() => sendPresence('presence'), 0);
      return;
    }

    if (messageKind === 'sync_response') {
      if (message.canvas_id && message.canvas_id !== currentCanvasId) {
        return;
      }
      replayOperations(extractOperations(message), 'WebSocket');
      return;
    }

    if (messageKind === 'presence_update') {
      if (message.canvas_id && message.canvas_id !== currentCanvasId) return;
      const list = Array.isArray(message.online_users) ? message.online_users : [];
      onlineUsers.clear();
      list.forEach((user) => {
        if (!user) return;
        const userId = user.user_id || user.username;
        if (!userId || userId === currentUserId) return;
        onlineUsers.set(userId, {
          userId,
          username: user.username || userId,
          color: userColor(userId),
          lastSeenAt: Date.now()
        });
      });
      const count = Number.isFinite(message.online_count)
        ? message.online_count
        : (list.length + 1);
      onlineCountEl.textContent = String(count);
      renderOnlineUsers();
      return;
    }

    if (messageKind === 'presence') {
      upsertOnlineUser(message);
      return;
    }

    if (messageKind === 'leave') {
      removeOnlineUser(message);
      return;
    }

    if (messageKind === 'cursor') {
      handleCursorMessage(message);
      return;
    }

    if (messageKind === 'clear') {
      operations.length = 0;
      latestSequenceId = Number(message.sequence_id) || 0;
      redrawCanvas();
      updateSequenceStatus();
      updateUndoButton();
      window.SyncCanvasApp?.markCanvasModified?.(currentCanvasId, message.timestamp, latestSequenceId);
      return;
    }

    if (messageKind === 'undo') {
      const strokeId = message.stroke_id;
      if (strokeId) {
        const index = operations.findIndex((op) => op.stroke_id === strokeId);
        if (index >= 0) operations.splice(index, 1);
        latestSequenceId = Math.max(latestSequenceId, Number(message.sequence_id) || 0);
        redrawCanvas();
        updateSequenceStatus();
        updateUndoButton();
        window.SyncCanvasApp?.markCanvasModified?.(currentCanvasId, message.timestamp, latestSequenceId);
      }
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
    activeTool = tool;

    // 图形/文字工具不走 collector 的采集逻辑，但仍复用其 WS 连接与 send()
    if (isShapeTool(tool)) {
      collector.setTool('highlighter');
    } else {
      collector.setTool(tool);
    }

    penBtn.classList.toggle('active', tool === 'pen');
    eraserBtn.classList.toggle('active', tool === 'eraser');
    rectBtn.classList.toggle('active', tool === 'rect');
    ellipseBtn.classList.toggle('active', tool === 'ellipse');
    lineBtn.classList.toggle('active', tool === 'line');
    textBtn.classList.toggle('active', tool === 'text');

    if (tool === 'eraser') {
      canvas.style.cursor = 'cell';
    } else if (tool === 'text') {
      canvas.style.cursor = 'text';
    } else if (tool === 'rect' || tool === 'ellipse' || tool === 'line') {
      canvas.style.cursor = 'crosshair';
    } else {
      canvas.style.cursor = 'crosshair';
    }

    previewElement = null;
    schedulePresent();
  }

  function setColor(color) {
    colorPicker.value = color;
    collector.setColor(color);
    colorSwatches.forEach((swatch) => {
      swatch.classList.toggle('active', swatch.dataset.color.toLowerCase() === color.toLowerCase());
    });
  }

  function updateSequenceStatus() {
    sequenceIdEl.textContent = String(latestSequenceId);
  }

  function updateUndoButton() {
    undoBtn.disabled = !operations.some((op) => op.user_id === currentUserId);
  }

  function undoLastOperation() {
    const operation = [...operations]
      .filter((op) => op.user_id === currentUserId)
      .sort(compareOperations)
      .pop();

    if (!operation) return;

    collector.send({
      type: 'undo',
      canvas_id: currentCanvasId,
      action: 'undo',
      stroke_id: operation.stroke_id
    });

    const index = operations.findIndex((op) => op.stroke_id === operation.stroke_id);
    if (index >= 0) operations.splice(index, 1);
    redrawCanvas();
    updateUndoButton();
    window.SyncCanvasApp?.markCanvasModified?.(currentCanvasId, Date.now(), latestSequenceId);
  }

  async function openCanvas(canvasId, canvasName) {
    if (!canvasId) return;
    if (canvasId === currentCanvasId && collector.isConnected()) {
      return;
    }

    if (currentCanvasId && currentCanvasId !== canvasId) {
      sendPresence('leave');
    }

    currentCanvasId = canvasId;
    currentCanvasName = canvasName || canvasId;
    currentCanvasLabel.textContent = currentCanvasName;
    replayRequestId += 1;
    activeConnectionToken += 1;
    const requestId = replayRequestId;
    const connectionToken = activeConnectionToken;

    stopPresenceTimers();
    if (!collectorStarted) {
      collectorStarted = true;
      collector.start({
        flushInterval: 50,
        toolbarSelector: '#toolbar, .draw-sidebar'
      });
    } else {
      collector.disconnect();
    }

    resetCanvasState();
    wsStatus.textContent = '连接中';
    wsStatus.className = 'disconnected';
    window.dispatchEvent(new CustomEvent('synccanvas:canvas-opened', {
      detail: { canvasId: currentCanvasId, canvasName: currentCanvasName }
    }));

    resizeCanvas();
    await replayHistoryFromApi(canvasId, requestId);
    if (requestId !== replayRequestId || connectionToken !== activeConnectionToken) return;
    collector.connect(buildWsUrl(canvasId));
    startPresenceTimers();
  }

  function disconnectCanvas() {
    sendPresence('leave');
    replayRequestId += 1;
    activeConnectionToken += 1;
    stopPresenceTimers();

    if (collectorStarted) {
      collector.disconnect();
      collectorStarted = false;
    }

    currentCanvasId = null;
    currentCanvasName = '';
    currentCanvasLabel.textContent = '未选择画布';
    replayStatus.textContent = '未开始';
    resetCanvasState();
    wsStatus.textContent = '未连接';
    wsStatus.className = 'disconnected';
    window.dispatchEvent(new CustomEvent('synccanvas:canvas-opened', {
      detail: { canvasId: null, canvasName: '' }
    }));
  }

  penBtn.addEventListener('click', () => setActiveTool('pen'));
  eraserBtn.addEventListener('click', () => setActiveTool('eraser'));
  rectBtn.addEventListener('click', () => setActiveTool('rect'));
  ellipseBtn.addEventListener('click', () => setActiveTool('ellipse'));
  lineBtn.addEventListener('click', () => setActiveTool('line'));
  textBtn.addEventListener('click', () => setActiveTool('text'));

  colorSwatches.forEach((swatch) => {
    swatch.addEventListener('click', () => setColor(swatch.dataset.color));
  });

  colorPicker.addEventListener('input', (event) => setColor(event.target.value));

  strokeWidth.addEventListener('input', (event) => {
    const width = Number(event.target.value);
    widthValue.textContent = String(width);
    collector.setWidth(width);
  });

  undoBtn.addEventListener('click', undoLastOperation);

  clearBtn.addEventListener('click', () => {
    if (operations.length === 0) return;
    if (!window.confirm('确定要清空画布吗？这会同步清除所有用户的笔画。')) return;

    collector.send({
      type: 'clear',
      canvas_id: currentCanvasId,
      action: 'clear'
    });

    operations.length = 0;
    latestSequenceId = 0;
    redrawCanvas();
    updateSequenceStatus();
    updateUndoButton();
    window.SyncCanvasApp?.markCanvasModified?.(currentCanvasId, Date.now(), latestSequenceId);
  });

  canvas.addEventListener('mousedown', (event) => {
    if (!currentCanvasId) return;

    // 文字工具：点击出输入框
    if (activeTool === 'text') {
      const point = getCanvasPoint(event);
      spawnTextEditor(point);
      return;
    }

    // 图形工具：开始拖拽
    if (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'line') {
      elementStartPoint = getCanvasPoint(event);
      previewElement = {
        kind: activeTool,
        data: {
          x1: elementStartPoint.x,
          y1: elementStartPoint.y,
          x2: elementStartPoint.x,
          y2: elementStartPoint.y
        },
        style: buildElementStyle()
      };
      schedulePresent();
      return;
    }

    // 默认：自由画笔/橡皮擦
    const action = getActiveTool() === 'eraser' ? 'erase' : 'stroke';
    isDrawing = true;
    lastPoint = getCanvasPoint(event);
    drawDotOn(offscreenCtx, lastPoint, action, colorPicker.value, strokeWidth.value);
    schedulePresent();
    sendCursorLocal(lastPoint);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!currentCanvasId) return;
    const point = getCanvasPoint(event);
    sendCursorLocal(point);

    if (elementStartPoint && previewElement && (activeTool === 'rect' || activeTool === 'ellipse' || activeTool === 'line')) {
      previewElement.data.x2 = point.x;
      previewElement.data.y2 = point.y;
      schedulePresent();
      return;
    }

    if (!isDrawing || !lastPoint) return;

    const action = getActiveTool() === 'eraser' ? 'erase' : 'stroke';
    drawLineOn(offscreenCtx, lastPoint, point, action, colorPicker.value, strokeWidth.value);
    lastPoint = point;
    schedulePresent();
  });

  canvas.addEventListener('mouseup', () => {
    if (elementStartPoint && previewElement && currentCanvasId) {
      const element = {
        action: 'element_add',
        canvas_id: currentCanvasId,
        element_id: crypto.randomUUID(),
        kind: previewElement.kind,
        data: { ...previewElement.data },
        style: { ...previewElement.style },
        timestamp: Date.now()
      };

      collector.send(element);

      elementStartPoint = null;
      previewElement = null;
      schedulePresent();

      return;
    }

    isDrawing = false;
    lastPoint = null;
  });

  canvas.addEventListener('mouseleave', () => {
    elementStartPoint = null;
    previewElement = null;
    schedulePresent();

    isDrawing = false;
    lastPoint = null;
  });

  collector.on('segment', handleLocalSegment);
  collector.on('message', handleCollectorMessage);
  collector.on('connect', () => {
    wsStatus.textContent = '已连接';
    wsStatus.className = 'connected';
    sendPresence('presence');
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
  protectSidebarInteractions();
  renderOnlineUsers();
  setActiveTool('pen');
  setColor(colorPicker.value);
  collector.setWidth(Number(strokeWidth.value));
  updateSequenceStatus();
  updateUndoButton();

  window.SyncCanvasDraw = {
    openCanvas,
    disconnectCanvas,
    getCurrentCanvasId: () => currentCanvasId,
    getCurrentCanvasName: () => currentCanvasName
  };
}());
