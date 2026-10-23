"""Interview Arena — Streamlit 版（自托管 / Streamlit Community Cloud）。

功能与静态版一致：4 道情境题 + 自我介绍 AI 评分 + AI 追问 + 加密报告邮件。
差异：AI Key 与 SMTP 放在服务端 secrets；评分与加密在服务端完成；可自动发邮件。

本地运行：
    pip install -r requirements.txt
    streamlit run app.py

Streamlit Cloud：
    1) 连接本仓库，主文件填 app.py
    2) Settings → Secrets 粘贴：
       DEEPSEEK_API_KEY = "sk-..."
       # 可选：邮件
       SMTP_HOST = "smtp.qq.com"
       SMTP_PORT = "465"
       SMTP_USER = "2160634966@qq.com"
       SMTP_PASS = "邮箱授权码"
       MAIL_TO   = "2160634966@qq.com"
"""
from __future__ import annotations

import base64
import gzip
import json
import os
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path

import requests
import streamlit as st
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent
QUESTIONS = json.loads((ROOT / "data" / "questions.json").read_text(encoding="utf-8"))
QUESTS_TEAM = QUESTIONS["team"]
QUESTS_ROLES = QUESTIONS["talentRoles"]
PUBLIC_JWK = json.loads((ROOT / "public_key.json").read_text(encoding="utf-8"))
DEFAULT_MAIL_TO = "2160634966@qq.com"
DIMS = QUESTIONS["dimensions"]
WEIGHTS = QUESTIONS["weights"]

st.set_page_config(page_title="Interview Arena · AI 面试评估站", page_icon="🧭", layout="wide")


# ---------------------------------------------------------------- helpers
def secret(key: str, default: str = "") -> str:
    try:
        val = st.secrets[key]
        return str(val)
    except Exception:
        return os.environ.get(key, default)


def b64e(data: bytes) -> str:
    return base64.b64encode(data).decode()


def jwk_to_public_key(jwk: dict) -> rsa.RSAPublicKey:
    def d(s: str) -> int:
        s += "=" * (-len(s) % 4)
        return int.from_bytes(base64.urlsafe_b64decode(s), "big")

    return rsa.RSAPublicNumbers(d(jwk["e"]), d(jwk["n"])).public_key()


def encrypt_report(payload: dict) -> dict:
    pub = jwk_to_public_key(PUBLIC_JWK)
    raw = gzip.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    aes_key = AESGCM.generate_key(bit_length=256)
    iv = os.urandom(12)
    ct = AESGCM(aes_key).encrypt(iv, raw, None)
    wrapped = pub.encrypt(
        aes_key,
        padding.OAEP(mgf=padding.MGF1(algorithm=hashes.SHA256()), algorithm=hashes.SHA256(), label=None),
    )
    return {
        "v": 1,
        "alg": "RSA-OAEP-256+A256GCM+gzip",
        "to": st.session_state.get("mail_to") or DEFAULT_MAIL_TO,
        "createdAt": __import__("datetime").datetime.now().isoformat(timespec="seconds"),
        "key": b64e(wrapped),
        "iv": b64e(iv),
        "data": b64e(ct),
    }


