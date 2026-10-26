/*
 * 界面逻辑：读文件夹 → 解析 → 画图 → 交互
 * 依赖 lib/clausewitz.js 和 lib/render.js（以全局变量形式加载）
 */
(function () {
  'use strict';

  var SKIP_DIRS = /^(gfx|sound|music|portraits|assets|cef|browser|pdx_launcher|shadercache|\.git|node_modules|tests)$/i;
  var MAX_FILE_BYTES = 4 * 1024 * 1024;

  var state = {
    trees: [],
    current: null,
    view: { x: 0, y: 0, k: 1 },
    selected: null
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
    sidebar: document.getElementById('sidebar')
  };

  // ---------------- 读文件 ----------------

  function collectFromEntries(entries) {
    var files = [];

    function walk(entry) {
      return new Promise(function (resolve) {
        if (entry.isFile) {
          entry.file(function (file) {
            if (/\.txt$/i.test(file.name) && file.size < MAX_FILE_BYTES) files.push(file);
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
      if (/\.txt$/i.test(f.name) && f.size < MAX_FILE_BYTES) files.push(f);
    }
    return Promise.resolve(files);
  }

  // ---------------- 解析 ----------------

  function loadFiles(files) {
    if (!files.length) {
      el.stats.textContent = '没有找到 .txt 文件';
      return;
    }

    var scanned = 0;
    var matched = 0;
    var collected = [];

    function next() {
      if (scanned >= files.length) return finish();

      var file = files[scanned++];
      el.stats.textContent = '解析中 ' + scanned + ' / ' + files.length;

      file.text().then(function (text) {
        if (text.indexOf('focus_tree') !== -1 || text.indexOf('shared_focus') !== -1) {
          try {
            var ast = Clausewitz.parse(text);
            var trees = Clausewitz.extract(ast);
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
        el.stats.textContent = '读到 ' + matched + ' 个文件，但里面没有国策树';
        return;
      }

      var total = state.trees.reduce(function (n, t) { return n + t.focuses.length; }, 0);
      el.stats.textContent = state.trees.length + ' 棵树 · ' + total + ' 个国策 · ' + matched + ' 个文件';
      el.empty.style.display = 'none';

      renderSidebar();
      selectTree(state.trees[0].id);
    }

    next();
  }

  // ---------------- 渲染 ----------------

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
    state.view = { x: 0, y: 0, k: 1 };

    el.stage.innerHTML = FocusRender.toSVG(tree, { title: tree.id });
    applyView();
    bindNodes();
    renderSidebar();
    el.search.value = '';
  }

  function applyView() {
    el.stage.style.transform = 'translate(' + state.view.x + 'px, ' + state.view.y + 'px) scale(' + state.view.k + ')';
  }

  function bindNodes() {
    var nodes = el.stage.querySelectorAll('.ftv-node');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].addEventListener('click', function (e) {
        e.stopPropagation();
        toggleSelection(this.dataset.focusId);
      });
    }
  }

  // ---------------- 选中与高亮 ----------------

  function relatedIds(startId) {
    var byId = Object.create(null);
    var tree = state.current;
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
    stack = [startId];
    var reverse = Object.create(null);
    tree.focuses.forEach(function (f) {
      (f.prereq || []).forEach(function (group) {
        group.forEach(function (pid) {
          (reverse[pid] = reverse[pid] || []).push(f.id);
        });
      });
    });
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
      var node = nodes[i];
      var on = !!ids[node.dataset.focusId];
      node.classList.toggle('is-related', on);
      node.classList.toggle('is-dim', !on);
    }
    var paths = el.stage.querySelectorAll('path[data-from]');
    for (var p = 0; p < paths.length; p++) {
      var from = paths[p].getAttribute('data-from');
      var to = paths[p].getAttribute('data-to');
      var lit = ids[from] && ids[to];
      paths[p].classList.toggle('is-dim', !lit);
    }
  }

  // ---------------- 搜索 ----------------

  function runSearch(q) {
    q = q.trim().toLowerCase();
    if (!q) { clearSelection(); return; }

    var hits = Object.create(null);
    state.current.focuses.forEach(function (f) {
      if (f.id.toLowerCase().indexOf(q) !== -1) hits[f.id] = true;
    });
    state.selected = null;

    var nodes = el.stage.querySelectorAll('.ftv-node');
    for (var i = 0; i < nodes.length; i++) {
      var on = !!hits[nodes[i].dataset.focusId];
      nodes[i].classList.toggle('is-related', on);
      nodes[i].classList.toggle('is-dim', !on);
    }
  }

  // ---------------- 交互 ----------------

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
    if (e.target.closest('.ftv-node')) return;
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

  function escape(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------------- 绑定 ----------------

  el.canvas.addEventListener('wheel', onWheel, { passive: false });
  el.canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  el.search.addEventListener('input', function () { runSearch(el.search.value); });
  el.btnReset.addEventListener('click', function () {
    state.view = { x: 0, y: 0, k: 1 };
    applyView();
    clearSelection();
    el.search.value = '';
  });
  el.btnExport.addEventListener('click', exportSVG);
  el.fileInput.addEventListener('change', function () {
    collectFromFileList(el.fileInput.files).then(loadFiles);
  });

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') clearSelection();
  });

  // 拖拽整个文件夹
  ['dragenter', 'dragover'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      e.preventDefault();
      document.body.classList.add('dragging');
    });
  });
  ['dragleave', 'drop'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      e.preventDefault();
      if (type === 'dragleave' && e.relatedTarget) return;
      document.body.classList.remove('dragging');
    });
  });
  window.addEventListener('drop', function (e) {
    var items = e.dataTransfer.items;
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
