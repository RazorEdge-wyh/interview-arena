/* Interview Arena — 浏览器端面试评估站
 * 纯静态：无后端、无数据库；AI 调用可选（用户自带 Key）；结果用公钥混合加密后交给候选人自行发送。
 */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const MAIL_TO = '2160634966@qq.com';
  const SETTINGS_KEY = 'ia_settings_v1';
  const DRAFT_KEY = 'ia_draft_v1';

  const state = {
    data: null,
    answers: {},        // qid -> option index
    intro: '',
    introScore: null,   // {dimensions:{...}, total, highlights, risks, suggestions, mode}
    qa: [],             // [{q, focus, answer}]
    qaScore: null,      // {scores:[{index,score,reason}], overall, suggestions, mode}
    report: null,
    encPackage: null,
  };

  const FALLBACK_QA = [
    { q: '你自我介绍里最有代表性的那个项目，当时最大的阻碍是什么？你是怎么解决的？', focus: '问题解决' },
    { q: '如果重做一次，你会改变哪一个决定？为什么？', focus: '反思与复盘' },
    { q: '你提到的结果里，哪些是你能直接归因的，哪些是团队或环境带来的？', focus: '归因诚实度' },
    { q: '这个岗位的前 90 天，你计划先做出什么可验证的结果？', focus: '岗位匹配与规划' },
  ];

  /* ---------------- 基础工具 ---------------- */
  const fmt = (n, d = 0) => Number(n).toFixed(d).replace(/\.0$/, '');
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, ms = 2600) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  function getSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) {}
    const cfg = (typeof window !== 'undefined' && window.__IA_CONFIG__) || {};
    return {
      baseUrl: (s.baseUrl || cfg.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, ''),
      model: s.model || cfg.model || 'deepseek-chat',
      apiKey: s.apiKey || cfg.apiKey || '',
    };
  }

  /* 通过 URL 参数一次性写入本机（不写进公开仓库）：
   *   ?key=sk-xxx&model=deepseek-flash&settings=1
   * 写入后自动从地址栏移除 key，避免被截图/分享带出去。
   */
  function seedSettingsFromUrl() {
    let params;
    try { params = new URLSearchParams(location.search); } catch (_) { return; }
    const urlKey = params.get('key') || '';
    const urlModel = params.get('model') || '';
    const urlBase = params.get('base') || '';
    if (!urlKey && !urlModel && !urlBase) return;
    const cur = getSettings();
    const next = {
      baseUrl: (urlBase || cur.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, ''),
      model: urlModel || cur.model || 'deepseek-chat',
      apiKey: urlKey || cur.apiKey || '',
    };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch (_) {}
    // 清理地址栏里的 key（保留其它参数）
    params.delete('key');
    params.delete('model');
    params.delete('base');
    const qs = params.toString();
    const clean = location.pathname + (qs ? '?' + qs : '') + location.hash;
    try { history.replaceState(null, '', clean); } catch (_) {}
    if (urlKey) setTimeout(() => toast('已接入 AI（Key 仅存本机，不上传）', 3200), 600);
  }

  function hasAI() { return !!getSettings().apiKey; }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        answers: state.answers, intro: state.intro,
        role: $('#cand-role') ? $('#cand-role').value : 'auto',
      }));
    } catch (_) {}
  }

  function restoreDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      if (d && typeof d === 'object') {
        state.answers = d.answers || {};
        state.intro = typeof d.intro === 'string' ? d.intro : '';
        state.role = d.role || 'auto';
      }
    } catch (_) {}
  }

  /* ---------------- 加载题库 ---------------- */
  async function loadData() {
    const res = await fetch('data/questions.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('题库加载失败');
    return res.json();
  }

  /* ---------------- 团队与岗位 ---------------- */
  function teamLine() {
    const t = state.data.team || {};
    return `团队：${t.name || '菌护禾'}——${t.positioning || ''}；当前阶段：${t.stage || ''}`;
  }

  function selectedRoleObj() {
    const id = $('#cand-role').value;
    if (!id || id === 'auto') return null;
    return (state.data.talentRoles || []).find((r) => r.id === id) || null;
  }

  function roleContext() {
    const r = selectedRoleObj();
    if (!r) return '候选目标岗位：暂不确定（请按四维画像给出 2 个最匹配的岗位建议）';
    return `候选目标岗位：${r.name}。岗位使命：${r.mission}；硬性要求：${(r.mustHave || []).join('、')}；面试关注：${(r.interviewFocus || []).join('、')}`;
  }

  function computeRoleFit(percent) {
    return (state.data.talentRoles || []).map((r) => {
      const w = r.fitWeights || {};
      let s = 0, tw = 0;
      Object.keys(w).forEach((k) => { s += (percent[k] || 0) * w[k]; tw += w[k]; });
      return { id: r.id, name: r.name, score: tw ? s / tw : 0 };
    }).sort((a, b) => b.score - a.score);
  }

  function renderTeamAndRoles() {
    const t = state.data.team || {};
    if ($('#team-name')) $('#team-name').textContent = `${t.name || '菌护禾'} · 团队招募`;
    if ($('#team-track')) $('#team-track').textContent = t.track || '现代农业与大健康产业 / 微生物农业';
    if ($('#team-positioning')) $('#team-positioning').textContent = t.positioning || '';
    if ($('#team-stage')) $('#team-stage').textContent = t.stage || '';
    if ($('#team-hiring-note')) $('#team-hiring-note').textContent = t.hiringNote || '';

    const sel = $('#cand-role');
    sel.innerHTML = '<option value="auto">暂不确定（自动推荐岗位）</option>'
      + (state.data.talentRoles || []).map((r) => `<option value="${r.id}">${esc(r.name)}</option>`).join('');

    const wrap = $('#role-cards');
    wrap.innerHTML = (state.data.talentRoles || []).map((r) => `
      <div class="role-card" data-role="${r.id}">
        <div class="role-name">${esc(r.name)}</div>
        <div class="role-mission">${esc(r.mission)}</div>
        <div class="role-tags">${(r.mustHave || []).slice(0, 2).map((x) => `<span>${esc(x)}</span>`).join('')}</div>
      </div>`).join('');
    $$('.role-card', wrap).forEach((card) => {
      card.addEventListener('click', () => {
        sel.value = card.dataset.role;
        $$('.role-card', wrap).forEach((c) => c.classList.remove('selected'));
        card.classList.add('selected');
        toast(`已选择：${card.querySelector('.role-name').textContent}`);
        saveDraft();
      });
    });
    sel.addEventListener('change', () => {
      $$('.role-card', wrap).forEach((c) => c.classList.toggle('selected', c.dataset.role === sel.value));
      saveDraft();
    });
    sel.value = state.role || 'auto';
    $$('.role-card', wrap).forEach((c) => c.classList.toggle('selected', c.dataset.role === sel.value));
  }

  /* ---------------- MCQ ---------------- */
  const DIM_KEYS = () => Object.keys(state.data.dimensions);

  function renderMCQ() {
    const wrap = $('#mcq-list');
    wrap.innerHTML = '';
    state.data.questions.forEach((q, qi) => {
      const card = document.createElement('div');
      card.className = 'q-card';
      card.innerHTML = `
        <span class="q-tag">第 ${qi + 1} 题 · ${esc(q.tag)}</span>
        <div class="q-title">${esc(q.title)}</div>
        <div class="q-options" role="radiogroup" aria-label="${esc(q.title)}">
          ${q.options.map((o, oi) => `
            <label class="opt" data-q="${q.id}" data-o="${oi}">
              <input type="radio" name="${q.id}" value="${oi}" ${state.answers[q.id] === oi ? 'checked' : ''} />
              <span>${esc(o.text)}</span>
            </label>`).join('')}
        </div>`;
      wrap.appendChild(card);
    });
    $$('.opt', wrap).forEach((el) => {
      el.addEventListener('click', () => {
        const qid = el.dataset.q, oi = Number(el.dataset.o);
        state.answers[qid] = oi;
        $$(`.opt[data-q="${qid}"]`, wrap).forEach((x) => x.classList.remove('selected'));
        el.classList.add('selected');
        saveDraft();
      });
    });
    // 回显选中态
    Object.entries(state.answers).forEach(([qid, oi]) => {
      const el = $(`.opt[data-q="${qid}"][data-o="${oi}"]`, wrap);
      if (el) el.classList.add('selected');
    });
  }

  function mcqScore() {
    const dims = {};
    DIM_KEYS().forEach((k) => { dims[k] = 0; });
    const maxTotal = {};
    DIM_KEYS().forEach((k) => { maxTotal[k] = 0; });
    state.data.questions.forEach((q) => {
      DIM_KEYS().forEach((k) => {
        maxTotal[k] += Math.max(...q.options.map((o) => o.scores[k] || 0));
      });
      const oi = state.answers[q.id];
      if (oi === undefined) return;
      const s = q.options[oi].scores || {};
      DIM_KEYS().forEach((k) => { dims[k] += s[k] || 0; });
    });
    const percent = {};
    let sum = 0;
    DIM_KEYS().forEach((k) => {
      percent[k] = maxTotal[k] > 0 ? clamp((dims[k] / maxTotal[k]) * 100, 0, 100) : 0;
      sum += percent[k];
    });
    return {
      dims,
      percent,
      total: DIM_KEYS().length ? sum / DIM_KEYS().length : 0,
      answered: Object.keys(state.answers).length,
      complete: Object.keys(state.answers).length === state.data.questions.length,
    };
  }

  /* ---------------- AI 调用 ---------------- */
  async function callAI(messages, { maxTokens = 1400, temperature = 0.25 } = {}) {
    const { baseUrl, model, apiKey } = getSettings();
    if (!apiKey) throw new Error('NO_KEY');
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model, messages, temperature, max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`API ${res.status}: ${t.slice(0, 160)}`);
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '';
    const cleaned = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(cleaned); } catch (_) {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
      throw new Error('AI 返回不是合法 JSON');
    }
  }

  /* ---------------- 自我介绍评分 ---------------- */
  function heuristicIntro(text) {
    const t = (text || '').trim();
    const numHits = (t.match(/\d+(?:\.\d+)?%?/g) || []).length;
    const len = t.length;
    const structureWords = ['背景', '负责', '做过', '结果', '提升', '下降', '因为', '所以', '复盘', '接下来', '目标'];
    const reflectWords = ['学到', '反思', '不足', '改进', '如果重来', '下次', '收获'];
    const hit = (arr) => arr.filter((w) => t.includes(w)).length;

    const lenScore = len < 120 ? 3 : len < 220 ? 7 : len < 320 ? 11 : len < 450 ? 15 : len < 700 ? 18 : 21;
    const structure = clamp(lenScore + hit(structureWords) * 1.2, 0, 25);
    const specificity = clamp(numHits * 3.2 + (len >= 200 ? 4 : 1), 0, 25);
    const selfAwareness = clamp(4 + hit(reflectWords) * 3.2, 0, 25);
    const roleFit = clamp(5 + hit(['岗位', '希望', '擅长', '经验', '方向', '团队']) * 2.4, 0, 25);
    const total = Math.round(structure + specificity + selfAwareness + roleFit);
    return {
      dimensions: {
        structure: { score: Math.round(structure), reason: `长度 ${len} 字，结构词命中 ${hit(structureWords)} 个` },
        specificity: { score: Math.round(specificity), reason: `数字/指标出现 ${numHits} 处` },
        selfAwareness: { score: Math.round(selfAwareness), reason: `反思类表述命中 ${hit(reflectWords)} 个` },
        roleFit: { score: Math.round(roleFit), reason: `岗位相关表述命中 ${hit(['岗位', '希望', '擅长', '经验', '方向', '团队'])} 个` },
      },
      total,
      highlights: ['已完成结构化表达，可继续补数字与结果'],
      risks: ['本地规则评分只做粗筛，建议配置 API Key 获取逐句反馈'],
      suggestions: ['补 1–2 个可量化结果（百分比、时长、数量）', '结尾加一句"为什么是这个岗位"'],
      mode: 'heuristic',
    };
  }

  async function scoreIntro(text) {
    if (!text || text.trim().length < 30) throw new Error('自我介绍太短（至少 30 字）');
    const role = selectedRoleObj();
    const roleName = role ? role.name : '暂不确定';
    const exp = $('#cand-exp').value;
    if (!hasAI()) {
      toast('未配置 API Key，使用本地规则评分');
      return heuristicIntro(text);
    }
    const rubric = state.data.introRubric.map((r) => `- ${r.key}（${r.label}）：${r.desc}`).join('\n');
    const prompt = `你是菌护禾团队的面试官。请按 4 个维度给候选人的自我介绍打分，每个维度 0–25 分，只输出 JSON。
${teamLine()}
${roleContext()}
维度：
${rubric}

输出格式：
{"dimensions":{"structure":{"score":0,"reason":"引用原文的具体依据"},"specificity":{"score":0,"reason":""},"selfAwareness":{"score":0,"reason":""},"roleFit":{"score":0,"reason":""}},"total":0,"highlights":["2-3条优点（结合岗位要求）"],"risks":["2-3条风险（结合岗位要求）"],"suggestions":["2-3条可执行改进"]}
要求：分数克制、理由引用原文关键词；total = 四维之和（0–100）；不要输出 JSON 以外的内容。

候选人：应聘方向 ${roleName}；经验 ${exp}。
自我介绍：
${text}`;
    const out = await callAI([
      { role: 'system', content: '你是严格但公正的面试官，只输出合法 JSON。' },
      { role: 'user', content: prompt },
    ]);
    const dims = out.dimensions || {};
    const total = clamp(Math.round(Number(out.total) || Object.values(dims).reduce((a, d) => a + (Number(d?.score) || 0), 0)), 0, 100);
    return { ...out, total, mode: 'ai' };
  }

  function barRow(label, value) {
    return `<div class="score-row">
      <span class="score-label">${esc(label)}</span>
      <span class="score-bar"><i style="width:${clamp(value, 0, 100)}%"></i></span>
      <span class="score-val">${fmt(value)}</span>
    </div>`;
  }

  function renderIntroResult(r) {
    const box = $('#intro-result');
    const rubric = state.data.introRubric;
    const modeNote = r.mode === 'ai' ? 'AI 评分' : '本地规则评分（未调用 AI）';
    box.innerHTML = `
      <h3>自我介绍评分 <span class="verdict">${fmt(r.total)} / 100 · ${modeNote}</span></h3>
      ${rubric.map((x) => barRow(x.label, r.dimensions?.[x.key]?.score ?? 0)).join('')}
      <div class="report-block">
        <h3>亮点</h3><ul class="clean">${(r.highlights || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>风险</h3><ul class="clean">${(r.risks || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
        <h3>改进建议</h3><ul class="clean">${(r.suggestions || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`;
    box.classList.remove('hidden');
  }

  /* ---------------- AI 追问 ---------------- */
  async function genQuestions(intro) {
    if (!hasAI()) {
      toast('未配置 API Key，使用固定 4 题');
      return FALLBACK_QA.map((x) => ({ ...x }));
    }
    const prompt = `你是菌护禾团队的面试官。根据候选人的自我介绍生成 4 个追问，只输出 JSON。
${teamLine()}
${roleContext()}
输出格式：{"questions":[{"q":"一句话问题（<=40字）","focus":"考察点"}]}
要求：追问必须钩住自我介绍里的具体细节，并结合岗位要求；分别覆盖：动机/难点与解法/结果归因/岗位匹配；不要重复自我介绍原句。

自我介绍：
${intro || '（候选人未填，按通用岗位追问）'}`;
    const out = await callAI([
      { role: 'system', content: '你只输出合法 JSON。' },
      { role: 'user', content: prompt },
    ], { maxTokens: 700 });
    const qs = Array.isArray(out.questions) ? out.questions.slice(0, 4) : [];
    if (qs.length !== 4) throw new Error('AI 返回的追问数量不是 4');
    return qs.map((x) => ({ q: String(x.q || '').slice(0, 120), focus: String(x.focus || '') }));
  }

  function renderQA(questions) {
    state.qa = questions.map((x) => ({ ...x, answer: '' }));
    const wrap = $('#qa-list');
    wrap.innerHTML = '';
    state.qa.forEach((item, i) => {
      const div = document.createElement('div');
      div.className = 'qa-item';
      div.innerHTML = `
        <div class="q-num">追问 ${i + 1}${item.focus ? ` · 考察：${esc(item.focus)}` : ''}</div>
        <div class="q-text">${esc(item.q)}</div>
        <textarea data-qa="${i}" rows="4" maxlength="1200" placeholder="用 3–6 句回答：结论 → 依据/事实 → 边界或反思"></textarea>`;
      wrap.appendChild(div);
    });
    $$('textarea[data-qa]', wrap).forEach((ta) => {
      ta.addEventListener('input', () => { state.qa[Number(ta.dataset.qa)].answer = ta.value; });
    });
    $('#qa-submit-row').classList.remove('hidden');
    $('#qa-submit-row').innerHTML = `
      <button id="btn-score-qa" class="btn primary" type="button">提交问答并评分</button>
      <button id="btn-skip-qa" class="btn ghost" type="button">跳过问答（不计分）</button>`;
    $('#btn-score-qa').addEventListener('click', onScoreQA);
    $('#btn-skip-qa').addEventListener('click', () => { state.qaScore = null; goStep(4); });
  }

  function heuristicQA(qa) {
    const reflectWords = ['因为', '所以', '反思', '学到', '下次', '改进', '复盘', '结果', '数据'];
    const scores = qa.map((item, i) => {
      const t = (item.answer || '').trim();
      const len = t.length;
      const nums = (t.match(/\d+(?:\.\d+)?%?/g) || []).length;
      const hits = reflectWords.filter((w) => t.includes(w)).length;
      const base = len < 20 ? 4 : len < 60 ? 10 : len < 120 ? 15 : len < 220 ? 19 : 21;
      const score = clamp(Math.round(base + Math.min(nums, 2) * 1.5 + Math.min(hits, 3)), 0, 25);
      return { index: i, score, reason: `长度 ${len} 字，数字 ${nums} 处，反思词 ${hits} 个` };
    });
    const overall = scores.reduce((a, x) => a + x.score, 0);
    return {
      scores, overall,
      suggestions: ['补一条具体数字或结果', '每题结尾加一句"如果重来会怎么改"'],
      mode: 'heuristic',
    };
  }

  async function onScoreQA() {
    const answered = state.qa.filter((x) => (x.answer || '').trim().length >= 10);
    if (answered.length < state.qa.length) {
      toast('请先回答全部追问（每题至少 10 字）');
      return;
    }
    const btn = $('#btn-score-qa');
    btn.disabled = true; btn.textContent = '评分中…';
    try {
      let out;
      if (hasAI()) {
        const rubric = state.data.qaRubric.map((r) => `- ${r.key}（${r.label}）：${r.desc}`).join('\n');
        const prompt = `你是面试官。请对候选人的 4 个追问回答打分，每题 0–25 分，只输出 JSON。
评分维度：
${rubric}

输出格式：
{"scores":[{"index":1,"score":0,"reason":"引用回答原文的依据"},{"index":2,"score":0,"reason":""},{"index":3,"score":0,"reason":""},{"index":4,"score":0,"reason":""}],"overall":0,"suggestions":["2-3条改进建议"]}
要求：overall = 四题分数之和（0–100）；理由要具体；不要输出 JSON 以外内容。

${teamLine()}
${roleContext()}
${state.qa.map((x, i) => `【追问${i + 1}】${x.q}\n【回答】${x.answer}`).join('\n\n')}`;
        out = await callAI([
          { role: 'system', content: '你只输出合法 JSON。' },
          { role: 'user', content: prompt },
        ]);
        out.mode = 'ai';
        out.overall = clamp(Math.round(Number(out.overall) || 0), 0, 100);
      } else {
        toast('未配置 API Key，使用本地规则评分');
        out = heuristicQA(state.qa);
      }
      state.qaScore = out;
      renderQAResult(out);
      $('#qa-submit-row').innerHTML = '<button class="btn primary" type="button" id="btn-to-report">生成评估报告 →</button>';
      $('#btn-to-report').addEventListener('click', () => goStep(4));
      btn.disabled = false; btn.textContent = '重新评分';
    } catch (err) {
      console.error(err);
      btn.disabled = false; btn.textContent = '提交问答并评分';
      toast(`AI 评分失败：${err.message.includes('NO_KEY') ? '未配置 Key' : err.message}`);
    }
  }

  function renderQAResult(r) {
    const box = $('#qa-result');
    const modeNote = r.mode === 'ai' ? 'AI 评分' : '本地规则评分';
    box.innerHTML = `
      <h3>问答评分 <span class="verdict">${fmt(r.overall)} / 100 · ${modeNote}</span></h3>
      ${(r.scores || []).map((s, i) => barRow(`追问 ${i + 1}`, (Number(s.score) || 0) * 4)).join('')}
      <div class="report-block">
        <h3>点评</h3>
        <ul class="clean">${(r.scores || []).map((s, i) => `<li><b>追问 ${i + 1}</b>：${esc(s.reason || '')}</li>`).join('')}</ul>
        <h3>改进建议</h3>
        <ul class="clean">${(r.suggestions || []).map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </div>`;
    box.classList.remove('hidden');
  }

  /* ---------------- 报告 ---------------- */
  function verdictOf(total) {
    if (total >= 80) return { text: '强推荐进入下一轮', cls: 'good' };
    if (total >= 65) return { text: '推荐进入下一轮', cls: 'good' };
    if (total >= 50) return { text: '待定，建议补面', cls: 'mid' };
    return { text: '暂不建议推进', cls: 'low' };
  }

  function buildReport() {
    const mcq = mcqScore();
    const parts = [];
    if (mcq.complete) parts.push({ key: 'mcq', name: '能力性格测评', score: mcq.total, weight: state.data.weights.mcq, available: true });
    if (state.introScore) parts.push({ key: 'intro', name: '自我介绍', score: state.introScore.total, weight: state.data.weights.intro, available: true });
    if (state.qaScore) parts.push({ key: 'qa', name: 'AI 追问', score: state.qaScore.overall, weight: state.data.weights.qa, available: true });
    const wsum = parts.reduce((a, p) => a + p.weight, 0) || 1;
    const total = parts.reduce((a, p) => a + p.score * (p.weight / wsum), 0);
    const dims = DIM_KEYS().map((k) => ({
      key: k,
      label: state.data.dimensions[k].label,
      type: state.data.dimensions[k].type,
      value: mcq.percent[k] ?? 0,
    })).sort((a, b) => a.value - b.value);
    const weak = dims.slice(0, 2);
    const roleFit = computeRoleFit(mcq.percent);
    const chosen = selectedRoleObj();
    return {
      name: ($('#cand-name').value || '匿名候选人').trim(),
      role: chosen ? chosen.name : '暂不确定',
      roleId: chosen ? chosen.id : 'auto',
      exp: $('#cand-exp').value,
      total: clamp(total, 0, 100),
      verdict: verdictOf(total),
      parts,
      mcq, dims, weak, roleFit,
      intro: state.introScore,
      qa: state.qaScore,
      createdAt: new Date().toISOString(),
      weightsUsed: wsum,
    };
  }

  function renderReport() {
    const r = buildReport();
    state.report = r;
    const box = $('#report');
    const partRows = r.parts.map((p) => `
      <div class="stat"><b>${fmt(p.score)}</b><span>${esc(p.name)} · 权重 ${Math.round(p.weight / r.weightsUsed * 100)}%</span></div>`).join('');
    const dimRows = r.dims.map((d) => barRow(`${d.label}（${d.type === 'ability' ? '能力' : '性格'}）`, d.value)).join('');
    const introBlock = r.intro ? `
      <div class="report-block">
        <h3>自我介绍：亮点 / 风险 / 建议</h3>
        <ul class="clean">${(r.intro.highlights || []).map((x) => `<li>✅ ${esc(x)}</li>`).join('')}${(r.intro.risks || []).map((x) => `<li>⚠️ ${esc(x)}</li>`).join('')}${(r.intro.suggestions || []).map((x) => `<li>→ ${esc(x)}</li>`).join('')}</ul>
      </div>` : '<p class="hint">未提交自我介绍（已按剩余模块重新归一化权重）。</p>';
    const qaBlock = r.qa ? `
      <div class="report-block">
        <h3>AI 追问：逐题点评</h3>
        <ul class="clean">${(r.qa.scores || []).map((s, i) => `<li><b>追问 ${i + 1}（${fmt((Number(s.score) || 0) * 4)}）</b>：${esc(s.reason || '')}</li>`).join('')}</ul>
        <ul class="clean">${(r.qa.suggestions || []).map((x) => `<li>→ ${esc(x)}</li>`).join('')}</ul>
      </div>` : '<p class="hint">未完成 AI 追问（已按剩余模块重新归一化权重）。</p>';

    const fit = r.roleFit || [];
    const chosenId = r.roleId;
    const fitRows = fit.slice(0, 3).map((f, i) => {
      const mark = f.id === chosenId ? '（你的目标）' : '';
      const tag = i === 0 ? '最匹配' : `第 ${i + 1}`;
      return barRow(`${tag} · ${f.name}${mark}`, f.score);
    }).join('');
    const fitBlock = `
      <div class="report-block">
        <h3>人岗匹配建议（按菌护禾 6 个岗位的能力侧重计算）</h3>
        <div class="dim-grid">${fitRows}</div>
        <p class="hint">匹配分 = 四维画像按岗位权重加权；你的目标岗位：${esc(r.role)}。若目标岗位不是第一匹配，建议面试时重点补该岗位要求的证据（试验 / 样机 / 渠道 / 登记经验）。</p>
      </div>`;

    box.innerHTML = `
      <div class="big-score">
        <b>${fmt(r.total, 1)}</b><span>/ 100 综合评分</span>
        <span class="verdict">${esc(r.verdict.text)}</span>
      </div>
      <p class="hint">${esc(r.name)} · ${esc(r.role)} · ${esc(r.exp)} · 生成于 ${new Date(r.createdAt).toLocaleString('zh-CN')}</p>
      <div class="split">${partRows}</div>
      <h3>四维画像（来自 4 道情境题）</h3>
      <div class="dim-grid">${dimRows}</div>
      ${fitBlock}
      <div class="report-block">
        <h3>面试官可追问的方向（按弱项）</h3>
        <ul class="clean">${r.weak.map((d) => `<li><b>${esc(d.label)}</b>（${fmt(d.value)}）：请对方举一个最近的具体例子，追问"当时你具体做了什么、结果如何、如果重来会改什么"。</li>`).join('')}</ul>
      </div>
      ${introBlock}
      ${qaBlock}
      <p class="note">评分口径：选择题 ${Math.round(state.data.weights.mcq * 100)}% + 自我介绍 ${Math.round(state.data.weights.intro * 100)}% + AI 追问 ${Math.round(state.data.weights.qa * 100)}%（缺失模块自动归一化）。AI 评分存在波动，仅供面试准备参考。</p>`;
    refreshMailPreview();
  }

  /* ---------------- 加密 ---------------- */
  function b64(bytes) {
    let s = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  async function gzipBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return bytes;
    const cs = new CompressionStream('gzip');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function encryptReport(report) {
    const res = await fetch('public_key.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('公钥加载失败');
    const jwk = await res.json();
    const pub = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);

    const payload = {
      v: 1, to: MAIL_TO, createdAt: new Date().toISOString(),
      candidate: { name: report.name, role: report.role, roleId: report.roleId, exp: report.exp },
      total: Math.round(report.total * 10) / 10,
      parts: report.parts.map((p) => ({ name: p.name, score: Math.round(p.score * 10) / 10, weight: p.weight })),
      dims: report.dims.map((d) => ({ label: d.label, type: d.type, value: Math.round(d.value * 10) / 10 })),
      roleFit: (report.roleFit || []).map((f) => ({ name: f.name, score: Math.round(f.score * 10) / 10, id: f.id })),
      roleId: report.roleId,
      intro: report.intro ? { total: report.intro.total, mode: report.intro.mode, dimensions: report.intro.dimensions, highlights: report.intro.highlights, risks: report.intro.risks, suggestions: report.intro.suggestions } : null,
      qa: report.qa ? { overall: report.qa.overall, mode: report.qa.mode, scores: report.qa.scores, suggestions: report.qa.suggestions } : null,
      // 原始回答也加密，便于面试官复核（不落库、不上传）
      answers: state.qa.map((x) => ({ q: x.q, answer: x.answer })),
      introText: state.intro,
    };

    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await gzipBytes(raw);
    const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, compressed);
    const rawKey = await crypto.subtle.exportKey('raw', aesKey);
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawKey);

    return {
      v: 1,
      alg: 'RSA-OAEP-256+A256GCM+gzip',
      to: MAIL_TO,
      createdAt: new Date().toISOString(),
      key: b64(wrapped),
      iv: b64(iv),
      data: b64(ct),
    };
  }

  async function onEncrypt() {
    const btn = $('#btn-encrypt');
    btn.disabled = true; btn.textContent = '加密中…';
    try {
      const pkg = await encryptReport(state.report || buildReport());
      state.encPackage = pkg;
      const text = JSON.stringify(pkg);
      $('#enc-output').value = text;
      $('#enc-status').innerHTML = `已生成（${text.length} 字符，AES-256-GCM + RSA-OAEP）。收件箱：<code>${MAIL_TO}</code>`;
      ['#btn-copy', '#btn-download', '#btn-mail'].forEach((s) => { $(s).disabled = false; });
      toast('加密完成');
    } catch (err) {
      console.error(err);
      toast(`加密失败：${err.message}`);
    } finally {
      btn.disabled = false; btn.textContent = '重新生成加密报告';
    }
  }

  async function copyEnc() {
    const text = $('#enc-output').value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('已复制加密内容，可粘贴到邮件/微信');
    } catch (_) {
      $('#enc-output').select();
      document.execCommand('copy');
      toast('已复制（兼容模式）');
    }
  }

  function downloadEnc() {
    const text = $('#enc-output').value;
    if (!text) return;
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `interview-report-${Date.now()}.enc.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function mailEnc() {
    const text = $('#enc-output').value;
    if (!text) return;
    const name = ($('#cand-name').value || '候选人').trim();
    const subject = `【Interview Arena】${name} 的加密评估报告`;
    const body = `面试官你好，\n\n附件内容为 Interview Arena 生成的加密评估报告（AES-256-GCM + RSA-OAEP）。\n请把我给的这段 JSON 保存为 .enc.json，并用私钥解密（仓库 tools/decrypt_report.py）。\n\n===BEGIN ENCRYPTED REPORT===\n${text}\n===END ENCRYPTED REPORT===\n\n（如内容过长，请使用页面上的"复制加密内容"或"下载 .enc 文件"后作为附件发送。）`;
    const url = `mailto:${MAIL_TO}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (url.length > 1800) toast('内容较长，邮件客户端可能截断，建议改用下载/复制');
    window.location.href = url;
  }

  /* ---------------- 跳转邮件：正文含分数与候选人内容 ---------------- */
  function utf8B64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function buildPlainReport(report) {
    const lines = [];
    const when = new Date(report.createdAt).toLocaleString('zh-CN');
    lines.push('Interview Arena · 菌护禾团队招募评估报告');
    lines.push(`生成时间：${when}`);
    lines.push(teamLine());
    lines.push(`候选人：${report.name} ｜ 目标岗位：${report.role} ｜ 经验：${report.exp}`);
    lines.push('');
    lines.push(`一、综合评分：${fmt(report.total, 1)} / 100（${report.verdict.text}）`);
    report.parts.forEach((p) => {
      const w = Math.round((p.weight / report.weightsUsed) * 100);
      lines.push(`- ${p.name}：${fmt(p.score, 1)}（权重 ${w}%）`);
    });
    lines.push('');
    lines.push('二、四维画像（来自 4 道情境选择题）');
    report.dims.forEach((d) => {
      lines.push(`- ${d.label}（${d.type === 'ability' ? '能力' : '性格'}）：${fmt(d.value, 1)}`);
    });
    lines.push('');
    lines.push('二附、人岗匹配建议（按菌护禾 6 个岗位的能力侧重加权）');
    (report.roleFit || []).slice(0, 3).forEach((f, i) => {
      const mark = f.id === report.roleId ? '（目标岗位）' : '';
      lines.push(`- ${i === 0 ? '最匹配' : '第 ' + (i + 1)}：${f.name}${mark} — ${fmt(f.score, 1)}`);
    });
    lines.push(`目标岗位：${report.role}；若目标岗位不是第一匹配，建议面试时重点补该岗位要求的证据（试验 / 样机 / 渠道 / 登记经验）。`);
    lines.push('');
    lines.push('三、自我介绍原文');
    lines.push(state.intro || '（未提交）');
    lines.push('');
    lines.push('四、自我介绍评分与点评');
    if (report.intro) {
      (state.data.introRubric || []).forEach((r) => {
        const dim = report.intro.dimensions?.[r.key] || {};
        lines.push(`- ${r.label}：${fmt(dim.score ?? 0)} / 25 ｜ ${dim.reason || ''}`);
      });
      lines.push(`小计：${fmt(report.intro.total)} / 100`);
      (report.intro.highlights || []).forEach((x) => lines.push(`✅ ${x}`));
      (report.intro.risks || []).forEach((x) => lines.push(`⚠️ ${x}`));
      (report.intro.suggestions || []).forEach((x) => lines.push(`→ ${x}`));
    } else {
      lines.push('（未提交自我介绍）');
    }
    lines.push('');
    lines.push('五、AI 追问与回答');
    if (report.qa && state.qa.length) {
      state.qa.forEach((item, i) => {
        const s = report.qa.scores?.[i] || {};
        lines.push(`【追问 ${i + 1}】${item.q}`);
        lines.push(`【我的回答】${item.answer || '（未回答）'}`);
        lines.push(`【评分】${fmt((Number(s.score) || 0) * 4)} / 100 ｜ ${s.reason || ''}`);
        lines.push('');
      });
      lines.push(`问答小计：${fmt(report.qa.overall)} / 100`);
      (report.qa.suggestions || []).forEach((x) => lines.push(`→ ${x}`));
    } else {
      lines.push('（未完成 AI 追问）');
    }
    lines.push('');
    lines.push('六、面试官可追问的方向');
    report.weak.forEach((d) => {
      lines.push(`- ${d.label}（${fmt(d.value)}）：请对方举一个最近的具体例子，追问"你具体做了什么、结果如何、如果重来会改什么"。`);
    });
    lines.push('');
    lines.push('七、说明');
    lines.push(state.data.disclaimer || '评分仅供参考，不构成录用或淘汰依据。');
    return lines.join('\n');
  }

  async function buildMailBody(includeEnc) {
    const report = state.report || buildReport();
    let body = buildPlainReport(report);
    if (includeEnc) {
      try {
        if (!state.encPackage) state.encPackage = await encryptReport(report);
        body += '\n\n八、加密校验（可选）\n以下密文由本页用 RSA 公钥加密，面试官可用私钥解密核对内容未被篡改：\n'
          + '===BEGIN ENCRYPTED REPORT===\n' + JSON.stringify(state.encPackage) + '\n===END ENCRYPTED REPORT===';
      } catch (err) {
        body += `\n\n（加密校验生成失败：${err.message}，已忽略）`;
      }
    }
    return body;
  }

  function mailSubject() {
    const name = ($('#cand-name').value || '候选人').trim();
    const total = state.report ? fmt(state.report.total, 1) : '';
    return `【Interview Arena】${name} 的面试评估报告${total ? `（${total} 分）` : ''}`;
  }

  async function refreshMailPreview() {
    if (!state.report) return;
    const includeEnc = $('#mail-include-enc').checked;
    const body = buildPlainReport(state.report);
    const note = includeEnc ? '\n\n（发送时会自动在末尾附带加密密文）' : '';
    $('#mail-preview').value = body + note;
    const chars = body.length;
    $('#mail-status').textContent = `正文约 ${chars} 字${includeEnc ? ' + 加密密文' : ''}；`
      + (chars > 1600 ? '较长，建议用「下载 .eml」避免邮件客户端截断。' : '可直接跳转邮件客户端。');
  }

  async function openMail() {
    if (!state.report) { toast('请先生成评估报告'); return; }
    const btn = $('#btn-mail');
    btn.disabled = true; btn.textContent = '准备邮件…';
    try {
      const body = await buildMailBody($('#mail-include-enc').checked);
      const url = `mailto:${MAIL_TO}?subject=${encodeURIComponent(mailSubject())}&body=${encodeURIComponent(body)}`;
      if (url.length > 2000) toast('正文较长：若邮件客户端截断，请改用「下载 .eml」');
      window.location.href = url;
      $('#mail-status').textContent = `已打开邮件客户端（收件人 ${MAIL_TO}）。若没有反应，请用「下载 .eml」。`;
    } catch (err) {
      toast(`准备邮件失败：${err.message}`);
    } finally {
      btn.disabled = false; btn.textContent = '打开邮件客户端（跳转）';
    }
  }

  async function downloadEml() {
    if (!state.report) { toast('请先生成评估报告'); return; }
    const btn = $('#btn-eml');
    btn.disabled = true; btn.textContent = '生成中…';
    try {
      const body = await buildMailBody($('#mail-include-enc').checked);
      const subjectEnc = `=?UTF-8?B?${utf8B64(mailSubject())}?=`;
      const bodyB64 = utf8B64(body).replace(/(.{76})/g, '$1\r\n');
      const eml = [
        `To: ${MAIL_TO}`,
        `Subject: ${subjectEnc}`,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        bodyB64,
      ].join('\r\n');
      const blob = new Blob([eml], { type: 'message/rfc822' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `Interview-Arena-${($('#cand-name').value || '候选人').trim()}-${Date.now()}.eml`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      $('#mail-status').textContent = '已下载 .eml：双击用邮件客户端打开，确认后点发送。';
    } catch (err) {
      toast(`生成 .eml 失败：${err.message}`);
    } finally {
      btn.disabled = false; btn.textContent = '下载 .eml 邮件文件';
    }
  }

  async function copyMailBody() {
    if (!state.report) { toast('请先生成评估报告'); return; }
    try {
      const body = await buildMailBody(false);
      await navigator.clipboard.writeText(`收件人：${MAIL_TO}\n主题：${mailSubject()}\n\n${body}`);
      toast('已复制：收件人 + 主题 + 正文');
    } catch (_) {
      $('#mail-preview').select();
      document.execCommand('copy');
      toast('已复制（兼容模式）');
    }
  }

  /* ---------------- 步骤控制 ---------------- */
  function goStep(n) {
    if (n === 2) {
      const mcq = mcqScore();
      if (!mcq.complete) { toast('请先完成 4 道选择题'); return; }
      $('#intro-text').value = state.intro;
    }
    if (n === 3 && state.introScore === null) {
      // 允许跳过自我介绍，但给出提示
      if (state.intro && !confirm('自我介绍尚未评分，仍要进入问答吗？')) return;
    }
    if (n === 4) renderReport();
    $$('.step').forEach((el) => el.classList.add('hidden'));
    $(`#step${n}`).classList.remove('hidden');
    $$('.stepper li').forEach((li) => {
      const s = Number(li.dataset.step);
      li.classList.toggle('active', s === n);
      li.classList.toggle('done', s < n);
    });
    $('#progress-bar').style.width = `${n * 25}%`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetAll() {
    if (!confirm('会清空本次填写的答案、自我介绍与问答，确定吗？')) return;
    localStorage.removeItem(DRAFT_KEY);
    state.answers = {}; state.intro = ''; state.introScore = null;
    state.qa = []; state.qaScore = null; state.report = null; state.encPackage = null;
    state.role = 'auto';
    if ($('#cand-role')) $('#cand-role').value = 'auto';
    $$('.role-card').forEach((c) => c.classList.remove('selected'));
    $('#intro-text').value = '';
    $('#intro-count').textContent = '0 / 3000';
    $('#intro-result').classList.add('hidden');
    $('#qa-list').innerHTML = ''; $('#qa-result').classList.add('hidden');
    $('#qa-submit-row').classList.add('hidden');
    $('#report').innerHTML = ''; $('#enc-output').value = '';
    $('#mail-preview').value = ''; $('#mail-status').textContent = '';
    ['#btn-copy', '#btn-download', '#btn-mail-enc'].forEach((s) => { $(s).disabled = true; });
    renderMCQ();
    goStep(1);
    toast('已重置');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    // 设置
    const s = getSettings();
    $('#cfg-base').value = s.baseUrl;
    $('#cfg-model').value = s.model;
    $('#cfg-key').value = s.apiKey;
    $('#cfg-status').textContent = s.apiKey ? '已配置（仅存本机）' : '未配置（将使用本地规则评分）';

    $('#btn-settings').addEventListener('click', () => $('#settings').classList.toggle('hidden'));
    $('#btn-settings-close').addEventListener('click', () => $('#settings').classList.add('hidden'));
    $('#btn-settings-save').addEventListener('click', () => {
      const cfg = {
        baseUrl: $('#cfg-base').value.trim() || 'https://api.deepseek.com',
        model: $('#cfg-model').value.trim() || 'deepseek-chat',
        apiKey: $('#cfg-key').value.trim(),
      };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg));
      $('#cfg-status').textContent = cfg.apiKey ? '已保存（仅存本机）' : '已保存（无 Key，本地评分）';
      toast('设置已保存');
    });
    $('#btn-settings-clear').addEventListener('click', () => {
      localStorage.removeItem(SETTINGS_KEY);
      $('#cfg-key').value = ''; $('#cfg-status').textContent = '已清除 Key';
      toast('已清除本机保存的 Key');
    });

    $('#btn-to-step2').addEventListener('click', () => goStep(2));

    // 自我介绍
    const intro = $('#intro-text');
    intro.addEventListener('input', () => {
      state.intro = intro.value;
      $('#intro-count').textContent = `${intro.value.length} / 3000`;
      saveDraft();
    });
    $('#btn-score-intro').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      state.intro = intro.value;
      btn.disabled = true; btn.textContent = '评分中…';
      try {
        state.introScore = await scoreIntro(state.intro);
        renderIntroResult(state.introScore);
      } catch (err) {
        console.error(err);
        toast(`评分失败：${err.message}`);
      } finally {
        btn.disabled = false; btn.textContent = '重新评分';
      }
    });
    $('#btn-to-step3').addEventListener('click', () => goStep(3));

    // 问答
    $('#btn-gen-qa').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '生成中…';
      $('#qa-status').textContent = hasAI() ? '正在调用 AI…' : '';
      try {
        const qs = await genQuestions(state.intro || intro.value);
        renderQA(qs);
        $('#qa-status').textContent = hasAI() ? '已由 AI 生成' : '固定 4 题（未配置 Key）';
      } catch (err) {
        console.error(err);
        toast(`生成失败：${err.message}，已改用固定 4 题`);
        renderQA(FALLBACK_QA);
      } finally {
        btn.disabled = false; btn.textContent = '重新生成 4 个追问';
      }
    });

    // 报告页：跳转邮件（正文含分数与回答）
    $('#btn-mail').addEventListener('click', openMail);
    $('#btn-eml').addEventListener('click', downloadEml);
    $('#btn-copy-mail').addEventListener('click', copyMailBody);
    $('#mail-include-enc').addEventListener('change', () => { if (state.report) refreshMailPreview(); });

    // 可选：只发送加密报告
    $('#btn-encrypt').addEventListener('click', onEncrypt);
    $('#btn-copy').addEventListener('click', copyEnc);
    $('#btn-download').addEventListener('click', downloadEnc);
    $('#btn-mail-enc').addEventListener('click', mailEnc);

    $('#btn-restart').addEventListener('click', resetAll);

    // 防误关
    window.addEventListener('beforeunload', (e) => {
      if (state.qaScore || state.introScore) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  /* ---------------- 启动 ---------------- */
  const DEMO_INTRO = '我叫小林，目前在湖南一所高校读农业工程硕士。过去一年我负责一个设施草莓菌剂配套装置的硬件部分：从选型、打样到三套样机落地，把单点成本从 320 元压到 210 元。我们和两个合作社做了 12 户访谈，其中 8 户愿意按 199 元/亩试用。我最大的短板是农艺知识不够，正在跟导师补土壤学；接下来想把试验数据做成可复用的标定曲线。';
  const DEMO_ANSWERS = [
    '当时最大的阻碍是传感器在棚内漂移，我用了双传感器取中值加 4 周复核的办法把误差压下来。',
    '如果重来一次，我会先把阈值标定做完再做样机，而不是边做边改，这样能省两周。',
    '成本下降主要是我负责的选型与结构改动；农户愿意试用更多是合作社理事长推动的，不能全算我的。',
    '前 90 天我想先完成 3 个示范点的布设与第一批第 7/15 天活菌数数据，并沉淀一版标定流程。',
  ];

  function runDemo() {
    state.answers = {};
    const demoPicks = { q1: 1, q2: 0, q3: 1, q4: 1 };
    state.data.questions.forEach((q) => { state.answers[q.id] = demoPicks[q.id] ?? 1; });
    state.intro = DEMO_INTRO;
    // 演示评分：模拟一次真实 AI 评分的结果（虚假样例，仅用于展示报告形态）
    state.introScore = {
      dimensions: {
        structure: { score: 18, reason: '"硕士—负责硬件—成本下降—短板与计划"脉络清楚，四段完整' },
        specificity: { score: 21, reason: '"320 元压到 210 元""12 户访谈、8 户愿试用"等数字可追问' },
        selfAwareness: { score: 16, reason: '主动承认农艺知识不足并给出补法，但未量化改进目标' },
        roleFit: { score: 16, reason: '农业工程背景与农业硬件研发匹配，但未直接对应目标岗位技术栈' },
      },
      total: 71,
      highlights: ['成本与访谈数据具体，可信度高', '主动暴露短板，具备成长型心态'],
      risks: ['未说明个人在团队中的独立贡献边界', '岗位技术栈对应关系不够明确'],
      suggestions: ['补一句"我独立负责哪部分、与他人如何分工"', '把下一步计划写成可验证的 90 天目标'],
      mode: 'demo',
    };
    state.qa = FALLBACK_QA.map((x, i) => ({ ...x, answer: DEMO_ANSWERS[i] }));
    state.qaScore = {
      scores: [
        { index: 0, score: 19, reason: '定位到"传感器漂移"这一具体阻碍，并给出双传感器+复核的解法' },
        { index: 1, score: 17, reason: '反思到"先标定再打样"的流程顺序问题，可复用到下一个项目' },
        { index: 2, score: 20, reason: '主动区分个人贡献与理事长推动，归因诚实' },
        { index: 3, score: 18, reason: '90 天目标有可验证指标（3 个示范点、第 7/15 天数据）' },
      ],
      overall: 74,
      suggestions: ['追问 2 可再补一句"省下来的两周具体做了什么"', '把 90 天目标加上验收标准与负责人'],
      mode: 'demo',
    };
    $('#cand-name').value = '演示候选人';
    $('#cand-role').value = 'hardware';
    state.role = 'hardware';
    $$('.role-card').forEach((c) => c.classList.toggle('selected', c.dataset.role === 'hardware'));
    renderMCQ();
    $('#intro-text').value = state.intro;
    $('#intro-count').textContent = `${state.intro.length} / 3000`;
    renderIntroResult(state.introScore);
    state.qaScore.mode = 'ai'; // 让点评页显示"AI 评分"样式（演示）
    renderQAResult(state.qaScore);
    state.qaScore.mode = 'demo';
    const banner = document.createElement('div');
    banner.className = 'card';
    banner.style.borderColor = 'var(--brand)';
    banner.innerHTML = '<b>演示模式</b>：以下为虚构样例数据，用于展示完整报告形态；正式使用时请从第 1 步开始作答。'
      + ' <a href="./">退出演示</a>';
    $('main').prepend(banner);
    goStep(4);
  }

  async function init() {
    try {
      seedSettingsFromUrl();
      state.data = await loadData();
      $('#disclaimer').textContent = state.data.disclaimer || '';
      restoreDraft();
      renderTeamAndRoles();
      renderMCQ();
      $('#intro-text').value = state.intro;
      $('#intro-count').textContent = `${state.intro.length} / 3000`;
      bind();
      let params = new URLSearchParams(location.search);
      if (params.get('settings') === '1') {
        $('#settings').classList.remove('hidden');
        const cfg = getSettings();
        $('#cfg-base').value = cfg.baseUrl;
        $('#cfg-model').value = cfg.model;
        $('#cfg-key').value = cfg.apiKey;
        $('#cfg-status').textContent = cfg.apiKey ? '已配置（仅存本机）' : '未配置（本地规则评分）';
      }
      const demo = params.get('demo') === '1';
      if (demo) { runDemo(); } else { goStep(1); }
    } catch (err) {
      console.error(err);
      $('#mcq-list').innerHTML = `<div class="card"><h3>加载失败</h3><p class="hint">无法读取题库（data/questions.json）。请通过 HTTP 打开本页，而不是直接双击 HTML 文件。</p></div>`;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
