// 金种子杯·菌护禾 招募站 —— 发信接口（Vercel Serverless Function）
// POST /api/send  { subject: string, text: string }
// 环境变量（在 Vercel 里配置，不要写进仓库）：
//   SMTP_USER = 2160634966@qq.com
//   SMTP_PASS = <QQ邮箱 SMTP 授权码>
//   MAIL_TO   = 2160634966@qq.com,2715240991@qq.com,355594812@qq.com
//   API_SECRET = 可选，前端会在 x-api-secret 里带上，用于挡掉随意调用

const nodemailer = require('nodemailer');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-api-secret',
};

module.exports = async function handler(req, res) {
  for (const [k, v] of Object.entries(CORS)) res.setHeader(k, v);

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method not allowed' });
    return;
  }

  // 简单口令，防止路人乱调
  const secret = process.env.API_SECRET;
  if (secret && req.headers['x-api-secret'] !== secret) {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }

  const subject = String(body.subject || '【金种子杯·菌护禾】面试结果');
  const text = String(body.text || '');
  if (!text || text.length < 20) {
    res.status(400).json({ ok: false, error: '缺少内容' });
    return;
  }
  // 只收我们生成的加密结果，避免当垃圾邮件中继
  if (text.indexOf('菌护禾') < 0 && text.indexOf('===BEGIN ANALYSIS===') < 0) {
    res.status(400).json({ ok: false, error: '内容格式不正确' });
    return;
  }

  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const recipients = (process.env.MAIL_TO || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!user || !pass || !recipients.length) {
    res.status(500).json({ ok: false, error: '服务端未配置 SMTP / 收件人' });
    return;
  }

  const transporter = nodemailer.createTransport({
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({
      from: `"金种子杯·菌护禾" <${user}>`,
      to: recipients.join(','),
      subject,
      text,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(502).json({ ok: false, error: String(e.message || e) });
  }
};
