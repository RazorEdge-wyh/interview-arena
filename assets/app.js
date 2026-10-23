/* 金种子杯 · 菌护禾 · 团队招募评估（v6）
 * 项目介绍（可跳过）→ 5 题（2 通用 + 1 项目 + 2 方向专业）→ 自我介绍（最多 3 次）→ AI 真实多轮面试 → 评分
 * 页面只展示分数；完整分析随邮件发给团队
 */
(() => {
  'use strict';

  const DATA_URL = 'data/questions.json';
  const SETTINGS_KEY = 'ia_settings_v1';
  const DRAFT_KEY = 'ia_draft_v1';
  const DEFAULT_BASE = 'https://api.deepseek.com';
  const DEFAULT_MODEL = 'deepseek-flash';
  const MAX_INTRO_TRIES = 3;

  const state = {
    data: null,
    direction: 'tech',
    answers: {},
    intro: '',
    introScore: null,
    introTries: 0,
    chat: [],
    chatActive: false,
    chatScored: null,
    report: null,
    encPackage: null,
  };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const fmt = (n, d = 0) => (Number(n) || 0).toFixed(d).replace(/\.0$/, '');
  const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));

  function toast(msg, ms = 3000) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), ms);
  }

  /* ---------------- 配置 ---------------- */
  function getSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); } catch (_) {}
    const cfg = window.__IA_CONFIG__ || {};
    return {
      baseUrl: (s.baseUrl || cfg.baseUrl || DEFAULT_BASE).replace(/\/+$/, ''),
      model: s.model || cfg.model || DEFAULT_MODEL,
      apiKey: s.apiKey || cfg.apiKey || '',
    };
  }
  function hasAI() { return !!getSettings().apiKey; }

  /* ---------------- 数据 ---------------- */
  async function loadData() {
    const res = await fetch(DATA_URL + '?v=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  const dimKeys = () => Object.keys(state.data.dimensions);
  const dir = () => (state.data.directions || []).find((d) => d.id === state.direction) || state.data.directions[0];
  function questionsFor(directionId) {
    const d = (state.data.directions || []).find((x) => x.id === directionId) || state.data.directions[0];
    return [...state.data.generalQuestions, state.data.projectQuestion, ...d.roleQuestions];
  }

  /* ---------------- 渲染：项目介绍 ---------------- */
  function renderProjectIntro() {
    const p = state.data.projectIntro || {};
    if ($('#project-lead')) $('#project-lead').textContent = p.lead || '';
    if (!$('#project-intro')) return;
    $('#project-intro').innerHTML = (p.sections || []).map((s) => `
      <div class="report-block">
        <h3>${esc(s.h)}</h3>
        ${(s.p || []).map((x) => `<p>${esc(x)}</p>`).join('')}
      </div>`).join('');
  }

  /* ---------------- 渲染：团队 / 方向 / 题目 ---------------- */
  function renderTeam() {
    const t = state.data.team || {};
    if ($('#team-name')) $('#team-name').textContent = `${t.name || '菌护禾'} · 团队招募`;
    if ($('#team-track')) $('#team-track').textContent = t.track || '';
    if ($('#team-positioning')) $('#team-positioning').textContent = t.positioning || '';
    if ($('#team-stage')) $('#team-stage').textContent = t.stage || '';
    if ($('#team-hiring-note')) $('#team-hiring-note').textContent = t.hiringNote || '';
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
    state.chat = [];
    state.chatScored = null;
    state.chatActive = false;
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

  /* ---------------- 计分 ---------------- */
  function mcqScore() {
    const qs = questionsFor(state.direction);
    const dims = {};
    const maxTotal = {};
    dimKeys().forEach((k) => { dims[k] = 0; maxTotal[k] = 0; });
    qs.forEach((q) => {
      dimKeys().forEach((k) => { maxTotal[k] += Math.max(...q.options.map((o) => o.scores[k] || 0)); });
      const oi = state.answers[q.id];
      if (oi === undefined) return;
      dimKeys().forEach((k) => { dims[k] += q.options[oi].scores[k] || 0; });
    });
    const percent = {};
    dimKeys().forEach((k) => { percent[k] = maxTotal[k] ? (dims[k] / maxTotal[k]) * 100 : 0; });
    const complete = qs.every((q) => state.answers[q.id] !== undefined);
    const total = dimKeys().reduce((a, k) => a + percent[k], 0) / dimKeys().length;
    return { dims, percent, total, complete };
  }

  function computeFit(percent) {
    return (state.data.directions || []).map((d) => {
      const w = d.fitWeights || {};
      const tw = Object.values(w).reduce((a, b) => a + b, 0) || 1;
      const s = Object.keys(w).reduce((a, k) => a + (percent[k] || 0) * w[k], 0) / tw;
      return { id: d.id, name: d.name, score: s };
    }).sort((a, b) => b.score - a.score);
  }

  /* ---------------- AI 调用 ---------------- */
  async function callAI(messages, opts = {}) {
    const s = getSettings();
    if (!s.apiKey) throw new Error('NO_KEY');
    const body = { model: s.model, messages, temperature: opts.temperature ?? 0.4, max_tokens: opts.maxTokens ?? 900 };
    if (opts.json !== false) body.response_format = { type: 'json_object' };
    const res = await fetch(s.baseUrl + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`AI ${res.status}: ${t.slice(0, 160)}`);
    }
    const data = await res.json();
    const text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    if (opts.json !== false) {
      try { return JSON.parse(text); } catch (_) {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) return JSON.parse(m[0]);
        throw new Error('AI 返回不是 JSON');
      }
    }
    return text.trim();
  }
  const callChat = (messages, maxTokens = 500) => callAI(messages, { json: false, temperature: 0.6, maxTokens });

  /* ---------------- 自我介绍 ---------------- */
  function heuristicIntro(text) {
    const len = text.trim().length;
    const digits = (text.match(/\d+/g) || []).length;
    const dimensions = {
      structure: { score: Math.round(clamp(40 + Math.min(30, Math.round(len / 20)), 0, 85) / 4), reason: '本地规则评分（仅供参考）' },
      specificity: { score: Math.round(clamp(30 + Math.min(40, digits * 8), 0, 85) / 4), reason: '本地规则评分（仅供参考）' },
      selfAwareness: { score: Math.round((/反思|学到|不足|改进|下次/.test(text) ? 70 : 45) / 4), reason: '本地规则评分（仅供参考）' },
      roleFit: { score: Math.round((/(试验|样机|传感器|数据|合作社|农户|田间|代码|发酵|销售|渠道|运营|申报)/.test(text) ? 68 : 48) / 4), reason: '本地规则评分（仅供参考）' },
    };
    const total = Math.round(Object.values(dimensions).reduce((a, d) => a + d.score, 0) * 4 / 4);
    return { dimensions, total, mode: 'local', highlights: [], risks: [], suggestions: [] };
  }

  async function scoreIntro(text) {
    if (!text || text.trim().length < 30) throw new Error('至少写 30 字');
    const d = dir();
    if (!hasAI()) { toast('AI 暂不可用，使用本地规则评分'); return heuristicIntro(text); }
    const rubric = state.data.introRubric.map((r) => `- ${r.key}（${r.label}）：${r.desc}`).join('\n');
    const prompt = `你是菌护禾团队的面试官。请按 4 个维度给这位同学的自我介绍打分（每维 0–25 分），只输出 JSON。
团队：${state.data.team.name}——${state.data.team.positioning}（湖南科技大学学生团队）
方向：${d.name}。要求：${(d.mustHave || []).join('、')}
维度：
${rubric}

输出格式：
{"dimensions":{"structure":{"score":0,"reason":"引用原文依据"},"specificity":{"score":0,"reason":""},"selfAwareness":{"score":0,"reason":""},"roleFit":{"score":0,"reason":""}},"total":0,"highlights":["2-3条"],"risks":["2-3条"],"suggestions":["2-3条改进"]}
要求：分数克制、理由引用原文关键词；total = 四维之和（0–100）；不要输出 JSON 以外内容。

同学：${$('#cand-name').value || '同学'}；方向 ${d.name}；${$('#cand-exp').value}
自我介绍：
${text}`;
    const out = await callAI([
      { role: 'system', content: '你是严格但公正的面试官，只输出合法 JSON。' },
      { role: 'user', content: prompt },
    ]);
    const dims = out.dimensions || {};
    const total = clamp(Math.round(Number(out.total) || Object.values(dims).reduce((a, x) => a + (Number(x && x.score) || 0), 0)), 0, 100);
    return { ...out, total, mode: 'ai' };
  }

  function renderIntroResult(r) {
    const box = $('#intro-result');
    box.classList.remove('hidden');
    box.innerHTML = `
      <h3>自我介绍评分 <span class="verdict">${fmt(r.total)} / 100 · ${r.mode === 'ai' ? 'AI 评分' : '本地规则评分'}</span></h3>
      ${state.data.introRubric.map((x) => bar(x.label, ((r.dimensions && r.dimensions[x.key] && r.dimensions[x.key].score) || 0) * 4)).join('')}
      <p class="note">这只是分数；完整分析会随邮件发送给团队。</p>`;
    refreshIntroButton();
  }

  function refreshIntroButton() {
    const left = MAX_INTRO_TRIES - state.introTries;
    const btn = $('#btn-score-intro');
    if (!btn) return;
    if (state.introTries >= MAX_INTRO_TRIES) {
      btn.disabled = true;
      btn.textContent = '已提交 3 次（不可再改）';
      $('#intro-tries').textContent = '已用完 3 次提交机会，可以进入下一步。';
    } else {
      btn.disabled = false;
      btn.textContent = `提交并评分（第 ${state.introTries + 1} / ${MAX_INTRO_TRIES} 次）`;
      $('#intro-tries').textContent = `还可以提交 ${left} 次；取最好的一次成绩。`;
    }
  }

  /* ---------------- 聊天（AI 面试） ---------------- */
  function chatPromptReplace(tpl) {
    const d = dir();
    return tpl
      .replace(/\{direction\}/g, d.name)
      .replace(/\{team\}/g, `${state.data.team.name}：${state.data.team.positioning}（${state.data.team.stage}）`)
      .replace(/\{mustHave\}/g, (d.mustHave || []).join('、'))
      .replace(/\{intro\}/g, state.intro || '（未填写）')
      .replace(/\{rounds\}/g, String(state.data.chat.rounds));
  }

  function renderChatLog() {
    const box = $('#chat-log');
    box.innerHTML = state.chat.map((m) => `
      <div class="chat-msg ${m.role === 'assistant' ? 'assistant' : 'user'}">
        <div class="chat-who">${m.role === 'assistant' ? '面试官' : '我'}</div>
        <div class="chat-text">${esc(m.content).replace(/\n/g, '<br>')}</div>
      </div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  const questionCount = () => state.chat.filter((m) => m.role === 'assistant' && m.round).length;
  const answerCount = () => state.chat.filter((m) => m.role === 'user').length;
  const pushAssistant = (text, round) => state.chat.push({ role: 'assistant', content: text, round: round || null });
  const setChatStatus = (t) => { $('#chat-status').textContent = t; };
  function enableChatInput(on) {
    $('#chat-input').disabled = !on;
    $('#btn-send-chat').disabled = !on;
    if (on) $('#chat-input').focus();
  }

  async function startChat() {
    if (state.chatActive) return;
    state.chat = [];
    state.chatScored = null;
    state.chatActive = true;
    $('#btn-start-chat').disabled = true;
    $('#btn-finish-chat').disabled = false;
    $('#chat-result').classList.add('hidden');
    renderChatLog();
    enableChatInput(false);
    setChatStatus('AI 面试官正在准备…');
    const rounds = state.data.chat.rounds;
    try {
      if (!hasAI()) throw new Error('NO_KEY');
      const first = await callChat([
        { role: 'system', content: chatPromptReplace(state.data.chat.systemPrompt) },
        { role: 'user', content: '请开始第 1 轮提问，只问一个问题。' },
      ]);
      pushAssistant(first, 1);
      renderChatLog();
      enableChatInput(true);
      setChatStatus(`第 1 / ${rounds} 轮`);
    } catch (err) {
      if (err.message === 'NO_KEY') toast('AI 暂不可用，使用固定问题');
      else toast(`AI 启动失败：${err.message}；改用固定问题`);
      pushAssistant(state.data.chat.fallbackQuestions[0], 1);
      renderChatLog();
      enableChatInput(true);
      setChatStatus(`第 1 / ${rounds} 轮（固定问题）`);
    }
  }

  async function sendChat() {
    if (!state.chatActive) return;
    const text = $('#chat-input').value.trim();
    if (!text) return;
    const rounds = state.data.chat.rounds;
    const answered = answerCount();
    if (answered >= rounds) return;
    state.chat.push({ role: 'user', content: text });
    $('#chat-input').value = '';
    renderChatLog();
    enableChatInput(false);

    const isLast = answered + 1 >= rounds;
    if (isLast) {
      setChatStatus('已完成全部轮次，请点击「结束面试并评分」');
      // 收尾（AI 可用时由 AI 说一句结束语，否则用固定收尾）
      try {
        if (!hasAI()) throw new Error('NO_KEY');
        const closing = await callChat([
          { role: 'system', content: chatPromptReplace(state.data.chat.systemPrompt) },
          ...state.chat.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: chatPromptReplace(state.data.chat.closingPrompt) },
        ], 300);
        pushAssistant(closing);
      } catch (_) {
        pushAssistant('好的，我的问题问完了，感谢你的回答。可以点击「结束面试并评分」。');
      }
      renderChatLog();
      state.chatActive = false;
      setChatStatus('已完成全部轮次，请点击「结束面试并评分」');
      return;
    }

    setChatStatus('面试官思考中…');
    try {
      if (!hasAI()) throw new Error('NO_KEY');
      const next = await callChat([
        { role: 'system', content: chatPromptReplace(state.data.chat.systemPrompt) },
        ...state.chat.map((m) => ({ role: m.role, content: m.content })),
      ]);
      pushAssistant(next, answered + 2);
      renderChatLog();
      enableChatInput(true);
      setChatStatus(`第 ${answered + 2} / ${rounds} 轮`);
    } catch (err) {
      const qs = state.data.chat.fallbackQuestions;
      const idx = Math.min(answered + 1, qs.length - 1);
      pushAssistant(qs[idx], answered + 2);
      renderChatLog();
      enableChatInput(true);
      setChatStatus(`第 ${answered + 2} / ${rounds} 轮（固定问题）`);
    }
  }

  function transcriptText() {
    return state.chat.map((m) => `${m.role === 'assistant' ? '面试官' : '同学'}：${m.content}`).join('\n\n');
  }

  async function finishChat() {
    if (!state.chat.length) { toast('还没有开始面试'); return; }
    if (state.chatScored) { goStep(5); return; }
    const btn = $('#btn-finish-chat');
    btn.disabled = true;
    setChatStatus('AI 正在打分…');
    try {
      let out;
      if (!hasAI()) {
        out = heuristicChat();
        toast('AI 暂不可用，使用本地规则打分');
      } else {
        const prompt = chatPromptReplace(state.data.chat.scoringPrompt).replace('{transcript}', transcriptText());
        out = await callAI([
          { role: 'system', content: '你是严格但公正的面试官，只输出合法 JSON。' },
          { role: 'user', content: prompt },
        ], { json: true, temperature: 0.2, maxTokens: 2000 });
        out.mode = 'ai';
      }
      state.chatScored = sanitizeChatScore(out);
      renderChatScore();
      setChatStatus('评分完成');
      setTimeout(() => goStep(5), 700);
    } catch (err) {
      console.error(err);
      setChatStatus('打分失败：' + err.message);
      btn.disabled = false;
      toast('打分失败，请重试');
    }
  }

  function sanitizeChatScore(out) {
    const per = Array.isArray(out.perQuestion) ? out.perQuestion : [];
    const scores = per.map((x, i) => ({
      round: Number(x.round) || i + 1,
      score: clamp(Math.round(Number(x.score) || 0), 0, 25),
      comment: String(x.comment || ''),
    }));
    const overall = clamp(Math.round(Number(out.overall) || scores.reduce((a, s) => a + s.score, 0)), 0, 100);
    return {
      overall, scores, mode: out.mode,
      strengths: Array.isArray(out.strengths) ? out.strengths.map(String) : [],
      risks: Array.isArray(out.risks) ? out.risks.map(String) : [],
      suggestions: Array.isArray(out.suggestions) ? out.suggestions.map(String) : [],
      verdict: String(out.verdict || ''),
    };
  }

  function heuristicChat() {
    const answered = answerCount();
    const avgLen = state.chat.filter((m) => m.role === 'user').reduce((a, m) => a + m.content.length, 0) / Math.max(1, answered);
    const per = clamp(Math.round((45 + Math.min(30, avgLen / 12)) / 4), 0, 25);
    return {
      overall: clamp(per * 4, 0, 100),
      perQuestion: Array.from({ length: answered }, (_, i) => ({ round: i + 1, score: per, comment: '本地规则评分（仅供参考）' })),
      strengths: [], risks: [], suggestions: [], verdict: '本地规则评分', mode: 'local',
    };
  }

  function renderChatScore() {
    const s = state.chatScored;
    const box = $('#chat-result');
    box.classList.remove('hidden');
    box.innerHTML = `
      <h3>AI 面试评分 <span class="verdict">${fmt(s.overall)} / 100 · ${s.mode === 'ai' ? 'AI 评分' : '本地规则评分'}</span></h3>
      ${s.scores.map((x) => bar(`第 ${x.round} 轮`, x.score * 4)).join('')}
      <p class="note">逐轮详细点评会随邮件发送给团队；这里只看分数。</p>`;
  }

  /* ---------------- 总分 ---------------- */
  function verdictOf(total) {
    if (total >= 80) return '强推荐进入下一轮';
    if (total >= 65) return '推荐进入下一轮';
    if (total >= 50) return '待定，建议再聊聊';
    return '暂不建议推进';
  }

  function buildReport() {
    const mcq = mcqScore();
    const parts = [];
    if (mcq.complete) parts.push({ key: 'mcq', name: '情境测评', score: mcq.total, weight: state.data.weights.mcq });
    if (state.introScore) parts.push({ key: 'intro', name: '自我介绍', score: state.introScore.total, weight: state.data.weights.intro });
    if (state.chatScored) parts.push({ key: 'chat', name: 'AI 面试', score: state.chatScored.overall, weight: state.data.weights.chat });
    const wsum = parts.reduce((a, p) => a + p.weight, 0) || 1;
    const total = parts.reduce((a, p) => a + p.score * (p.weight / wsum), 0);
    const dims = dimKeys().map((k) => ({
      key: k, label: state.data.dimensions[k].label, type: state.data.dimensions[k].type, value: mcq.percent[k] ?? 0,
    })).sort((a, b) => a.value - b.value);
    return {
      name: ($('#cand-name').value || '同学').trim(),
      direction: dir().name,
      directionId: state.direction,
      exp: $('#cand-exp').value,
      total: clamp(total, 0, 100),
      verdict: verdictOf(total),
      parts, dims,
      fit: computeFit(mcq.percent),
      intro: state.introScore,
      chat: state.chatScored,
      transcript: state.chat,
      introText: state.intro,
      mcqAnswers: questionsFor(state.direction).map((q) => ({
        q: q.title,
        answer: state.answers[q.id] !== undefined ? q.options[state.answers[q.id]].text : '（未作答）',
      })),
      createdAt: new Date().toISOString(),
      weightsUsed: wsum,
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
    const partsHtml = r.parts.map((p) => `<div class="stat"><b>${fmt(p.score, 1)}</b><span>${esc(p.name)} · 权重 ${Math.round((p.weight / r.weightsUsed) * 100)}%</span></div>`).join('');
    const dimsHtml = r.dims.map((d) => bar(`${d.label}（${d.type === 'ability' ? '能力' : '性格'}）`, d.value)).join('');
    const fit = r.fit.slice(0, 3).map((f, i) => bar(`${i === 0 ? '最匹配' : '第 ' + (i + 1)} · ${f.name}`, f.score)).join('');
    const chatScores = r.chat ? r.chat.scores.map((x, i) => bar(`第 ${x.round || i + 1} 轮`, x.score * 4)).join('') : '';
    $('#report').innerHTML = `
      <div class="big-score">
        <b>${fmt(r.total, 1)}</b><span>/ 100 综合评分</span>
        <span class="verdict">${esc(r.verdict)}</span>
      </div>
      <p class="hint">${esc(r.name)} · ${esc(r.direction)} · ${esc(r.exp)} · ${new Date(r.createdAt).toLocaleString('zh-CN')}</p>
      <div class="split">${partsHtml}</div>
      <h3>四维画像</h3>
      <div class="dim-grid">${dimsHtml}</div>
      <h3>方向契合</h3>
      <div class="dim-grid">${fit}</div>
      ${chatScores ? `<h3>AI 面试逐轮得分</h3><div class="dim-grid">${chatScores}</div>` : ''}
      <p class="note">这里只展示分数；完整分析会随邮件发送给团队。</p>`;
  }

  /* ---------------- 邮件（内容加密，页面不展示） ---------------- */
  function b64(bytes) {
    let s = '';
    const arr = new Uint8Array(bytes);
    for (let i = 0; i < arr.length; i += 0x8000) s += String.fromCharCode.apply(null, arr.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function gzipBytes(bytes) {
    if (typeof CompressionStream === 'undefined') return bytes;
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function encryptReport(report) {
    const publicJwk = await (await fetch('public_key.json', { cache: 'no-store' })).json();
    const pub = await crypto.subtle.importKey('jwk', publicJwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const payload = {
      v: 1, to: state.data.mailTo, createdAt: new Date().toISOString(),
      candidate: { name: report.name, direction: report.direction, directionId: report.directionId, exp: report.exp },
      scores: {
        total: Math.round(report.total * 10) / 10, verdict: report.verdict,
        parts: report.parts.map((p) => ({ name: p.name, score: Math.round(p.score * 10) / 10, weight: p.weight })),
        dims: report.dims.map((d) => ({ label: d.label, type: d.type, value: Math.round(d.value * 10) / 10 })),
        fit: report.fit.map((f) => ({ name: f.name, score: Math.round(f.score * 10) / 10 })),
        chat: report.chat ? { overall: report.chat.overall, perQuestion: report.chat.scores, mode: report.chat.mode } : null,
      },
      analysis: {
        intro: report.intro ? { total: report.intro.total, mode: report.intro.mode, dimensions: report.intro.dimensions, highlights: report.intro.highlights, risks: report.intro.risks, suggestions: report.intro.suggestions } : null,
        chat: report.chat ? { strengths: report.chat.strengths, risks: report.chat.risks, suggestions: report.chat.suggestions, verdict: report.chat.verdict } : null,
      },
      introText: report.introText,
      mcqAnswers: report.mcqAnswers,
      transcript: report.transcript,
    };
    const raw = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await gzipBytes(raw);
    const aesKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, compressed);
    const rawKey = await crypto.subtle.exportKey('raw', aesKey);
    const wrapped = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, rawKey);
    return { v: 1, alg: 'RSA-OAEP-256+A256GCM+gzip', to: state.data.mailTo, createdAt: payload.createdAt, key: b64(wrapped), iv: b64(iv), data: b64(ct) };
  }

  async function ensurePackage() {
    if (!state.report) renderReport();
    if (!state.encPackage) {
      state.report = buildReport();
      state.encPackage = await encryptReport(state.report);
    }
    return state.encPackage;
  }

  const recipients = () => (state.data.mailTo || []).join(',');
  function mailSubject() {
    const name = ($('#cand-name').value || '同学').trim();
    const total = state.report ? fmt(state.report.total, 1) : '';
    return `【金种子杯·菌护禾】${name} 的面试结果${total ? `（${total} 分）` : ''}`;
  }
  function mailBody(pkg) {
    const r = state.report || {};
    return `金种子杯 · 菌护禾 团队招募

同学：${r.name || ''}
方向：${r.direction || ''}
综合分：${fmt(r.total, 1)} / 100
生成时间：${new Date().toLocaleString('zh-CN')}

完整分析（仅供团队查看）如下：
===BEGIN ANALYSIS===
${JSON.stringify(pkg)}
===END ANALYSIS===
`;
  }

  async function openMail() {
    if (!state.report) { toast('请先完成评分'); return; }
    const btn = $('#btn-open-mail');
    btn.disabled = true; btn.textContent = '正在准备…';
    try {
      const pkg = await ensurePackage();
      const url = `mailto:${recipients()}?subject=${encodeURIComponent(mailSubject())}&body=${encodeURIComponent(mailBody(pkg))}`;
      if (url.length > 1800) toast('内容较长，邮件应用可能填不全收件人；建议用「发送邮件给团队（推荐）」');
      $('#mail-status').textContent = '已打开邮件客户端，请确认收件人后点发送。';
      window.location.href = url;
    } catch (err) {
      toast('准备邮件失败：' + err.message);
    } finally {
      btn.disabled = false; btn.textContent = '直接用邮件应用';
    }
  }

  async function downloadEml() {
    if (!state.report) { toast('请先完成评分'); return; }
    const btn = $('#btn-mail');
    btn.disabled = true;
    try {
      const pkg = await ensurePackage();
      const subjectEnc = '=?UTF-8?B?' + b64(new TextEncoder().encode(mailSubject())) + '?=';
      const bodyB64 = b64(new TextEncoder().encode(mailBody(pkg))).replace(/(.{76})/g, '$1\r\n');
      const eml = [
        `To: ${recipients()}`, `Subject: ${subjectEnc}`, 'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', bodyB64,
      ].join('\r\n');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
      a.download = `菌护禾-面试结果-${($('#cand-name').value || '同学').trim()}-${Date.now()}.eml`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
      $('#mail-status').textContent = '已生成邮件文件（收件人已填好）：双击下载的文件打开邮件应用，检查收件人后点发送即可。';
      toast('已生成邮件文件：双击打开 → 点发送');
    } catch (err) {
      toast('下载失败：' + err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function copyRecipients() {
    try {
      await navigator.clipboard.writeText(recipients());
      toast('已复制收件人：' + recipients());
    } catch (_) {
      toast('复制失败，请手动输入：' + recipients());
    }
  }

  async function copyCipher() {
    if (!state.report) { toast('请先完成评分'); return; }
    try {
      const pkg = await ensurePackage();
      await navigator.clipboard.writeText(mailBody(pkg));
      toast('已复制邮件内容，粘贴到邮件里发送即可');
    } catch (_) {
      toast('复制失败，请用「发送邮件给团队」');
    }
  }

  /* ---------------- 草稿 ---------------- */
  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        direction: state.direction, answers: state.answers, intro: state.intro, introTries: state.introTries,
      }));
    } catch (_) {}
  }
  function restoreDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      if (d && typeof d === 'object') {
        if (d.direction) state.direction = d.direction;
        if (d.answers) state.answers = d.answers;
        if (typeof d.intro === 'string') state.intro = d.intro;
        if (Number.isFinite(d.introTries)) state.introTries = d.introTries;
      }
    } catch (_) {}
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
      setTimeout(() => { const r = document.querySelector('#report'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function resetAll() {
    state.answers = {};
    state.intro = '';
    state.introScore = null;
    state.introTries = 0;
    state.chat = [];
    state.chatActive = false;
    state.chatScored = null;
    state.report = null;
    state.encPackage = null;
    try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
    $('#cand-name').value = '';
    $('#intro-text').value = '';
    $('#intro-count').textContent = '0 / 3000';
    $('#intro-result').classList.add('hidden');
    $('#chat-log').innerHTML = '';
    $('#chat-input').value = '';
    $('#chat-result').classList.add('hidden');
    $('#chat-status').textContent = '';
    $('#btn-start-chat').disabled = false;
    $('#btn-finish-chat').disabled = true;
    enableChatInput(false);
    renderMCQ();
    refreshIntroButton();
    goStep(1);
    toast('已重新开始');
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    $('#cand-name').addEventListener('input', saveDraft);
    $('#cand-exp').addEventListener('change', saveDraft);
    $('#intro-text').addEventListener('input', () => {
      state.intro = $('#intro-text').value;
      $('#intro-count').textContent = `${state.intro.length} / 3000`;
      saveDraft();
    });

    $('#btn-skip-intro').addEventListener('click', () => goStep(2));
    $('#btn-start-eval').addEventListener('click', () => goStep(2));
    $('#btn-to-step3').addEventListener('click', () => {
      if (!mcqScore().complete) { toast('还有题目没选'); return; }
      goStep(3);
    });
    $('#btn-score-intro').addEventListener('click', async (e) => {
      if (state.introTries >= MAX_INTRO_TRIES) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const r = await scoreIntro(state.intro);
        state.introTries += 1;
        if (!state.introScore || r.total > state.introScore.total) state.introScore = r;
        renderIntroResult(state.introScore);
        saveDraft();
        toast(`第 ${state.introTries} 次提交完成`);
      } catch (err) {
        toast('提交失败：' + err.message);
      } finally {
        refreshIntroButton();
      }
    });
    $('#btn-to-step4').addEventListener('click', () => {
      state.intro = $('#intro-text').value;
      saveDraft();
      goStep(4);
    });

    $('#btn-start-chat').addEventListener('click', startChat);
    $('#btn-send-chat').addEventListener('click', sendChat);
    $('#chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
    });
    $('#btn-finish-chat').addEventListener('click', finishChat);

    $('#btn-mail').addEventListener('click', downloadEml);
    $('#btn-open-mail').addEventListener('click', openMail);
    $('#btn-copy-mail').addEventListener('click', copyCipher);
    $('#btn-copy-to').addEventListener('click', copyRecipients);
    $('#btn-restart').addEventListener('click', resetAll);
  }

  async function init() {
    try {
      state.data = await loadData();
      $('#disclaimer').textContent = state.data.disclaimer || '';
      restoreDraft();
      renderProjectIntro();
      renderTeam();
      renderDirections();
      renderMCQ();
      $('#intro-text').value = state.intro;
      $('#intro-count').textContent = `${state.intro.length} / 3000`;
      refreshIntroButton();
      bind();
      const demo = new URLSearchParams(location.search).get('demo') === '1';
      if (demo) runDemo(); else goStep(1);
    } catch (err) {
      console.error(err);
      $('#mcq-list').innerHTML = `<div class="card"><h3>加载失败</h3><p class="hint">无法读取题库（data/questions.json）。请通过 HTTP 打开本页。</p></div>`;
    }
  }

  function runDemo() {
    state.direction = 'tech';
    $('#cand-direction').value = 'tech';
    markDirection();
    $('#cand-name').value = '演示同学';
    state.answers = {};
    questionsFor('tech').forEach((q, i) => { state.answers[q.id] = [1, 2, 1, 1, 2][i] || 1; });
    renderMCQ();
    state.intro = '我是湖南科技大学园艺专业大二学生，跟着老师做过草莓连作障碍的盆栽试验：3 个处理、3 次重复，第 7 天取根际土测活菌。我负责取样与平板计数，最后处理组比对照高约 0.8 个 log。这段经历让我学会把“感觉有效”变成可测指标。';
    $('#intro-text').value = state.intro;
    $('#intro-count').textContent = `${state.intro.length} / 3000`;
    state.introTries = 1;
    state.introScore = heuristicIntro(state.intro);
    state.chat = [
      { role: 'assistant', content: '你说做过草莓盆栽试验，能具体讲一下取样为什么取根表 1–2 mm 的土吗？', round: 1 },
      { role: 'user', content: '因为菌主要定殖在根表附近，取太远会稀释信号；我们每盆取 5 个点混匀，冰盒带回当天涂布。' },
      { role: 'assistant', content: '如果第 7 天计数发现处理组只高 0.2 个 log，你会先查什么？', round: 2 },
      { role: 'user', content: '先看重复间变异和计数方法的误差，再确认取样位置是否一致，之后才判断是不是真的没效果。' },
      { role: 'assistant', content: '你觉得自己加入这个项目最大的短板是什么？', round: 3 },
      { role: 'user', content: '硬件和传感器我只懂原理，动手少；打算先跟着把样机装一遍、学会标定。' },
      { role: 'assistant', content: '如果让你负责一个示范户，你会怎么开始？', round: 4 },
      { role: 'user', content: '先和农户确认他最在意的问题，再装一个点跑 7 天，用数据和他对齐预期。' },
      { role: 'assistant', content: '好的，我的问题问完了，感谢你的回答。可以点击「结束面试并评分」。' },
    ];
    state.chatScored = {
      overall: 74, mode: 'ai',
      scores: [
        { round: 1, score: 19, comment: '取样细节具体' },
        { round: 2, score: 20, comment: '先查方法误差，结论纪律好' },
        { round: 3, score: 17, comment: '短板坦诚但补法略笼统' },
        { round: 4, score: 18, comment: '先对齐农户关注点' },
      ],
      strengths: ['试验细节具体', '结论纪律好'], risks: ['硬件动手经验少'], suggestions: ['补一个 7 天样机日志'], verdict: '适合农艺与试验方向',
    };
    renderChatLog();
    $('#btn-start-chat').disabled = true;
    $('#btn-finish-chat').disabled = false;
    renderChatScore();
    goStep(5);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
