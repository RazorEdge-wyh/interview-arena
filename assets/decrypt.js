/* 菌护禾 · 加密面试分析解密（浏览器内）
 * 包格式：{"v":1,"alg":"RSA-OAEP-256+A256GCM+gzip","key":b64,"iv":b64,"data":b64}
 * 私钥：PKCS#8 PEM（tools/gen_keys.py 生成，无口令）
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const INTRO_LABELS = { structure: '结构清晰', specificity: '具体可验证', selfAwareness: '自我认知', roleFit: '方向匹配' };
  let decrypted = null;

  function toast(msg, ms = 2600) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  function b64d(s) {
    s = String(s || '').trim().replace(/-/g, '+').replace(/_/g, '/');
    s += '='.repeat((4 - (s.length % 4)) % 4);
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function pemToDer(pem) {
    const m = pem.match(/-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/);
    if (!m) throw new Error('未识别到 PEM 私钥（需要 -----BEGIN PRIVATE KEY----- 格式）');
    if (m[1].indexOf('ENCRYPTED') >= 0) throw new Error('暂不支持带口令的私钥，请使用无口令的 PKCS#8 私钥');
    const body = m[2].replace(/\s+/g, '');
    const bin = atob(body);
    const der = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
    return der;
  }

  async function gunzip(bytes) {
    if (typeof DecompressionStream === 'undefined') return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function decryptPackage(pkg, pem) {
    if (!pkg || typeof pkg !== 'object') throw new Error('加密内容不是合法 JSON 对象');
    if (pkg.alg !== 'RSA-OAEP-256+A256GCM+gzip') throw new Error(`不支持的算法：${pkg.alg || '（缺失）'}`);
    for (const k of ['key', 'iv', 'data']) if (!pkg[k]) throw new Error(`加密内容缺少字段：${k}`);
    const der = pemToDer(pem);
    const rsaKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, rsaKey, b64d(pkg.key));
    const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(pkg.iv) }, aesKey, b64d(pkg.data));
    const bytes = await gunzip(new Uint8Array(plain));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  /* ---------------- 渲染 ---------------- */
  const fmt = (n, d = 0) => (Number(n) || 0).toFixed(d).replace(/\.0$/, '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function verdictOf(total) {
    if (total >= 80) return '强推荐进入下一轮';
    if (total >= 65) return '推荐进入下一轮';
    if (total >= 50) return '待定，建议补面';
    return '暂不建议推进';
  }

  function bar(label, value) {
    const v = Math.max(0, Math.min(100, Number(value) || 0));
    return `<div class="score-row">
      <span class="score-label">${esc(label)}</span>
      <span class="score-bar"><i style="width:${v}%"></i></span>
      <span class="score-val">${fmt(v, 1)}</span>
    </div>`;
  }

  function ul(items) {
    if (!items || !items.length) return '<p class="hint">（无）</p>';
    return `<ul class="clean">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
  }

  function render(p) {
    const s = p.scores || {};
    const a = p.analysis || {};
    const parts = (s.parts || []).map((x) => `<div class="stat"><b>${fmt(x.score, 1)}</b><span>${esc(x.name)} · 权重 ${fmt((Number(x.weight) || 0) * 100)}%</span></div>`).join('');
    const dims = (s.dims || []).map((d) => bar(`${d.label}（${d.type === 'ability' ? '能力' : '性格'}）`, d.value)).join('');
    const fit = (s.fit || []).slice(0, 3).map((f, i) => bar(`${i === 0 ? '最匹配' : '第 ' + (i + 1)} · ${f.name}`, f.score)).join('');
    const chatScores = s.chat && s.chat.perQuestion ? s.chat.perQuestion.map((x) => bar(`第 ${x.round} 轮`, x.score * 4)).join('') : '';

    const intro = a.intro ? `
      <div class="report-block">
        <h3>自我介绍分析（${fmt(a.intro.total)} / 100${a.intro.mode === 'ai' ? ' · AI' : ' · 本地规则'}）</h3>
        ${(a.intro.dimensions ? Object.keys(a.intro.dimensions) : []).map((k) => {
          const d = a.intro.dimensions[k] || {};
          return bar(INTRO_LABELS[k] || k, (Number(d.score) || 0) * 4) + `<p class="hint">${esc(d.reason || '')}</p>`;
        }).join('')}
        <h3>亮点 / 风险 / 建议</h3>
        ${ul((a.intro.highlights || []).map((x) => '✓ ' + x)
          .concat((a.intro.risks || []).map((x) => '! ' + x))
          .concat((a.intro.suggestions || []).map((x) => '→ ' + x)))}
      </div>` : '<p class="hint">未提交自我介绍</p>';

    const chat = s.chat ? `
      <div class="report-block">
        <h3>AI 面试（${fmt(s.chat.overall)} / 100 · 逐轮点评）</h3>
        ${(s.chat.perQuestion || []).map((x, i) => `
          <p><b>第 ${x.round || i + 1} 轮 · ${fmt((Number(x.score) || 0) * 4)} 分</b><br><span class="hint">${esc(x.comment || '')}</span></p>`).join('')}
        <h3>优势 / 风险 / 建议</h3>
        ${ul((a.chat && a.chat.strengths || []).map((x) => '✓ ' + x)
          .concat((a.chat && a.chat.risks || []).map((x) => '! ' + x))
          .concat((a.chat && a.chat.suggestions || []).map((x) => '→ ' + x)))}
        ${a.chat && a.chat.verdict ? `<p><b>结论：</b>${esc(a.chat.verdict)}</p>` : ''}
      </div>` : '<p class="hint">未完成 AI 面试</p>';

    const transcript = (p.transcript || []).length ? `
      <div class="report-block">
        <h3>面试对话原文</h3>
        ${(p.transcript || []).map((m) => `<p><b>${m.role === 'assistant' ? '面试官' : '候选人'}：</b>${esc(m.content)}</p>`).join('')}
      </div>` : '';

    const mcq = (p.mcqAnswers || []).length ? `
      <div class="report-block">
        <h3>情境测评作答</h3>
        ${(p.mcqAnswers || []).map((x, i) => `<p><b>Q${i + 1}：</b>${esc(x.q)}</p><p class="hint">${esc(x.answer)}</p>`).join('')}
      </div>` : '';

    const introText = p.introText ? `
      <div class="report-block">
        <h3>自我介绍原文</h3>
        <p>${esc(p.introText)}</p>
      </div>` : '';

    $('#result').innerHTML = `
      <div class="big-score"><b>${fmt(s.total, 1)}</b><span>/ 100 综合评分</span>
        <span class="verdict">${esc(s.verdict || verdictOf(Number(s.total) || 0))}</span></div>
      <p class="hint">${esc((p.candidate && p.candidate.name) || '候选人')} · ${esc((p.candidate && p.candidate.direction) || '')}
        · ${esc((p.candidate && p.candidate.exp) || '')} · 生成于 ${esc(p.createdAt || '')}</p>
      <div class="split">${parts}</div>
      <h3>四维画像</h3>
      <div class="dim-grid">${dims}</div>
      ${fit ? `<h3>方向匹配</h3><div class="dim-grid">${fit}</div>` : ''}
      ${chatScores ? `<h3>AI 面试逐轮分数</h3><div class="dim-grid">${chatScores}</div>` : ''}
      ${introText}${intro}${chat}${transcript}${mcq}
      <p class="note">本分析由候选人端生成并加密；解密只说明内容未被篡改，不代表候选人信息已核实。</p>`;
    $('#result-card').classList.remove('hidden');
  }

  /* ---------------- 交互 ---------------- */
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsText(file, 'utf-8');
    });
  }

  function bind() {
    $('#pkg-file').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) $('#pkg-text').value = await readFileAsText(f);
    });
    $('#key-file').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) $('#key-text').value = await readFileAsText(f);
    });
    $('#btn-clear-pkg').addEventListener('click', () => { $('#pkg-text').value = ''; $('#pkg-file').value = ''; });
    $('#btn-clear-key').addEventListener('click', () => { $('#key-text').value = ''; $('#key-file').value = ''; });

    $('#btn-decrypt').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '解密中…';
      $('#status').textContent = '';
      try {
        const rawPkg = $('#pkg-text').value.trim();
        const pem = $('#key-text').value.trim();
        if (!rawPkg) throw new Error('请先粘贴加密内容或选择 .enc.json 文件');
        if (!pem) throw new Error('请先选择私钥文件或粘贴 PEM 私钥');
        let pkg;
        try { pkg = JSON.parse(rawPkg); } catch (_) { throw new Error('加密内容不是合法 JSON'); }
        const data = await decryptPackage(pkg, pem);
        decrypted = data;
        render(data);
        $('#status').textContent = `解密成功：${(data.candidate && data.candidate.name) || '候选人'}，${fmt(data.scores && data.scores.total, 1)} / 100`;
        $('#btn-print').disabled = false;
        $('#btn-save-json').disabled = false;
      } catch (err) {
        console.error(err);
        $('#status').textContent = `解密失败：${err.message || err}`;
        $('#result-card').classList.add('hidden');
        $('#btn-print').disabled = true;
        $('#btn-save-json').disabled = true;
      } finally {
        btn.disabled = false; btn.textContent = '解密';
      }
    });

    $('#btn-print').addEventListener('click', () => window.print());
    $('#btn-save-json').addEventListener('click', () => {
      if (!decrypted) return;
      const blob = new Blob([JSON.stringify(decrypted, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `菌护禾-分析-${(decrypted.candidate && decrypted.candidate.name) || 'candidate'}-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('已下载明文 JSON');
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