def call_ai(prompt: str, system: str = "你只输出合法 JSON。", max_tokens: int = 1400) -> dict:
    key = secret("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY")
    base = secret("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
    model = secret("DEEPSEEK_MODEL", "deepseek-chat")
    r = requests.post(
        f"{base}/chat/completions",
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        json={
            "model": model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": prompt}],
            "temperature": 0.25,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        },
        timeout=90,
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    content = content.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(content)


def heuristic_intro(text: str) -> dict:
    t = text.strip()
    num_hits = len(__import__("re").findall(r"\d+(?:\.\d+)?%?", t))
    structure = ["背景", "负责", "做过", "结果", "提升", "下降", "因为", "所以", "复盘", "接下来", "目标"]
    reflect = ["学到", "反思", "不足", "改进", "如果重来", "下次", "收获"]
    n = len(t)
    len_score = 3 if n < 120 else 7 if n < 220 else 11 if n < 320 else 15 if n < 450 else 18 if n < 700 else 21
    structure_score = min(25, len_score + sum(1 for w in structure if w in t) * 1.2)
    spec = min(25, num_hits * 3.2 + (4 if n >= 200 else 1))
    aware = min(25, 4 + sum(1 for w in reflect if w in t) * 3.2)
    fit = min(25, 5 + sum(1 for w in ["岗位", "希望", "擅长", "经验", "方向", "团队"] if w in t) * 2.4)
    total = round(structure_score + spec + aware + fit)
    return {
        "dimensions": {
            "structure": {"score": round(structure_score), "reason": f"长度 {n} 字"},
            "specificity": {"score": round(spec), "reason": f"数字出现 {num_hits} 处"},
            "selfAwareness": {"score": round(aware), "reason": "反思类表述"},
            "roleFit": {"score": round(fit), "reason": "岗位相关表述"},
        },
        "total": total,
        "highlights": ["已完成结构化表达"],
        "risks": ["本地规则评分只做粗筛"],
        "suggestions": ["补充 1–2 个可量化结果", "结尾补一句为什么是这个岗位"],
        "mode": "heuristic",
    }


def send_email(pkg: dict) -> tuple[bool, str]:
    host, port = secret("SMTP_HOST"), secret("SMTP_PORT", "465")
    user, pwd = secret("SMTP_USER"), secret("SMTP_PASS")
    to = st.session_state.get("mail_to") or DEFAULT_MAIL_TO
    if not (host and user and pwd):
        return False, "未配置 SMTP（SMTP_HOST / SMTP_USER / SMTP_PASS），请用下方下载或复制方式发送。"
    msg = EmailMessage()
    msg["Subject"] = f"【Interview Arena】加密评估报告 · {st.session_state.get('cand_name') or '候选人'}"
    msg["From"] = user
    msg["To"] = to
    body = json.dumps(pkg, ensure_ascii=False, indent=2)
    msg.set_content("Interview Arena 加密评估报告见附件（AES-256-GCM + RSA-OAEP），请用私钥解密。\n\n" + body[:1500])
    msg.add_attachment(body.encode("utf-8"), maintype="application", subtype="json",
                       filename=f"interview-report-{pkg['createdAt'].replace(':', '')}.enc.json")
    try:
        if str(port) == "465":
            with smtplib.SMTP_SSL(host, int(port), context=ssl.create_default_context(), timeout=30) as s:
                s.login(user, pwd)
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, int(port), timeout=30) as s:
                s.starttls(context=ssl.create_default_context())
                s.login(user, pwd)
                s.send_message(msg)
        return True, f"已发送到 {to}"
    except Exception as exc:  # pragma: no cover
        return False, f"发送失败：{exc}"


# ---------------------------------------------------------------- session state
st.session_state.setdefault("answers", {})
st.session_state.setdefault("intro", "")
st.session_state.setdefault("intro_score", None)
st.session_state.setdefault("qa", [])
st.session_state.setdefault("qa_score", None)
st.session_state.setdefault("report", None)
st.session_state.setdefault("pkg", None)
st.session_state.setdefault("mail_to", DEFAULT_MAIL_TO)
st.session_state.setdefault("cand_name", "")

with st.sidebar:
    st.header("🌱 菌护禾 · 团队招募")
    st.caption("田间情境 · 能力性格 · 表达追问 · 人岗匹配")
    st.session_state["cand_name"] = st.text_input("姓名 / 昵称", value=st.session_state["cand_name"], placeholder="候选人")
    role_options = ["auto"] + [r["id"] for r in QUESTS_ROLES]
    role_id = st.selectbox(
        "目标岗位",
        role_options,
        format_func=lambda x: "暂不确定（自动推荐）" if x == "auto" else next(r["name"] for r in QUESTS_ROLES if r["id"] == x),
    )
    role = "暂不确定" if role_id == "auto" else next(r["name"] for r in QUESTS_ROLES if r["id"] == role_id)
    role_ctx = (
        "候选目标岗位：暂不确定（请按四维画像给出 2 个最匹配的岗位建议）"
        if role_id == "auto"
        else (
            f"候选目标岗位：{role}。岗位使命："
            + next(r["mission"] for r in QUESTS_ROLES if r["id"] == role_id)
            + "；硬性要求："
            + "、".join(next(r["mustHave"] for r in QUESTS_ROLES if r["id"] == role_id))
        )
    )
    exp = st.selectbox("相关经验", ["0-1 年", "1-3 年", "3-5 年", "5 年以上"])
    st.session_state["mail_to"] = st.text_input("面试官邮箱", value=st.session_state["mail_to"])
    st.divider()
    st.caption("AI：" + ("✅ 已配置 Key" if secret("DEEPSEEK_API_KEY") else "⚠️ 未配置（本地规则评分）"))
    st.caption("邮件：" + ("✅ SMTP 已配置" if secret("SMTP_HOST") else "⚠️ 未配置 SMTP（可下载/复制）"))
    if st.button("清空本次数据", use_container_width=True):
        for k in ("answers", "intro", "intro_score", "qa", "qa_score", "report", "pkg"):
            st.session_state[k] = {} if k == "answers" else ([] if k == "qa" else None)
        st.session_state["intro"] = ""
        st.rerun()

st.title("菌护禾 · 团队招募评估")
st.caption(
    f"**{QUESTS_TEAM['name']}**：{QUESTS_TEAM['positioning']}　｜　{QUESTS_TEAM['stage']}"
)
with st.expander("我们在招什么人（6 个岗位）"):
    st.caption(QUESTS_TEAM["hiringNote"])
    for r in QUESTS_ROLES:
        st.markdown(f"**{r['name']}** — {r['mission']}")
        st.caption("硬性要求：" + "、".join(r["mustHave"]) + "　｜　面试关注：" + "、".join(r["interviewFocus"]))
st.caption("所有评分在本次会话内完成；发送方式见第 ④ 步。")

# ---------------------------------------------------------------- step 1
st.subheader("① 4 道情境题")
answers = st.session_state["answers"]
for qi, q in enumerate(QUESTIONS["questions"]):
    st.markdown(f"**第 {qi + 1} 题 · {q['tag']}**")
    opts = [o["text"] for o in q["options"]]
    idx = answers.get(q["id"])
    choice = st.radio("", opts, index=idx if idx is not None else None, key=f"mcq_{q['id']}",
                      label_visibility="collapsed")
    answers[q["id"]] = opts.index(choice) if choice in opts else None

mcq_complete = all(answers.get(q["id"]) is not None for q in QUESTIONS["questions"])


def mcq_score() -> dict:
    dims = {k: 0 for k in DIMS}
    max_total = {k: 0 for k in DIMS}
    for q in QUESTIONS["questions"]:
        for k in DIMS:
            max_total[k] += max(o["scores"].get(k, 0) for o in q["options"])
        oi = answers.get(q["id"])
        if oi is None:
            continue
        for k in DIMS:
            dims[k] += q["options"][oi]["scores"].get(k, 0)
    pct = {k: (dims[k] / max_total[k] * 100 if max_total[k] else 0) for k in DIMS}
    total = sum(pct.values()) / len(pct) if pct else 0
    return {"dims": dims, "percent": pct, "total": total, "complete": mcq_complete}


def role_fit(percent: dict) -> list[dict]:
    out = []
    for r in QUESTS_ROLES:
        w = r.get("fitWeights", {})
        tw = sum(w.values()) or 1
        score = sum(percent.get(k, 0) * v for k, v in w.items()) / tw
        out.append({"id": r["id"], "name": r["name"], "score": score})
    return sorted(out, key=lambda x: -x["score"])


# ---------------------------------------------------------------- step 2
st.divider()
st.subheader("② 自我介绍")
intro = st.text_area("自我介绍（建议 250–500 字：背景 → 做过什么 → 结果 → 反思）",
                     value=st.session_state["intro"], height=220, max_chars=3000)
st.session_state["intro"] = intro
if st.button("AI 评分自我介绍", type="primary"):
    if len(intro.strip()) < 30:
        st.warning("至少 30 字")
    else:
        try:
            if secret("DEEPSEEK_API_KEY"):
                rubric = "\n".join(f"- {r['key']}（{r['label']}）：{r['desc']}" for r in QUESTIONS["introRubric"])
                prompt = f"""你是菌护禾团队的面试官。按 4 个维度给候选人的自我介绍打分（0–25/维度），只输出 JSON。
团队：{QUESTS_TEAM['name']}——{QUESTS_TEAM['positioning']}；当前阶段：{QUESTS_TEAM['stage']}
{role_ctx}
维度：
{rubric}

输出格式：
{{"dimensions":{{"structure":{{"score":0,"reason":""}},"specificity":{{"score":0,"reason":""}},"selfAwareness":{{"score":0,"reason":""}},"roleFit":{{"score":0,"reason":""}}}},"total":0,"highlights":[],"risks":[],"suggestions":[]}}
要求：分数克制、理由引用原文；total 为四维之和（0–100）。

经验：{exp}
自我介绍：
{intro}"""
                out = call_ai(prompt)
                out["mode"] = "ai"
                out["total"] = max(0, min(100, int(out.get("total") or 0)))
            else:
                out = heuristic_intro(intro)
            st.session_state["intro_score"] = out
        except Exception as exc:
            st.error(f"AI 评分失败：{exc}；已退回本地规则评分")
            st.session_state["intro_score"] = heuristic_intro(intro)

intro_score = st.session_state["intro_score"]
if intro_score:
    st.metric("自我介绍得分", f"{intro_score['total']} / 100", "AI" if intro_score.get("mode") == "ai" else "本地规则")
    for r in QUESTIONS["introRubric"]:
        val = int(intro_score.get("dimensions", {}).get(r["key"], {}).get("score", 0))
        st.progress(val / 25, text=f"{r['label']}：{val} / 25")
    st.markdown("**亮点**")
    for x in intro_score.get("highlights", []):
        st.markdown(f"- ✅ {x}")
    st.markdown("**风险**")
    for x in intro_score.get("risks", []):
        st.markdown(f"- ⚠️ {x}")
    st.markdown("**建议**")
    for x in intro_score.get("suggestions", []):
        st.markdown(f"- → {x}")

# ---------------------------------------------------------------- step 3
st.divider()
st.subheader("③ AI 追问")
if st.button("生成 4 个追问"):
    try:
        if secret("DEEPSEEK_API_KEY"):
            prompt = f"""你是菌护禾团队的面试官。根据候选人的自我介绍生成 4 个追问，只输出 JSON：
{{"questions":[{{"q":"一句话问题（<=40字）","focus":"考察点"}}]}}
团队：{QUESTS_TEAM['name']}——{QUESTS_TEAM['positioning']}
{role_ctx}
要求：追问钩住自我介绍的具体细节，并结合岗位要求；覆盖动机/难点与解法/结果归因/岗位匹配。

自我介绍：
{intro or "（未填，按通用岗位追问）"}"""
            out = call_ai(prompt, max_tokens=700)
            qs = out.get("questions", [])[:4]
            st.session_state["qa"] = [{"q": x.get("q", ""), "focus": x.get("focus", ""), "answer": ""} for x in qs]
        else:
            st.session_state["qa"] = [
                {"q": "你最有代表性的项目，当时最大的阻碍是什么？怎么解决的？", "focus": "问题解决", "answer": ""},
                {"q": "如果重做一次，你会改变哪一个决定？", "focus": "复盘", "answer": ""},
                {"q": "你提到的结果里，哪些能直接归因于你？", "focus": "归因", "answer": ""},
                {"q": "这个岗位的前 90 天，你计划先做出什么可验证的结果？", "focus": "规划", "answer": ""},
            ]
    except Exception as exc:
        st.error(f"生成失败：{exc}")

qa_list = st.session_state["qa"]
if qa_list:
    for i, item in enumerate(qa_list):
        st.markdown(f"**追问 {i + 1}{(' · ' + item['focus']) if item.get('focus') else ''}**：{item['q']}")
        qa_list[i]["answer"] = st.text_area("", value=item["answer"], height=110, key=f"qa_{i}",
                                            label_visibility="collapsed", max_chars=1200)
    if st.button("提交问答并评分", type="primary"):
        answers_ok = all(len(x["answer"].strip()) >= 10 for x in qa_list)
        if not answers_ok:
            st.warning("请回答全部追问（每题至少 10 字）")
        else:
            try:
                if secret("DEEPSEEK_API_KEY"):
                    rubric = "\n".join(f"- {r['key']}（{r['label']}）：{r['desc']}" for r in QUESTIONS["qaRubric"])
                    prompt = f"""你是面试官。给 4 个追问回答打分（每题 0–25），只输出 JSON：
{{"scores":[{{"index":1,"score":0,"reason":""}}],"overall":0,"suggestions":[]}}
overall = 四题之和（0–100）；理由具体。

维度：
{rubric}

""" + "\n\n".join(f"【追问{i+1}】{x['q']}\n【回答】{x['answer']}" for i, x in enumerate(qa_list))
                    out = call_ai(prompt)
                    out["mode"] = "ai"
                else:
                    scores = []
                    for i, x in enumerate(qa_list):
                        n = len(x["answer"].strip())
                        sc = 4 if n < 20 else 10 if n < 60 else 15 if n < 120 else 19 if n < 220 else 21
                        scores.append({"index": i, "score": sc, "reason": f"长度 {n} 字"})
                    out = {"scores": scores, "overall": sum(s["score"] for s in scores),
                           "suggestions": ["补具体数字", "结尾加一句改进"], "mode": "heuristic"}
                st.session_state["qa_score"] = out
            except Exception as exc:
                st.error(f"评分失败：{exc}")

qa_score = st.session_state["qa_score"]
if qa_score:
    st.metric("问答得分", f"{qa_score['overall']} / 100", "AI" if qa_score.get("mode") == "ai" else "本地规则")
    for i, s in enumerate(qa_score.get("scores", [])):
        st.progress(min(1.0, s["score"] / 25), text=f"追问 {i + 1}：{s['score']} / 25 — {s.get('reason', '')}")

# ---------------------------------------------------------------- step 4
st.divider()
st.subheader("④ 评估报告与加密发送")
if st.button("生成评估报告", type="primary"):
    m = mcq_score()
    parts = []
    if m["complete"]:
        parts.append(("能力性格测评", m["total"], WEIGHTS["mcq"]))
    if intro_score:
        parts.append(("自我介绍", intro_score["total"], WEIGHTS["intro"]))
    if qa_score:
        parts.append(("AI 追问", qa_score["overall"], WEIGHTS["qa"]))
    wsum = sum(p[2] for p in parts) or 1
    total = sum(p[1] * p[2] for p in parts) / wsum
    verdict = "强推荐进入下一轮" if total >= 80 else "推荐进入下一轮" if total >= 65 else "待定，建议补面" if total >= 50 else "暂不建议推进"
    dims = sorted(
        [(DIMS[k]["label"], DIMS[k]["type"], m["percent"][k]) for k in DIMS],
        key=lambda x: x[2],
    )
    st.session_state["report"] = {
        "candidate": {"name": st.session_state["cand_name"] or "匿名候选人", "role": role, "roleId": role_id, "exp": exp},
        "total": round(total, 1), "verdict": verdict,
        "parts": [{"name": p[0], "score": round(p[1], 1), "weight": p[2]} for p in parts],
        "dims": [{"label": d[0], "type": d[1], "value": round(d[2], 1)} for d in dims],
        "roleFit": [{"id": f["id"], "name": f["name"], "score": round(f["score"], 1)} for f in role_fit(m["percent"])],
        "intro": intro_score, "qa": qa_score,
        "answers": [{"q": x["q"], "answer": x["answer"]} for x in qa_list],
        "introText": intro,
    }

report = st.session_state["report"]
if report:
    c1, c2 = st.columns([1, 2])
    c1.metric("综合评分", f"{report['total']} / 100", report["verdict"])
    with c2:
        for p in report["parts"]:
            st.progress(min(1.0, p["score"] / 100), text=f"{p['name']}：{p['score']}（权重 {round(p['weight'] / sum(x['weight'] for x in report['parts']) * 100)}%）")
    st.markdown("**四维画像（弱项优先追问）**")
    for d in report["dims"]:
        st.progress(min(1.0, d["value"] / 100), text=f"{d['label']}（{'能力' if d['type'] == 'ability' else '性格'}）：{d['value']}")
    st.markdown("**人岗匹配建议（按菌护禾 6 个岗位的能力侧重加权）**")
    for i, f in enumerate(report.get("roleFit", [])[:3]):
        mark = "（你的目标）" if f["id"] == report["candidate"].get("roleId") else ""
        st.progress(min(1.0, f["score"] / 100), text=f"{'最匹配' if i == 0 else '第 ' + str(i + 1)} · {f['name']}{mark}：{f['score']}")
    st.caption("若目标岗位不是第一匹配，建议面试时重点补该岗位要求的证据（试验 / 样机 / 渠道 / 登记经验）。")
    st.markdown("**面试官可追问**：" + "；".join(f"{d['label']}（{d['value']}）" for d in report["dims"][:2]))
    with st.expander("我的原始回答（仅本会话可见）"):
        st.json({"intro": report["introText"], "qa": report["answers"]})

    if st.button("🔐 加密并准备发送", type="primary"):
        try:
            pkg = encrypt_report(report)
            st.session_state["pkg"] = pkg
            ok, msg = send_email(pkg)
            st.success(msg) if ok else st.warning(msg)
        except Exception as exc:
            st.error(f"加密失败：{exc}")

pkg = st.session_state["pkg"]
if pkg:
    text = json.dumps(pkg, ensure_ascii=False, indent=2)
    st.text_area("加密报告（可复制粘贴到邮件/微信）", text, height=200)
    st.download_button("下载 .enc.json", text, file_name="interview-report.enc.json", mime="application/json")
    st.caption("解密：python tools/decrypt_report.py report.enc.json --private-key ../_keys/interview_report_private.pem")

st.caption(QUESTIONS["disclaimer"])
