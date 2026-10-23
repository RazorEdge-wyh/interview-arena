# Interview Arena · AI 面试评估站

> 4 道情境题看能力与性格 → 自我介绍 AI 评分 → AI 追问再评分 → 分数**加密**发给面试官。
> 纯前端可跑（GitHub Pages），也可用 Streamlit 自托管（服务端发信）。

**在线体验**：https://razoredge-wyh.github.io/interview-arena/

[![Pages](https://img.shields.io/badge/GitHub%20Pages-online-brightgreen)](https://razoredge-wyh.github.io/interview-arena/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Python](https://img.shields.io/badge/python-3.9%2B-blue.svg)](https://www.python.org/)

---

## 1. 它解决什么问题

面试官想快速了解候选人，但常见做法有两个问题：要么靠感觉聊 30 分钟，要么让候选人做一份"没有标准、也没人看"的性格测试。

Interview Arena 把过程拆成四段，每段都有可解释的产出：

| 环节 | 做什么 | 产出 |
|---|---|---|
| ① 情境测评 | 4 道真实工作场景题（需求变更、数据归因、协作冲突、挫折恢复） | 能力/性格四维相对分 |
| ② 自我介绍 | 候选人写 250–500 字，AI 按 4 个维度逐条打分并给理由 | 0–100 + 亮点/风险/建议 |
| ③ AI 追问 | 根据自我介绍生成 4 个针对性追问，候选人作答后再评分 | 每题 0–25 + 点评 |
| ④ 加密发送 | 报告在浏览器内压缩 + AES-256-GCM 加密，AES 密钥再用 RSA-OAEP 公钥包裹 | 只有私钥持有者能解密 |

## 2. 三种用法

### A. 直接在线用（推荐，零部署）

打开 https://razoredge-wyh.github.io/interview-arena/

- 想用 AI：点右上「AI 设置」，填自己的 DeepSeek（或兼容 OpenAI 协议的）Key，存在本机 localStorage，不会上传。
- 不填 Key：自动降级为**本地规则评分**，页面会明确标注"本地规则评分（未调用 AI）"。

### B. 本地静态运行

```bash
git clone https://github.com/RazorEdge-wyh/interview-arena.git
cd interview-arena
python -m http.server 8000
# 打开 http://localhost:8000
```

> 不要直接双击 `index.html`（`fetch data/questions.json` 在 `file://` 下会被浏览器拦截）。

### C. Streamlit 自托管（可服务端自动发邮件）

```bash
pip install -r requirements.txt
streamlit run app.py
```

Streamlit Community Cloud：

1. New app → 选择本仓库 → Main file path 填 `app.py`
2. Settings → Secrets 粘贴 `.streamlit/secrets.toml.example` 的内容（AI Key + SMTP）
3. 部署后即可用；未配置 SMTP 时降级为页面展示加密结果 + 下载。

## 3. 加密与邮件

### 密钥

- 公钥：仓库里的 `public_key.json`（浏览器用它加密）
- 私钥：**不在仓库里**。本地生成后自己保管，例如：

```bash
python tools/gen_keys.py --out-public public_key.json --out-private ../_keys/interview_report_private.pem
```

> 想换密钥：重新生成，把新的 `public_key.json` 提交，旧报告需用旧私钥解密。

### 发送方式

| 方式 | 适用 | 说明 |
|---|---|---|
| 复制加密内容 | 任意 | 粘贴到邮件/微信发给面试官 |
| 下载 `.enc.json` | 任意 | 作为附件发送 |
| 邮件客户端（mailto） | 静态版 | 打开本机邮件客户端，收件人固定为面试官邮箱 |
| SMTP 自动发送 | Streamlit 版 | 配置 `SMTP_HOST/USER/PASS` 后一键发送到邮箱 |

默认收件箱：`2160634966@qq.com`（可在 Streamlit 侧栏或 `app.js` 顶部 `MAIL_TO` 修改）。

### 解密

```bash
python tools/decrypt_report.py report.enc.json --private-key ../_keys/interview_report_private.pem
```

输出为 JSON：候选人信息、总分与各模块分、四维画像、自我介绍评分、逐题问答点评、原始回答。

## 4. 评分口径

| 模块 | 权重 | 来源 |
|---|---|---|
| 能力性格测评（4 题） | 30% | 选项内置维度分，按各维理论最大值归一化 |
| 自我介绍 | 35% | AI 按 4 维度（结构/具体/自我认知/岗位匹配）各 0–25 |
| AI 追问 | 35% | AI 按 4 维度（具体/逻辑/反思/匹配）逐题 0–25，合计 0–100 |

- 缺失模块（如跳过自我介绍或问答）时，剩余权重自动归一化。
- 综合分区间：≥80 强推荐 / 65–79 推荐 / 50–64 待定 / <50 暂不建议推进。
- 详细 rubric 与自定义方法见 [docs/scoring.md](docs/scoring.md)。

> **合规声明**：本工具用于面试准备与自我评估，评分为规则 + AI 辅助生成，**不构成录用、淘汰或任何人事决策依据**。如用于真实招聘，请遵循当地个人信息保护法规并取得候选人同意。

## 5. 隐私

- 静态版：所有数据只在浏览器内存与 localStorage；不落库、不上传（除你自己填的 AI Key 调用 API 外）。
- 加密后才建议发送；明文回答不会离开浏览器。
- 详见 [docs/privacy.md](docs/privacy.md)。

## 6. 目录结构

```text
interview-arena/
├── index.html              # 静态版入口（GitHub Pages 根）
├── assets/app.js           # 流程、评分、AI 调用、加密
├── assets/styles.css
├── data/questions.json     # 题库 + 维度 + rubric + 权重（改这里即可换题）
├── public_key.json         # RSA 公钥（JWK，仅公钥）
├── app.py                  # Streamlit 版
├── requirements.txt
├── .streamlit/             # Streamlit 主题与 secrets 示例
├── tools/gen_keys.py       # 生成密钥对
├── tools/decrypt_report.py # 解密报告
├── docs/scoring.md
├── docs/privacy.md
└── LICENSE
```

## 7. 已知限制

1. **AI 评分有波动**：同一份自我介绍两次评分可能差 3–8 分，建议看维度与理由，不要只看总分。
2. **静态版不能服务端发信**：邮件由候选人本机客户端发出；若加密内容过长，`mailto` 可能被截断，请改用复制/下载。
3. **公钥加密 ≠ 身份认证**：报告可被任何拿到公钥的人生成，面试官需结合面试过程判断真实性。
4. **不要用公开 Key**：静态版把 Key 存在候选人浏览器里，只适合你自己的设备；给候选人用的公网版本请让候选人自带 Key，或用 Streamlit 版把 Key 放在服务端。
5. **题库可替换**：`data/questions.json` 是唯一数据源，改题后无需改代码（保持字段结构）。

## 8. 许可证

MIT，见 [LICENSE](LICENSE)。
