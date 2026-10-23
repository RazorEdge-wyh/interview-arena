/* 菌护禾 · 面试结果查看（浏览器内）
 * 新版：口令 00000 + AES-GCM（PBKDF2），粘贴邮件即可，无需密钥。
 * 旧版：RSA-OAEP + AES-GCM + 私钥（仅兼容 2026-10-23 之前的邮件）。
 */
(() => {
  'use strict';

  const $ = (s, r = document) => r.querySelector(s);
  const INTRO_LABELS = { structure: '表达清楚', specificity: '具体可验证', selfAwareness: '自我认知', roleFit: '方向契合' };
  const PBKDF2_ITER = 120000;
  let decrypted = null;

  function toast(msg, ms = 3000, type = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast' + (type ? ' ' + type : '');
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
    if (!m) throw new Error('旧版报告需要私钥：未识别到 PEM');
    if (m[1].indexOf('ENCRYPTED') >= 0) throw new Error('暂不支持带口令的私钥');
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

  function extractPackage(text) {
    let t = String(text || '').trim();
    if (!t) throw new Error('还没有粘贴内容');
    const m = t.match(/===\s*BEGIN[^=]*===([\s\S]*?)===\s*END[^=]*===/);
    if (m) t = m[1].trim();
    try { return JSON.parse(t); } catch (_) {}
    const start = t.indexOf('{');
    if (start < 0) throw new Error('没有找到可查看的内容，请把整封邮件粘贴进来');
    for (let end = t.lastIndexOf('}'); end > start; end = t.lastIndexOf('}', end - 1)) {
      try { return JSON.parse(t.slice(start, end + 1)); } catch (_) {}
    }
    throw new Error('内容里没有找到完整数据');
  }

  async function decryptV2(pkg, password) {
    const raw = new TextEncoder().encode(password);
    const baseKey = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: b64d(pkg.salt), iterations: PBKDF2_ITER, hash: 'SHA-256' },
      baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
    );
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(pkg.iv) }, key, b64d(pkg.data));
    return JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(plain))));
  }

  async function decryptV1(pkg, pem) {
    const der = pemToDer(pem);
    const rsaKey = await crypto.subtle.importKey('pkcs8', der, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    const rawKey = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, rsaKey, b64d(pkg.key));
    const aesKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64d(pkg.iv) }, aesKey, b64d(pkg.data));
    return JSON.parse(new TextDecoder().decode(await gunzip(new Uint8Array(plain))));
  }

  /* ---------------- 渲染 ---------------- */
  const fmt = (n, d = 0) => (Number(n) || 0).toFixed(d).replace(/\.0$/, '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  function renderV2(data) {
    const c = data.candidate || {};
    if (data.mode === 'brief' || (!data.scores && !data.parts)) {
      $('#result').innerHTML = `
        <div class="big-score"><b>${fmt(data.total, 1)}</b><span>/ 100 综合评分</span>
          <span class="verdict">${esc(data.verdict || '')}</span></div>
        <p class="hint">${esc(c.name || '同学')} · ${esc(c.direction || '')} · ${esc(data.createdAt || '')}</p>
        ${(data.parts || []).map((p) => bar(p.name, p.score)).join('')}
        <p class="note">这是精简版结果；完整分析请让同学用「下载完整邮件文件」发送。</p>`;
      $('#result-card').classList.remove('hidden');
      return;
    }
    if (data.mode === 'summary') {
      const a = data.analysis || {};
      $('#result').innerHTML = `
        <div class="big-score"><b>${fmt(data.total, 1)}</b><span>/ 100 综合评分</span>
          <span class="verdict">${esc(data.verdict || '')}</span></div>
        <p class="hint">${esc(c.name || '同学')} · ${esc(c.direction || '')} · ${esc(c.exp || '')} · ${esc(data.createdAt || '')}</p>
        ${(data.parts || []).map((p) => bar(p.name, p.score)).join('')}
        <h3>四维画像</h3>
        <div class="dim-grid">${(data.dims || []).map((d) => bar(d.label, d.value)).join('')}</div>
        ${data.chatScores && data.chatScores.length ? `<h3>AI 面试逐轮</h3><div class="dim-grid">${data.chatScores.map((x) => bar(`第 ${x.round} 轮`, x.score * 4)).join('')}</div>` : ''}
        <h3>自我介绍：亮点 / 风险 / 建议</h3>
        ${ul(((a.intro && a.intro.highlights) || []).map((x) => '✓ ' + x)
          .concat(((a.intro && a.intro.risks) || []).map((x) => '! ' + x))
          .concat(((a.intro && a.intro.suggestions) || []).map((x) => '→ ' + x)))}
        <h3>AI 面试：优势 / 风险 / 建议</h3>
        ${ul(((a.chat && a.chat.strengths) || []).map((x) => '✓ ' + x)
          .concat(((a.chat && a.chat.risks) || []).map((x) => '! ' + x))
          .concat(((a.chat && a.chat.suggestions) || []).map((x) => '→ ' + x)))}
        ${a.chat && a.chat.verdict ? `<p><b>结论：</b>${esc(a.chat.verdict)}</p>` : ''}
        ${data.introText ? `<h3>自我介绍（节选）</h3><p>${esc(data.introText)}</p>` : ''}
        <p class="note">这是邮件精简版；含对话原文与完整点评的完整版，请让同学用「下载完整邮件文件」发送后粘贴查看。</p>`;
      $('#result-card').classList.remove('hidden');
      return;
    }
    renderFull(data);
  }

  function renderFull(data) {
    const c = data.candidate || {};
    const s = data.scores || {};
    const a = data.analysis || {};
    const parts = (s.parts || []).map((x) => `<div class="stat"><b>${fmt(x.score, 1)}</b><span>${esc(x.name)} · 权重 ${fmt((Number(x.weight) || 0) * 100)}%</span></div>`).join('');
    const dims = (s.dims || []).map((d) => bar(`${d.label}（${d.type === 'ability' ? '能力' : '性格'}）`, d.value)).join('');
    const fit = (s.fit || []).slice(0, 3).map((f, i) => bar(`${i === 0 ? '最匹配' : '第 ' + (i + 1)} · ${f.name}`, f.score)).join('');
    const intro = a.intro ? `
      <div class="report-block">
        <h3>自我介绍分析（${fmt(a.intro.total)} / 100${a.intro.mode === 'ai' ? ' · AI' : ''}）</h3>
        ${(a.intro.dimensions ? Object.keys(a.intro.dimensions) : []).map((k) => {
          const d = a.intro.dimensions[k] || {};
          return bar(INTRO_LABELS[k] || k, (Number(d.score) || 0) * 4) + `<p class="hint">${esc(d.reason || '')}</p>`;
        }).join('')}
        <h3>亮点 / 风险 / 建议</h3>
        ${ul((a.intro.highlights || []).map((x) => '✓ ' + x).concat((a.intro.risks || []).map((x) => '! ' + x)).concat((a.intro.suggestions || []).map((x) => '→ ' + x)))}
      </div>` : '';
    const chat = s.chat ? `
      <div class="report-block">
        <h3>AI 面试（${fmt(s.chat.overall)} / 100 · 逐轮点评）</h3>
        ${(s.chat.perQuestion || []).map((x, i) => `<p><b>第 ${x.round || i + 1} 轮 · ${fmt((Number(x.score) || 0) * 4)} 分</b><br><span class="hint">${esc(x.comment || '')}</span></p>`).join('')}
        ${ul(((a.chat && a.chat.strengths) || []).map((x) => '✓ ' + x).concat(((a.chat && a.chat.risks) || []).map((x) => '! ' + x)).concat(((a.chat && a.chat.suggestions) || []).map((x) => '→ ' + x)))}
        ${a.chat && a.chat.verdict ? `<p><b>结论：</b>${esc(a.chat.verdict)}</p>` : ''}
      </div>` : '';
    const transcript = (data.transcript || []).length ? `
      <div class="report-block"><h3>面试对话原文</h3>
        ${(data.transcript || []).map((m) => `<p><b>${m.role === 'assistant' ? '面试官' : '同学'}：</b>${esc(m.content)}</p>`).join('')}
      </div>` : '';
    const mcq = (data.mcqAnswers || []).length ? `
      <div class="report-block"><h3>情境测评作答</h3>
        ${(data.mcqAnswers || []).map((x, i) => `<p><b>Q${i + 1}：</b>${esc(x.q)}</p><p class="hint">${esc(x.answer)}</p>`).join('')}
      </div>` : '';
    const introText = data.introText ? `<div class="report-block"><h3>自我介绍原文</h3><p>${esc(data.introText)}</p></div>` : '';

    $('#result').innerHTML = `
      <div class="big-score"><b>${fmt(s.total, 1)}</b><span>/ 100 综合评分</span>
        <span class="verdict">${esc(s.verdict || '')}</span></div>
      <p class="hint">${esc(c.name || '同学')} · ${esc(c.direction || '')} · ${esc(c.exp || '')} · ${esc(data.createdAt || '')}</p>
      ${s.gradeBonus ? `<p class="hint">年级加分：+${fmt(s.gradeBonus)}（原始分 ${fmt(s.baseTotal, 1)}，加分后 ${fmt(s.total, 1)}）</p>` : ''}
      <div class="split">${parts}</div>
      <h3>四维画像</h3><div class="dim-grid">${dims}</div>
      ${fit ? `<h3>方向契合</h3><div class="dim-grid">${fit}</div>` : ''}
      ${introText}${intro}${chat}${transcript}${mcq}
      <p class="note">本结果由同学端生成；查看只说明内容未损坏，不代表信息已核实。</p>`;
    $('#result-card').classList.remove('hidden');
  }

  /* ---------------- 交互 ---------------- */
  function bind() {
    $('#btn-clear-pkg').addEventListener('click', () => { $('#pkg-text').value = ''; });
    $('#btn-decrypt').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '处理中…';
      $('#status').textContent = '';
      try {
        const raw = $('#pkg-text').value.trim();
        if (!raw) throw new Error('请先把邮件全文粘贴进来');
        const pkg = extractPackage(raw);
        let data;
        if (pkg.alg && String(pkg.alg).indexOf('A256GCM') === 0) {
          const pw = '00000';
          data = await decryptV2(pkg, pw);
        } else if (pkg.alg && String(pkg.alg).indexOf('RSA-OAEP') === 0) {
          const pem = $('#key-text').value.trim();
          if (!pem) throw new Error('这是旧版报告：请在下方「旧版报告」里粘贴私钥');
          data = await decryptV1(pkg, pem);
        } else {
          throw new Error('识别不到报告格式，请确认粘贴的是完整邮件');
        }
        decrypted = data;
        renderV2(data);
        $('#status').textContent = '已显示结果';
        $('#btn-print').disabled = false;
        $('#btn-save-json').disabled = false;
      } catch (err) {
        console.error(err);
        $('#status').textContent = '打开失败：' + (err.message || err);
        $('#result-card').classList.add('hidden');
        $('#btn-print').disabled = true;
        $('#btn-save-json').disabled = true;
        toast('打开失败：' + (err.message || err), 5000, 'err');
      } finally {
        btn.disabled = false; btn.textContent = '查看结果';
      }
    });
    $('#btn-print').addEventListener('click', () => window.print());
    $('#btn-save-json').addEventListener('click', () => {
      if (!decrypted) return;
      const blob = new Blob([JSON.stringify(decrypted, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `菌护禾-结果-${(decrypted.candidate && decrypted.candidate.name) || 'candidate'}-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast('已下载明文 JSON', 3000, 'ok');
    });
  }

  document.addEventListener('DOMContentLoaded', bind);
})();
