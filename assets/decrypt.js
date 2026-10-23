/* 菌护禾 · 报告解密（浏览器内）
 * 包格式：{"v":1,"alg":"RSA-OAEP-256+A256GCM+gzip","key":b64,"iv":b64,"data":b64,...}
 * 私钥：PKCS#8 PEM（tools/gen_keys.py 生成，无口令）
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const INTRO_LABELS = { structure: '结构清晰', specificity: '具体可验证', selfAwareness: '自我认知', roleFit: '岗位匹配' };
  const QA_LABELS = ['具体性', '逻辑性', '反思深度', '岗位匹配'];

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
    if (typeof DecompressionStream === 'undefined') return bytes; // 老浏览器：假定未压缩
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
    const parts = (`${p.total}`);
    const partsHtml = (p.parts || []).map((x) => {
      const w = Number(x.weight) || 0;
      return `<div class="stat"><b>${fmt(x.score, 1)}</b><span>${esc(x.name)} · 权重 ${fmt(w * 100)}%</span></div>`;
    }).join('');
    const dimsHtml = (p.dims || []).map((d) => bar(`${d.label}（${d.type === 'ability' ? '能力' : '性格'}）`, d.value)).join('');
    const fit = (p.roleFit || []).slice(0, 3).map((f, i) => bar(`${i === 0 ? '最匹配' : '第 ' + (i + 1)} · ${f.name}`, f.score)).join('');
    const intro = p.intro ? `
      <div class="report-block">
        <h3>自我介绍（${fmt(p.intro.total)} / 100${p.intro.mode === 'ai' ? ' · AI 评分' : ' · 本地规则评分'}）</h3>
        ${(p.intro.dimensions ? Object.keys(p.intro.dimensions) : []).map((k) => {
          const d = p.intro.dimensions[k] || {};
          return bar(INTRO_LABELS[k] || k, (Number(d.score) || 0) * 4);
        }).join('')}
        <h3>亮点 / 风险 / 建议</h3>
        ${ul((p.intro.highlights || []).map((x) => '✓ ' + x)
          .concat((p.intro.risks || []).map((x) => '! ' + x))
          .concat((p.intro.suggestions || []).map((x) => '→ ' + x)))}
      </div>` : '';
    const qa = p.qa ? `
      <div class="report-block">
        <h3>AI 追问（${fmt(p.qa.overall)} / 100${p.qa.mode === 'ai' ? ' · AI 评分' : ' · 本地规则评分'}）</h3>
        ${(p.qa.scores || []).map((s, i) => bar(`追问 ${i + 1}`, (Number(s.score) || 0) * 4)).join('')}
        ${ul((p.qa.scores || []).map((s, i) => `追问 ${i + 1}：${s.reason || ''}`))}
        ${ul((p.qa.suggestions || []).map((x) => '→ ' + x))}
      </div>` : '';
    const answers = (p.answers || []).length ? `
      <div class="report-block">
        <h3>原始问答</h3>
        ${(p.answers || []).map((x, i) => `<p><b>Q${i + 1}：</b>${esc(x.q)}</p><p class="hint">${esc(x.answer)}</p>`).join('')}
      </div>` : '';
    const introText = p.introText ? `
      <div class="report-block">
        <h3>自我介绍原文</h3>
        <p>${esc(p.introText)}</p>
      </div>` : '';

    $('#result').innerHTML = `
      <div class="big-score"><b>${fmt(p.total, 1)}</b><span>/ 100 综合评分</span>
        <span class="verdict">${esc(verdictOf(Number(p.total) || 0))}</span></div>
      <p class="hint">${esc(p.candidate?.name || '候选人')} · ${esc(p.candidate?.role || '')} · ${esc(p.candidate?.exp || '')}
        · 生成于 ${esc(p.createdAt || '')}</p>
      <div class="split">${partsHtml}</div>
      <h3>四维画像</h3>
      <div class="dim-grid">${dimsHtml}</div>
      ${fit ? `<h3>人岗匹配</h3><div class="dim-grid">${fit}</div>` : ''}
      ${introText}${intro}${qa}${answers}
      <p class="note">本报告由候选人端生成并加密；解密仅表示内容未被篡改，不代表候选人信息已核实。</p>`;
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
      const f = e.target.files?.[0];
      if (!f) return;
      $('#pkg-text').value = await readFileAsText(f);
    });
    $('#key-file').addEventListener('change', async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      $('#key-text').value = await readFileAsText(f);
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
        $('#status').textContent = `解密成功：${data.candidate?.name || '候选人'}，${fmt(data.total, 1)} / 100`;
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
      a.download = `菌护禾-报告-${(decrypted.candidate?.name || 'candidate')}-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('已下载明文 JSON');
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
