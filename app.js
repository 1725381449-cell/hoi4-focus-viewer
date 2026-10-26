/*
 * 界面逻辑：读文件夹 → 解析 → 画图 → 交互
 * 依赖 lib/clausewitz.js、lib/dds.js、lib/gfx.js、lib/render.js
 */
(function () {
  'use strict';

  // 这些目录里不可能有国策树，直接跳过。
  // gfx 单独处理：只保留 gfx/interface 下的内容（图标都在那儿）。
  var SKIP_DIRS = /^(sound|music|portraits|assets|cef|browser|pdx_launcher|shadercache|crash_reporter|dlc|integrated_dlc|documentation|tutorial|wiki|tests|\.git|node_modules)$/i;
  var MAX_FILE_BYTES = 4 * 1024 * 1024;
  var MAX_DETAIL_LINES = 40;
  var MAX_ICONS = 250;

  var state = {
    trees: [],
    current: null,
    view: { x: 0, y: 0, k: 1 },
    selected: null,
    searchHits: [],
    spriteIndex: {},   // 精灵名 → 纹理路径
    ddsFiles: {},      // 纹理路径 → File（惰性读取）
    iconCache: {},     // 精灵名 → data URL（或 null）
    iconStats: { total: 0, hit: 0 },
    globalIds: {},     // 国策 id → 所在树 id（跨树跳转用）
    rel: null          // 当前树的关系解析结果
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
    detail: document.getElementById('detail'),
    searchResults: document.getElementById('search-results')
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

  /** 把 entry.fullPath / webkitRelativePath 转成相对被拖入文件夹的路径 */
  function relativePath(p) {
    var s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    var i = s.indexOf('/');
    return (i >= 0 ? s.slice(i + 1) : s).toLowerCase();
  }

  // ---------------- 读文件 ----------------

  var buckets = { txt: [], gfx: [], dds: [] };

  function collectFromEntries(entries) {
    buckets = { txt: [], gfx: [], dds: [] };

    function walk(entry) {
      return new Promise(function (resolve) {
        if (entry.isFile) {
          var name = entry.name.toLowerCase();
          var ext = name.slice(name.lastIndexOf('.') + 1);
          if (buckets[ext] === undefined) return resolve();

          // 先按路径过滤，再取 File——否则 gfx 下上万个无关贴图会白白建一遍对象
          var rel = relativePath(entry.fullPath);
          if (ext === 'dds' && rel.indexOf('gfx/interface/') === -1) return resolve();

          entry.file(function (file) {
            if (file.size >= MAX_FILE_BYTES) return resolve();
            try { file._relPath = rel; } catch (e) { /* 忽略只读对象 */ }
            buckets[ext].push(file);
            resolve();
          }, function () { resolve(); });
          return;
        }

        if (entry.isDirectory) {
          if (SKIP_DIRS.test(entry.name)) return resolve();

          // gfx 底下只关心 interface（图标、界面贴图），其余全是模型和地图，不进去
          var fp = String(entry.fullPath || '').replace(/\\/g, '/').toLowerCase();
          if (/\/gfx\/[^/]+$/.test(fp) && !/\/gfx\/interface$/.test(fp)) return resolve();

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

    return Promise.all(entries.map(walk)).then(function () { return buckets; });
  }

  function collectFromFileList(fileList) {
    var out = { txt: [], gfx: [], dds: [] };
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      var name = f.name.toLowerCase();
      var ext = name.slice(name.lastIndexOf('.') + 1);
      if (out[ext] === undefined || f.size >= MAX_FILE_BYTES) continue;
      var rel = relativePath(f.webkitRelativePath || f.name);
      if (ext === 'dds' && rel.indexOf('gfx/interface/') === -1) continue;
      try { f._relPath = rel; } catch (e) { /* 忽略 */ }
      out[ext].push(f);
    }
    return Promise.resolve(out);
  }

  /**
   * 优先只读 national_focus 下的文件。
   * 拖整个游戏目录进来时，这一步能把几千个无关 .txt 全挡掉。
   */
  function pickPool(files) {
    var targeted = [];
    for (var i = 0; i < files.length; i++) {
      var p = files[i]._relPath || '';
      if (p.indexOf('national_focus') !== -1) targeted.push(files[i]);
    }
    return targeted.length ? targeted : files;
  }

  // ---------------- 精灵索引 ----------------

  function buildSpriteIndex(gfxFiles) {
    var index = {};
    var queue = gfxFiles.slice(0);

    function next() {
      if (!queue.length) return Promise.resolve(index);
      var file = queue.shift();
      return file.text().then(function (text) {
        try { index = GFX.parseGfx(text, index); } catch (e) { /* 坏文件跳过 */ }
        return next();
      }, function () { return next(); });
    }

    return next();
  }

  function indexDdsFiles(files) {
    state.ddsFiles = {};
    for (var i = 0; i < files.length; i++) {
      state.ddsFiles[files[i]._relPath] = files[i];
    }
  }

  // ---------------- 图标 ----------------

  function rgbaToDataURL(img) {
    var canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    var ctx = canvas.getContext('2d');
    var data = ctx.createImageData(img.width, img.height);
    data.data.set(img.rgba);
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function loadIcon(name) {
    if (!name) return Promise.resolve(null);
    if (state.iconCache[name] !== undefined) return Promise.resolve(state.iconCache[name]);

    var path = state.spriteIndex[name];
    var file = path && state.ddsFiles[path];
    if (!file) {
      state.iconCache[name] = null;
      return Promise.resolve(null);
    }

    return file.arrayBuffer().then(function (buf) {
      var img = null;
      try { img = DDS.decode(buf); } catch (e) { img = null; }
      var url = img ? rgbaToDataURL(img) : null;
      state.iconCache[name] = url;
      return url;
    }, function () {
      state.iconCache[name] = null;
      return null;
    });
  }

  function prepareIcons(tree) {
    var names = [];
    var seen = {};
    for (var i = 0; i < tree.focuses.length; i++) {
      var n = tree.focuses[i].icon;
      if (n && !seen[n]) { seen[n] = true; names.push(n); }
    }

    var icons = {};
    if (!names.length) return Promise.resolve(icons);

    var list = names.length > MAX_ICONS ? names.slice(0, MAX_ICONS) : names;
    return Promise.all(list.map(function (n) {
      return loadIcon(n).then(function (url) {
        if (url) icons[n] = url;
      });
    })).then(function () {
      state.iconStats = { total: list.length, hit: Object.keys(icons).length };
      return icons;
    });
  }

  // ---------------- 解析 ----------------

  function loadFiles(files) {
    var txt = files.txt || [];
    var gfx = files.gfx || [];
    var dds = files.dds || [];

    indexDdsFiles(dds);
    state.iconCache = {};

    if (!txt.length) {
      el.stats.textContent = '没有找到 .txt 文件';
      return;
    }

    el.stats.textContent = '读取图标索引…';
    buildSpriteIndex(gfx).then(function (index) {
      state.spriteIndex = index;
      parseFocusFiles(txt);
    });
  }

  function parseFocusFiles(rawFiles) {
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

      state.globalIds = Clausewitz.globalIndex(state.trees);
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

  /**
   * 解析当前树里的引用关系：
   *   local    本树内，正常画线
   *   cross    指向别的树（阵营国策、共享国策），要能跳过去
   *   missing  哪都找不到，属于数据问题，要提示出来
   */
  function computeRelations(tree) {
    var local = Object.create(null);
    for (var i = 0; i < tree.focuses.length; i++) local[tree.focuses[i].id] = true;

    var cross = Object.create(null);      // 源国策 id → true（这个国策有跨树关联）
    var external = Object.create(null);   // 外部 id → 'cross' | 'missing'

    function note(sourceId, targetId) {
      if (local[targetId]) return;
      cross[sourceId] = true;
      external[targetId] = state.globalIds[targetId] ? 'cross' : 'missing';
    }

    for (var j = 0; j < tree.focuses.length; j++) {
      var f = tree.focuses[j];
      for (var g = 0; g < f.prereq.length; g++) {
        for (var k = 0; k < f.prereq[g].length; k++) note(f.id, f.prereq[g][k]);
      }
      for (var x = 0; x < f.xor.length; x++) note(f.id, f.xor[x]);
    }

    return { local: local, cross: cross, external: external };
  }

  function resolveRef(id) {
    if (!state.rel) return { kind: 'local' };
    if (state.rel.local[id]) return { kind: 'local' };
    var treeId = state.globalIds[id];
    if (treeId) return { kind: 'cross', tree: treeId };
    return { kind: 'missing' };
  }

  /** 跳到某棵树里的某个国策；同树就直接定位，跨树就先切树 */
  function jumpTo(treeId, focusId) {
    if (!treeId || !focusId) return;

    if (state.current && state.current.id === treeId) {
      if (!focusById(focusId)) return;
      state.selected = focusId;
      highlight(relatedIds(focusId));
      showDetail(focusId);
      centerOn(focusId);
      return;
    }

    selectTree(treeId, focusId);
  }

  function selectTree(id, focusId) {
    var tree = null;
    for (var i = 0; i < state.trees.length; i++) {
      if (state.trees[i].id === id) { tree = state.trees[i]; break; }
    }
    if (!tree) return;

    state.current = tree;
    state.selected = null;
    state.searchHits = [];
    state.view = { x: 0, y: 0, k: 1 };
    state.rel = computeRelations(tree);
    renderSidebar();
    closeDetail();
    el.search.value = '';
    renderSearchResults('');
    el.stats.textContent = '准备图标…';

    prepareIcons(tree).then(function (icons) {
      if (state.current !== tree) return;

      el.stage.innerHTML = FocusRender.toSVG(tree, {
        title: tree.id,
        icons: icons,
        crossIds: state.rel.cross
      });
      bindNodes();
      applyView();

      if (focusId && focusById(focusId)) {
        state.selected = focusId;
        highlight(relatedIds(focusId));
        showDetail(focusId);
        centerOn(focusId);
      }

      var total = state.trees.reduce(function (n, t) { return n + t.focuses.length; }, 0);
      var iconNote = state.iconStats.hit
        ? ' · 图标 ' + state.iconStats.hit + '/' + state.iconStats.total
        : '';
      var crossCount = Object.keys(state.rel.cross).length;
      var crossNote = crossCount ? ' · 跨树关联 ' + crossCount : '';
      el.stats.textContent = state.trees.length + ' 棵树 · ' + total + ' 个国策' + iconNote + crossNote;
    });
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
    var r = resolveRef(id);

    if (r.kind === 'cross') {
      return '<button class="chip chip--cross" data-goto="' + escape(id) +
        '" data-tree="' + escape(r.tree) + '" title="在 ' + escape(r.tree) + ' 里，点击跳过去">' +
        escape(id) + '<span class="chip-tree">' + escape(r.tree) + '</span></button>';
    }

    if (r.kind === 'missing') {
      return '<span class="chip chip--missing" title="静态读取时找不到这个国策：可能是 dynamic 共享国策（游戏运行时才按国家生成），也可能是拼写问题">' +
        escape(id) + '</span>';
    }

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

    var iconUrl = state.iconCache[f.icon];
    if (iconUrl) {
      html.push('<img class="detail-thumb" src="' + iconUrl + '" alt="">');
    }

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
        var treeId = this.getAttribute('data-tree') || (state.current && state.current.id);
        jumpTo(treeId, id);
      });
    }
  }

  function showDetail(id) {
    var f = focusById(id);
    if (!f || !el.detail) return;
    renderDetail(f);
  }

  // ---------------- 搜索 ----------------

  /** 搜索框下方列出「其他树里的匹配」，点一下就跳过去 */
  function renderSearchResults(q) {
    if (!el.searchResults) return;

    if (!q || !state.trees.length) {
      el.searchResults.innerHTML = '';
      el.searchResults.classList.remove('open');
      return;
    }

    var rows = [];
    for (var i = 0; i < state.trees.length && rows.length < 12; i++) {
      var t = state.trees[i];
      if (state.current && t.id === state.current.id) continue;  // 当前树的已经高亮了
      for (var j = 0; j < t.focuses.length; j++) {
        if (t.focuses[j].id.toLowerCase().indexOf(q) === -1) continue;
        rows.push({ tree: t.id, id: t.focuses[j].id });
        if (rows.length >= 12) break;
      }
    }

    if (!rows.length) {
      el.searchResults.innerHTML = '';
      el.searchResults.classList.remove('open');
      return;
    }

    var html = ['<div class="sr-title">其他树里的匹配</div>'];
    rows.forEach(function (r) {
      html.push('<button class="sr-item" data-tree="' + escape(r.tree) + '" data-goto="' + escape(r.id) + '">' +
        '<span class="sr-tree">' + escape(r.tree) + '</span>' +
        '<span class="sr-id">' + escape(r.id) + '</span></button>');
    });

    el.searchResults.innerHTML = html.join('');
    el.searchResults.classList.add('open');

    var items = el.searchResults.querySelectorAll('.sr-item');
    for (var k = 0; k < items.length; k++) {
      items[k].addEventListener('click', function () {
        jumpTo(this.getAttribute('data-tree'), this.getAttribute('data-goto'));
      });
    }
  }

  function runSearch(q) {
    var raw = q.trim();
    q = raw.toLowerCase();
    state.searchHits = [];
    if (!state.current) return;

    renderSearchResults(q);

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
