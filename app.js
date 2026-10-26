/*
 * 界面逻辑：读文件夹 → 解析 → 画图 → 交互
 * 依赖 lib/clausewitz.js 和 lib/render.js（以全局变量形式加载）
 */
(function () {
  'use strict';

  // 整目录拖入时，这些文件夹里不可能有国策树，直接跳过
  var SKIP_DIRS = /^(gfx|sound|music|portraits|assets|cef|browser|pdx_launcher|shadercache|crash_reporter|dlc|integrated_dlc|documentation|tutorial|wiki|tests|\.git|node_modules)$/i;
  var MAX_FILE_BYTES = 4 * 1024 * 1024;
  var MAX_DETAIL_LINES = 40;

  var state = {
    trees: [],
    current: null,
    view: { x: 0, y: 0, k: 1 },
    selected: null,
    searchHits: []
  };

  var el = {
    stage: document.getElementById('stage'),
    canvas: document.getElementById('canvas'),
    empty: document.getElementById('empty'),
    stats: document.getElementById('stats'),
    treeList: document.getElementById('tree-list'),
    search: document.getElementById('search'),
    fileInput: document.getElementById('file-input'),
    btnReset: document.getElementById('btn-reset'),
    btnExport: document.getElementById('btn-export'),
    detail: document.getElementById('detail')
  };

  function escape(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function focusById(id) {
    if (!state.current) return null;
    var list = state.current.focuses;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return list[i];
    }
    return null;
  }

  // ---------------- 读文件 ----------------

  function collectFromEntries(entries) {
    var files = [];

    function walk(entry) {
      return new Promise(function (resolve) {
        if (entry.isFile) {
          entry.file(function (file) {
            if (/\.txt$/i.test(file.name) && file.size < MAX_FILE_BYTES) {
              try { file._relPath = entry.fullPath; } catch (e) { /* 忽略只读对象 */ }
              files.push(file);
            }
            resolve();
          }, function () { resolve(); });
        } else if (entry.isDirectory) {
          if (SKIP_DIRS.test(entry.name)) return resolve();
          var reader = entry.createReader();
          var all = [];
          (function next() {
            reader.readEntries(function (batch) {
              if (!batch.length) {
                Promise.all(all.map(walk)).then(function () { resolve(); });
                return;
              }
              all = all.concat(Array.prototype.slice.call(batch));
              next();
            }, function () { resolve(); });
          })();
        } else {
          resolve();
        }
      });
    }

    return Promise.all(entries.map(walk)).then(function () { return files; });
  }

  function collectFromFileList(fileList) {
    var files = [];
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (!/\.txt$/i.test(f.name) || f.size >= MAX_FILE_BYTES) continue;
      try { f._relPath = f.webkitRelativePath || f.name; } catch (e) { /* 忽略 */ }
      files.push(f);
    }
    return Promise.resolve(files);
  }

  /**
   * 优先只读 national_focus 下的文件。
   * 拖整个游戏目录进来时，这一步能把几千个无关 .txt 全挡掉。
   */
  function pickPool(files) {
    var targeted = [];
    for (var i = 0; i < files.length; i++) {
      var p = files[i]._relPath || files[i].webkitRelativePath || '';
      if (/national_focus/i.test(p)) targeted.push(files[i]);
    }
    return targeted.length ? targeted : files;
  }

  // ---------------- 解析 ----------------

  function loadFiles(rawFiles) {
    if (!rawFiles.length) {
      el.stats.textContent = '没有找到 .txt 文件';
      return;
    }

    var pool = pickPool(rawFiles);
    var scanned = 0;
    var matched = 0;
    var collected = [];

    function next() {
      if (scanned >= pool.length) return finish();

      var file = pool[scanned++];
      el.stats.textContent = '解析中 ' + scanned + ' / ' + pool.length;

      file.text().then(function (text) {
        if (text.indexOf('focus_tree') !== -1 || text.indexOf('shared_focus') !== -1) {
          try {
            var trees = Clausewitz.extract(Clausewitz.parse(text));
            if (trees.length) {
              matched++;
              collected = collected.concat(trees);
            }
          } catch (err) {
            console.warn('解析失败：' + file.name, err);
          }
        }
        next();
      }, function () { next(); });
    }

    function finish() {
      state.trees = Clausewitz.merge(collected)
        .filter(function (t) { return t.focuses.length > 0; })
        .sort(function (a, b) { return b.focuses.length - a.focuses.length; });

      if (!state.trees.length) {
        el.stats.textContent = '扫了 ' + pool.length + ' 个文件，里面没有国策树';
        return;
      }

      var total = state.trees.reduce(function (n, t) { return n + t.focuses.length; }, 0);
      el.stats.textContent = state.trees.length + ' 棵树 · ' + total + ' 个国策 · ' +
        matched + '/' + pool.length + ' 个文件命中';
      el.empty.style.display = 'none';

      renderSidebar();
      selectTree(state.trees[0].id);
    }

    next();
  }

  // ---------------- 侧栏 ----------------

  function renderSidebar() {
    el.treeList.innerHTML = '';
    state.trees.forEach(function (tree) {
      var li = document.createElement('li');
      li.className = 'tree-item' + (state.current && state.current.id === tree.id ? ' active' : '');
      li.dataset.treeId = tree.id;
      li.innerHTML = '<span class="tree-name">' + escape(tree.id) + '</span>' +
        '<span class="tree-count">' + tree.focuses.length + '</span>';
      li.addEventListener('click', function () { selectTree(tree.id); });
      el.treeList.appendChild(li);
    });
  }

  function selectTree(id) {
    var tree = null;
    for (var i = 0; i < state.trees.length; i++) {
      if (state.trees[i].id === id) { tree = state.trees[i]; break; }
    }
    if (!tree) return;

    state.current = tree;
    state.selected = null;
    state.searchHits = [];
    state.view = { x: 0, y: 0, k: 1 };

    el.stage.innerHTML = FocusRender.toSVG(tree, { title: tree.id });
    applyView();
    bindNodes();
    renderSidebar();
    closeDetail();
    el.search.value = '';
  }

  // ---------------- 视图 ----------------

  function applyView() {
    el.stage.style.transform =
      'translate(' + state.view.x + 'px, ' + state.view.y + 'px) scale(' + state.view.k + ')';
  }

  function centerOn(id) {
    var f = focusById(id);
    if (!f || typeof f._sx !== 'number') return;
    var rect = el.canvas.getBoundingClientRect();
    var k = state.view.k;
    state.view.x = rect.width / 2 - f._sx * k;
    state.view.y = rect.height / 2 - f._sy * k;
    applyView();
  }

  function bindNodes() {
    var nodes = el.stage.querySelectorAll('.ftv-node');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener('click', function (e) {
        e.stopPropagation();
        var id = this.dataset.focusId;
        toggleSelection(id);
        showDetail(id);
      });
    }
  }

  // ---------------- 高亮 ----------------

  function relatedIds(startId) {
    var tree = state.current;
    var byId = Object.create(null);
    tree.focuses.forEach(function (f) { byId[f.id] = f; });

    var out = Object.create(null);
    out[startId] = true;

    // 向上：所有前置
    var stack = [startId];
    while (stack.length) {
      var cur = byId[stack.pop()];
      if (!cur) continue;
      (cur.prereq || []).forEach(function (group) {
        group.forEach(function (pid) {
          if (!out[pid]) { out[pid] = true; stack.push(pid); }
        });
      });
    }

    // 向下：所有后继
    var reverse = Object.create(null);
    tree.focuses.forEach(function (f) {
      (f.prereq || []).forEach(function (group) {
        group.forEach(function (pid) {
          (reverse[pid] = reverse[pid] || []).push(f.id);
        });
      });
    });
    stack = [startId];
    while (stack.length) {
      var id = stack.pop();
      (reverse[id] || []).forEach(function (childId) {
        if (!out[childId]) { out[childId] = true; stack.push(childId); }
      });
    }

    return out;
  }

  function toggleSelection(id) {
    if (state.selected === id) {
      clearSelection();
      return;
    }
    state.selected = id;
    highlight(relatedIds(id));
  }

  function clearSelection() {
    state.selected = null;
    var nodes = el.stage.querySelectorAll('.ftv-node');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].classList.remove('is-related', 'is-dim');
    }
    var paths = el.stage.querySelectorAll('path[data-from]');
    for (var p = 0; p < paths.length; p++) paths[p].classList.remove('is-dim');
  }

  function highlight(ids) {
    var nodes = el.stage.querySelectorAll('.ftv-node');
    for (var i = 0; i < nodes.length; i++) {
      var on = !!ids[nodes[i].dataset.focusId];
      nodes[i].classList.toggle('is-related', on);
      nodes[i].classList.toggle('is-dim', !on);
    }
    var paths = el.stage.querySelectorAll('path[data-from]');
    for (var p = 0; p < paths.length; p++) {
      var lit = ids[paths[p].getAttribute('data-from')] && ids[paths[p].getAttribute('data-to')];
      paths[p].classList.toggle('is-dim', !lit);
    }
  }

  // ---------------- 详情面板 ----------------

  function closeDetail() {
    if (!el.detail) return;
    el.detail.classList.remove('open');
    el.detail.innerHTML = '';
  }

  function chip(id) {
    return '<button class="chip" data-goto="' + escape(id) + '">' + escape(id) + '</button>';
  }

  function blockOf(focus, key) {
    if (!focus.raw) return null;
    var list = Clausewitz._children(focus.raw, key);
    return list.length ? list[0] : null;
  }

  function preBlock(focus, key, label) {
    var block = blockOf(focus, key);
    if (!block) return '';
    var lines = Clausewitz.formatLines(block);
    var total = lines.length;
    var cut = total > MAX_DETAIL_LINES;
    if (cut) lines = lines.slice(0, MAX_DETAIL_LINES);
    return '<section class="detail-sec">' +
      '<h4>' + escape(label) + '</h4>' +
      '<pre>' + escape(lines.join('\n')) +
      (cut ? '\n… 还有 ' + (total - MAX_DETAIL_LINES) + ' 行' : '') +
      '</pre></section>';
  }

  function renderDetail(f) {
    var html = [];

    html.push('<div class="detail-head">');
    html.push('<span class="detail-id">' + escape(f.id) + '</span>');
    html.push('<button class="icon-btn" id="detail-close" title="关闭">×</button>');
    html.push('</div>');

    html.push('<div class="detail-meta">');
    html.push('<span>成本 <b>' + (f.cost === null ? '—' : f.cost) + '</b></span>');
    html.push('<span>坐标 <b>' + f.absX + ', ' + f.absY + '</b></span>');
    if (f.rel) html.push('<span>相对 <b>' + escape(f.rel) + '</b></span>');
    html.push('</div>');

    if (f.icon) html.push('<div class="detail-icon">' + escape(f.icon) + '</div>');

    if (f.prereq.length) {
      html.push('<section class="detail-sec"><h4>前置</h4>');
      f.prereq.forEach(function (group, i) {
        if (i > 0) html.push('<div class="or">或</div>');
        html.push('<div class="chips">');
        group.forEach(function (id) { html.push(chip(id)); });
        html.push('</div>');
      });
      html.push('</section>');
    }

    if (f.xor.length) {
      html.push('<section class="detail-sec"><h4>互斥</h4><div class="chips">');
      f.xor.forEach(function (id) { html.push(chip(id)); });
      html.push('</div></section>');
    }

    html.push(preBlock(f, 'available', '可用条件'));
    html.push(preBlock(f, 'completion_reward', '完成效果'));
    html.push(preBlock(f, 'bypass', '跳过条件'));

    el.detail.innerHTML = html.join('');
    el.detail.classList.add('open');

    var close = document.getElementById('detail-close');
    if (close) close.addEventListener('click', function () { closeDetail(); clearSelection(); });

    var chips = el.detail.querySelectorAll('[data-goto]');
    for (var i = 0; i < chips.length; i++) {
      chips[i].addEventListener('click', function () {
        var id = this.getAttribute('data-goto');
        if (!focusById(id)) return;
        state.selected = id;
        highlight(relatedIds(id));
        showDetail(id);
        centerOn(id);
      });
    }
  }

  function showDetail(id) {
    var f = focusById(id);
    if (!f || !el.detail) return;
    renderDetail(f);
  }

  // ---------------- 搜索 ----------------

  function runSearch(q) {
    q = q.trim().toLowerCase();
    state.searchHits = [];
    if (!state.current) return;

    if (!q) { clearSelection(); return; }

    var hits = Object.create(null);
    state.current.focuses.forEach(function (f) {
      if (f.id.toLowerCase().indexOf(q) !== -1) {
        hits[f.id] = true;
        state.searchHits.push(f.id);
      }
    });
    state.selected = null;

    var nodes = el.stage.querySelectorAll('.ftv-node');
    for (var i = 0; i < nodes.length; i++) {
      var on = !!hits[nodes[i].dataset.focusId];
      nodes[i].classList.toggle('is-related', on);
      nodes[i].classList.toggle('is-dim', !on);
    }
  }

  function jumpToFirstHit() {
    if (!state.searchHits.length) return;
    var id = state.searchHits[0];
    state.selected = id;
    showDetail(id);
    centerOn(id);
  }

  // ---------------- 导出 ----------------

  function exportSVG() {
    if (!state.current) return;
    var svg = el.stage.querySelector('svg');
    if (!svg) return;
    var blob = new Blob([svg.outerHTML], { type: 'image/svg+xml' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = state.current.id.replace(/[^\w-]/g, '_') + '.svg';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  // ---------------- 缩放与平移 ----------------

  function onWheel(e) {
    if (!state.current) return;
    e.preventDefault();

    var rect = el.canvas.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    var k2 = Math.min(3, Math.max(0.12, state.view.k * factor));
    var ratio = k2 / state.view.k;

    state.view.x = mx - (mx - state.view.x) * ratio;
    state.view.y = my - (my - state.view.y) * ratio;
    state.view.k = k2;
    applyView();
  }

  var drag = null;

  function onMouseDown(e) {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest('.ftv-node')) return;
    drag = { x: e.clientX, y: e.clientY, ox: state.view.x, oy: state.view.y };
    el.canvas.classList.add('grabbing');
  }

  function onMouseMove(e) {
    if (!drag) return;
    state.view.x = drag.ox + (e.clientX - drag.x);
    state.view.y = drag.oy + (e.clientY - drag.y);
    applyView();
  }

  function onMouseUp() {
    drag = null;
    el.canvas.classList.remove('grabbing');
  }

  // ---------------- 绑定 ----------------

  el.canvas.addEventListener('wheel', onWheel, { passive: false });
  el.canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  el.search.addEventListener('input', function () { runSearch(el.search.value); });
  el.search.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') jumpToFirstHit();
  });

  el.btnReset.addEventListener('click', function () {
    state.view = { x: 0, y: 0, k: 1 };
    applyView();
    clearSelection();
    closeDetail();
    el.search.value = '';
  });

  el.btnExport.addEventListener('click', exportSVG);

  el.fileInput.addEventListener('change', function () {
    collectFromFileList(el.fileInput.files).then(loadFiles);
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { clearSelection(); closeDetail(); }
  });

  // 拖拽整个文件夹
  ['dragenter', 'dragover'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      e.preventDefault();
      document.body.classList.add('dragging');
    });
  });

  window.addEventListener('dragleave', function (e) {
    e.preventDefault();
    if (e.relatedTarget) return;
    document.body.classList.remove('dragging');
  });

  window.addEventListener('drop', function (e) {
    e.preventDefault();
    document.body.classList.remove('dragging');

    var items = e.dataTransfer && e.dataTransfer.items;
    if (!items || !items.length) return;

    var entries = [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (entry) entries.push(entry);
    }
    if (!entries.length) return;

    collectFromEntries(entries).then(loadFiles);
  });
})();
