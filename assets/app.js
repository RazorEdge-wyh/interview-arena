/* 金种子杯 · 菌护禾 · 团队招募（极简版）
 * 项目介绍 → 5 道选择题 + 基本信息 → 自我介绍 → 2 道简答题 → 评分与发送
 * 不调用任何 AI、不加密：直接把报名信息明文发给团队
 */
(() => {
  'use strict';

  const DATA_URL = 'data/questions.json';
  const DRAFT_KEY = 'ia_draft_v2';

  const state = {
    data: null,
    direction: 'tech',
    answers: {},
    intro: '',
    short: {},
    contact: '',
    report: null,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const fmt = (n, d = 0) => (Number(n) || 0).toFixed(d).replace(/\.0$/, '');
  const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));

  function toast(msg, ms = 4200, type = '') {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + (type || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast hidden'; }, ms);
  }

  function showNotice(el, text) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
  }
  function hideNotice(el) { if (el) el.classList.add('hidden'); }

  /* ---------------- 草稿 ---------------- */
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        direction: state.direction,
        answers: state.answers,
        intro: $('#intro-text') ? $('#intro-text').value : state.intro,
        short: state.short,
        contact: state.contact,
        name: $('#cand-name') ? $('#cand-name').value : '',
        exp: $('#cand-exp') ? $('#cand-exp').value : '',
      }));
    } catch (_) {}
  }
  function restoreDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (!d) return;
      if (d.direction) state.direction = d.direction;
      if (d.answers) state.answers = d.answers;
      if (typeof d.intro === 'string') state.intro = d.intro;
      if (d.short) state.short = d.short;
      if (d.contact) state.contact = d.contact;
      if (d.name && $('#cand-name')) $('#cand-name').value = d.name;
      if (d.exp && $('#cand-exp')) $('#cand-exp').value = d.exp;
    } catch (_) {}
  }

  /* ---------------- 数据 ---------------- */
  async function loadData() {
    const res = await fetch(DATA_URL + '?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const dir = () => (state.data.directions || []).find((d) => d.id === state.direction) || state.data.directions[0];
  function questionsFor(id) {
    const d = (state.data.directions || []).find((x) => x.id === id) || state.data.directions[0];
    return [...state.data.generalQuestions, state.data.projectQuestion, ...d.roleQuestions];
  }
  const shortQuestions = () => (state.data.shortQuestions && state.data.shortQuestions.length)
    ? state.data.shortQuestions
    : [
        { id: 's1', title: '你为什么想加入菌护禾？', hint: '1–3 句话即可' },
        { id: 's2', title: '你能投入多少时间？希望负责哪一块？', hint: '例如：每周 6 小时，偏试验 / 硬件 / 运营' },
      ];

  /* ---------------- 渲染 ---------------- */
  function renderProjectIntro() {
    const p = state.data.projectIntro || {};
    if ($('#project-title')) $('#project-title').textContent = p.title || '项目介绍';
    if ($('#project-lead')) $('#project-lead').textContent = p.lead || '';
    if (!$('#project-intro')) return;
    $('#project-intro').innerHTML = (p.sections || []).map((s) => `
      <div class="report-block">
        <h3>${esc(s.h)}</h3>
        ${(s.p || []).map((x) => `<p>${esc(x)}</p>`).join('')}
      </div>`).join('');
  }

  function renderDirections() {
    const sel = $('#cand-direction');
    sel.innerHTML = state.data.directions.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
    sel.value = state.direction;
    const wrap = $('#direction-cards');
    wrap.innerHTML = state.data.directions.map((d) => `
      <div class="role-card" data-dir="${d.id}">
        <div class="role-name">${esc(d.name)}</div>
        <div class="role-mission">${esc(d.mission)}</div>
      </div>`).join('');
    $$('.role-card', wrap).forEach((card) => card.addEventListener('click', () => selectDirection(card.dataset.dir)));
    sel.addEventListener('change', () => selectDirection(sel.value));
    markDirection();
  }
  function markDirection() {
    $$('#direction-cards .role-card').forEach((c) => c.classList.toggle('selected', c.dataset.dir === state.direction));
  }
  function selectDirection(id) {
    state.direction = id;
    state.answers = {};
    if ($('#cand-direction')) $('#cand-direction').value = id;
    markDirection();
    renderMCQ();
    saveDraft();
  }

  function renderMCQ() {
    const qs = questionsFor(state.direction);
    $('#mcq-list').innerHTML = qs.map((q, qi) => `
      <div class="q-card" data-qid="${q.id}">
        <span class="q-tag">${esc(q.tag)}</span>
        <div class="q-title">${qi + 1}. ${esc(q.title)}</div>
        <div class="q-options">
          ${q.options.map((o, oi) => `
            <label class="opt ${state.answers[q.id] === oi ? 'selected' : ''}" data-oi="${oi}">
              <input type="radio" name="q_${q.id}" value="${oi}" ${state.answers[q.id] === oi ? 'checked' : ''} />
              <span>${esc(o.text)}</span>
            </label>`).join('')}
        </div>
      </div>`).join('');
    $$('#mcq-list .q-card').forEach((card) => {
      const qid = card.dataset.qid;
      $$('.opt', card).forEach((opt) => {
        opt.addEventListener('change', () => {
          state.answers[qid] = Number(opt.dataset.oi);
          $$('.opt', card).forEach((o) => o.classList.toggle('selected', o === opt));
          saveDraft();
        });
      });
    });
  }

  function renderShort() {
    $('#short-list').innerHTML = shortQuestions().map((q, i) => `
      <div class="q-card" data-sid="${q.id}">
        <div class="q-title">${i + 1}. ${esc(q.title)}</div>
        <p class="hint">${esc(q.hint || '')}</p>
        <textarea class="short-input" rows="3" maxlength="600" placeholder="写下你的回答……">${esc(state.short[q.id] || '')}</textarea>
      </div>`).join('');
    $$('#short-list .short-input').forEach((t) => {
      t.addEventListener('input', () => {
        const qid = t.closest('.q-card').dataset.sid;
        state.short[qid] = t.value;
        saveDraft();
      });
    });
  }

  /* ---------------- 评分（本地规则，不调用 AI） ---------------- */
  function mcqScore() {
    const qs = questionsFor(state.direction);
    const maxTotal = {};
    qs.forEach((q) => (q.options || []).forEach((o) => {
      Object.entries(o.scores || {}).forEach(([k, v]) => { maxTotal[k] = Math.max(maxTotal[k] || 0, Number(v) || 0); });
    }));
    const got = {};
    Object.keys(maxTotal).forEach((k) => { got[k] = 0; });
    let answered = 0;
    qs.forEach((q) => {
      const idx = state.answers[q.id];
      if (idx === undefined) return;
      answered += 1;
      Object.entries((q.options[idx] && q.options[idx].scores) || {}).forEach(([k, v]) => {
        got[k] = (got[k] || 0) + (Number(v) || 0);
      });
    });
    const percent = {};
    Object.keys(maxTotal).forEach((k) => {
      percent[k] = maxTotal[k] ? clamp((got[k] / maxTotal[k]) * 100, 0, 100) : 0;
    });
    const keys = Object.keys(percent);
    const total = keys.length ? keys.reduce((a, k) => a + percent[k], 0) / keys.length : 0;
    return { complete: answered === qs.length, answered, total: Math.round(total * 10) / 10, percent };
  }

  function gradeScore(exp) {
    const map = {
      '大一 / 1 年': 60,
      '大二 / 1 年': 70,
      '大三 / 2 年': 80,
      '大四 / 3 年': 90,
      '研究生 / 3 年以上': 100,
    };
    const v = map[String(exp || '').trim()];
    return v === undefined ? 60 : v;
  }

  function buildReport() {
    const mcq = mcqScore();
    const g = gradeScore($('#cand-exp') ? $('#cand-exp').value : '');
    const w = state.data.weights || { mcq: 0.7, grade: 0.3 };
    const wmcq = Number(w.mcq) || 0;
    const wgrade = Number(w.grade) || 0;
    const wsum = (wmcq + wgrade) || 1;
    const total = mcq.total * (wmcq / wsum) + g * (wgrade / wsum);
    const dims = Object.keys(state.data.dimensions || {}).map((k) => ({
      key: k,
      label: state.data.dimensions[k].label,
      type: state.data.dimensions[k].type,
      value: mcq.percent[k] ?? 0,
    })).sort((a, b) => a.value - b.value);
    return {
      name: (($('#cand-name') && $('#cand-name').value) || '同学').trim(),
      contact: (($('#cand-contact') && $('#cand-contact').value) || '').trim(),
      direction: dir().name,
      exp: $('#cand-exp') ? $('#cand-exp').value : '',
      total: clamp(total, 0, 100),
      grade: g,
      mcq,
      parts: [
        { name: '选择题', score: mcq.total, weight: wmcq },
        { name: '年级 / 经验', score: g, weight: wgrade },
      ],
      wsum,
      dims,
      verdict: total >= 75 ? '推荐进入下一轮' : (total >= 60 ? '待定，建议再聊聊' : '已完成评估，请等待团队联系'),
    };
  }

  function bar(label, value) {
    const v = clamp(Number(value) || 0, 0, 100);
    return `<div class="score-row">
      <span class="score-label">${esc(label)}</span>
      <span class="score-bar"><i style="width:${v}%"></i></span>
      <span class="score-val">${fmt(v, 1)}</span>
    </div>`;
  }

  function renderReport() {
    const r = buildReport();
    state.report = r;
    const partsHtml = r.parts.map((p) => `<div class="stat"><b>${fmt(p.score, 1)}</b><span>${esc(p.name)} · 权重 ${Math.round((p.weight / r.wsum) * 100)}%</span></div>`).join('');
    const dimsHtml = r.dims.map((d) => bar(`${d.label}（${d.type === 'ability' ? '能力' : '性格'}）`, d.value)).join('');
    $('#report').innerHTML = `
      <div class="big-score">
        <b>${fmt(r.total, 1)}</b><span>/ 100 综合参考分</span>
        <span class="verdict">${esc(r.verdict)}</span>
      </div>
      <p class="hint">${esc(r.name)} · ${esc(r.direction)} · ${esc(r.exp)} · ${new Date().toLocaleString('zh-CN')}</p>
      <div class="split">${partsHtml}</div>
      <h3>四维画像</h3>
      <div class="dim-grid">${dimsHtml}</div>
      <p class="note">这里只展示分数；完整报名信息会随邮件发送给团队。</p>`;
  }

  /* ---------------- 内容拼装 ---------------- */
  function buildText() {
    const r = state.report || buildReport();
    const lines = [];
    lines.push('【金种子杯 · 菌护禾 团队招募 · 报名信息】');
    lines.push('');
    lines.push('姓名：' + r.name);
    lines.push('联系方式：' + r.contact);
    lines.push('想加入方向：' + r.direction);
    lines.push('年级 / 经验：' + r.exp);
    lines.push('');
    lines.push('综合参考分：' + fmt(r.total, 1) + ' / 100（选择题 ' + fmt(r.mcq.total, 1) + ' · 年级 ' + fmt(r.grade, 1) + '）');
    lines.push('四维画像：' + r.dims.map((d) => d.label + ' ' + fmt(d.value, 0)).join('，'));
    lines.push('');
    lines.push('一、选择题（共 ' + questionsFor(state.direction).length + ' 题）');
    questionsFor(state.direction).forEach((q, i) => {
      const idx = state.answers[q.id];
      const ans = idx === undefined ? '（未作答）' : q.options[idx].text;
      lines.push((i + 1) + '. ' + q.title);
      lines.push('   作答：' + ans);
    });
    lines.push('');
    lines.push('二、自我介绍');
    const intro = ($('#intro-text') ? $('#intro-text').value : state.intro) || '';
    lines.push(intro.trim() || '（未填写）');
    lines.push('');
    lines.push('三、简答题');
    shortQuestions().forEach((q, i) => {
      lines.push((i + 1) + '. ' + q.title);
      lines.push('   回答：' + (((state.short[q.id] || '')).trim() || '（未填写）'));
    });
    return lines.join('\n');
  }

  function mailSubject() {
    const r = state.report || buildReport();
    return '【金种子杯·菌护禾】报名：' + r.name + ' · ' + r.direction;
  }

  const recipients = () => (state.data && state.data.mailTo ? state.data.mailTo : []).join(',');

  async function copyRecipients() {
    try {
      await navigator.clipboard.writeText(recipients());
      toast('已复制收件人：' + recipients(), 4200, 'ok');
    } catch (_) {
      toast('复制失败，请手动复制：' + recipients(), 5000, 'err');
    }
  }

  /* ---------------- 发送 ---------------- */
  function getConfig() { return window.__IA_CONFIG__ || {}; }
  function endpoint() {
    const c = getConfig();
    if (c.apiEndpoint) return c.apiEndpoint;
    if (c.apiBase) return c.apiBase.replace(/\/+$/, '') + '/api/send';
    return '';
  }

  async function sendViaBackend(subject, text) {
    const url = endpoint();
    if (!url) throw new Error('未配置发送服务');
    const headers = { 'Content-Type': 'application/json' };
    const c = getConfig();
    if (c.apiSecret) headers['x-api-secret'] = c.apiSecret;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ subject, text }), signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendNow() {
    const btn = $('#btn-mail');
    const text = buildText();
    btn.disabled = true;
    btn.textContent = '正在发送…';
    $('#mail-status').textContent = '正在通过团队服务器发送，最多等 20 秒…';
    let ok = false;
    try {
      await Promise.race([
        sendViaBackend(mailSubject(), text),
        new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 20000)),
      ]);
      ok = true;
      $('#mail-status').textContent = '✅ 已发送到团队邮箱（5 位收件人），可以关闭页面了。';
      toast('已发送到团队邮箱', 5000, 'ok');
      btn.textContent = '已发送';
      btn.disabled = true;
    } catch (err) {
      const m = (err && (err.message === 'TIMEOUT' || err.name === 'AbortError')) ? '发送超时' : ('发送失败：' + (err.message || err));
      $('#mail-status').textContent = m + '，请用下面的「手动发送」把内容发出去。';
      toast(m + '，已切换为手动方式', 6000, 'err');
      const mb = $('#manual-box');
      if (mb) { mb.classList.remove('hidden'); mb.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    } finally {
      if (!ok) { btn.disabled = false; btn.textContent = '① 一键发送给团队'; }
    }
  }

  async function copyPlain() {
    const text = buildText();
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch (_) {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand('copy');
        ta.remove();
      } catch (_) {}
    }
    const st = $('#fallback-status');
    if (ok) {
      if (st) st.textContent = '已复制。请粘到自己的邮箱，发给上面五个邮箱。';
      toast('已复制报名内容', 4200, 'ok');
    } else {
      if (st) st.textContent = '复制失败，请手动选中内容复制。';
    }
  }

  function downloadPlain() {
    const text = buildText();
    const r = state.report || buildReport();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = '菌护禾-报名-' + r.name + '-' + Date.now() + '.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    const st = $('#fallback-status');
    if (st) st.textContent = '已下载 .txt。请用邮件或微信把它发给团队。';
  }

  /* ---------------- 流程 ---------------- */
  function goStep(n) {
    $$('.step').forEach((s) => s.classList.add('hidden'));
    const el = $('#step' + n);
    if (el) el.classList.remove('hidden');
    $$('.stepper li').forEach((li) => {
      const k = Number(li.dataset.step);
      li.classList.toggle('active', k === n);
      li.classList.toggle('done', k < n);
    });
    if (n === 5) {
      renderReport();
      setTimeout(() => { const r = document.querySelector('#report'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 60);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function requireContact() {
    const el = $('#cand-contact');
    const v = (el.value || '').trim();
    if (!v) {
      el.classList.add('error');
      showNotice($('#mcq-notice'), '请先填写联系方式（手机号或微信号），团队要靠它联系你。');
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.focus();
      toast('联系方式必填', 4200, 'err');
      return false;
    }
    el.classList.remove('error');
    return true;
  }

  function resetAll() {
    state.answers = {};
    state.intro = '';
    state.short = {};
    state.contact = '';
    state.report = null;
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    $('#cand-name').value = '';
    $('#cand-contact').value = '';
    $('#intro-text').value = '';
    $('#intro-count').textContent = '0 / 3000';
    renderMCQ();
    renderShort();
    goStep(1);
    toast('已重新开始');
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $('#btn-start-eval').addEventListener('click', () => { hideNotice($('#mcq-notice')); goStep(2); });

    $('#cand-name').addEventListener('input', saveDraft);
    $('#cand-contact').addEventListener('input', (e) => { state.contact = e.target.value; e.target.classList.remove('error'); saveDraft(); });
    $('#cand-exp').addEventListener('change', saveDraft);
    $('#intro-text').addEventListener('input', () => {
      state.intro = $('#intro-text').value;
      $('#intro-count').textContent = state.intro.length + ' / 3000';
      saveDraft();
    });

    $('#btn-to-step3').addEventListener('click', () => {
      if (!requireContact()) return;
      const qs = questionsFor(state.direction);
      const missing = qs.filter((q) => state.answers[q.id] === undefined);
      if (missing.length) {
        $$('#mcq-list .q-card').forEach((card) => {
          const q = qs.find((x) => x.id === card.dataset.qid);
          card.classList.toggle('error', !!q && state.answers[q.id] === undefined);
        });
        showNotice($('#mcq-notice'), '还有 ' + missing.length + ' 题没有选，请选完再进入下一步（已用红框标出）。');
        const first = document.querySelector('#mcq-list .q-card.error');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        toast('还有 ' + missing.length + ' 题没选', 4200, 'err');
        return;
      }
      hideNotice($('#mcq-notice'));
      goStep(3);
    });

    $('#btn-to-step4').addEventListener('click', () => {
      state.intro = $('#intro-text').value;
      saveDraft();
      goStep(4);
    });

    $('#btn-to-step5').addEventListener('click', () => {
      const missing = shortQuestions().filter((q) => !(state.short[q.id] || '').trim());
      if (missing.length) {
        toast('还有 ' + missing.length + ' 道简答题没填，先简单写一句也行', 4200, 'err');
        const first = $('#short-list .short-input');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }
      goStep(5);
    });

    $('#btn-mail').addEventListener('click', sendNow);
    if ($('#btn-copy-to')) $('#btn-copy-to').addEventListener('click', copyRecipients);
    $('#btn-manual').addEventListener('click', () => {
      const box = $('#manual-box');
      if (!box) return;
      box.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('#btn-copy-result').addEventListener('click', copyPlain);
    $('#btn-download-result').addEventListener('click', downloadPlain);
    if ($('#btn-restart')) $('#btn-restart').addEventListener('click', resetAll);
  }

  /* ---------------- 启动 ---------------- */
  async function init() {
    try {
      state.data = await loadData();
      if ($('#disclaimer')) $('#disclaimer').textContent = state.data.disclaimer || '';
      restoreDraft();
      renderProjectIntro();
      renderDirections();
      renderMCQ();
      renderShort();
      if ($('#cand-contact')) $('#cand-contact').value = state.contact || '';
      $('#intro-text').value = state.intro || '';
      $('#intro-count').textContent = ($('#intro-text').value || '').length + ' / 3000';
      bind();
      const demo = new URLSearchParams(location.search).get('demo') === '1';
      if (demo) runDemo(); else goStep(1);
    } catch (err) {
      console.error(err);
      if ($('#mcq-list')) $('#mcq-list').innerHTML = '<div class="card"><h3>加载失败</h3><p class="hint">无法读取题库（data/questions.json），请通过 HTTP 打开本页。</p></div>';
    }
  }

  function runDemo() {
    selectDirection('tech');
    $('#cand-name').value = '演示同学';
    state.contact = '演示联系方式 13800000000';
    $('#cand-contact').value = state.contact;
    const qs = questionsFor('tech');
    qs.forEach((q, i) => { state.answers[q.id] = Math.min(i, q.options.length - 1); });
    renderMCQ();
    const intro = '我是湖南科技大学园艺专业大二学生，跟着老师做过草莓连作障碍的盆栽试验：3 个处理、3 次重复，第 7 天取根际土测活菌。我负责取样与平板计数，这段经历让我学会把“感觉有效”变成可测指标。';
    $('#intro-text').value = intro;
    state.intro = intro;
    $('#intro-count').textContent = intro.length + ' / 3000';
    shortQuestions().forEach((q, i) => { state.short[q.id] = i === 0 ? '想跟着团队把方案真正落到棚里，也想学试验设计。' : '每周约 6 小时，偏试验与数据整理。'; });
    renderShort();
    goStep(5);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
