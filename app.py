"""菌护禾 · 团队招募评估（Streamlit 版 v5）
5 题（2 通用 + 1 项目 + 2 方向专业）→ 自我介绍 → AI 真实多轮面试 → 评分
页面只展示分数；详细分析加密后发到团队邮箱（SMTP 未配置时可下载/复制密文）。
"""
from __future__ import annotations

import gzip
import io
import json
import os
import smtplib
import ssl
from base64 import b64decode, b64encode, urlsafe_b64decode
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

import requests
import streamlit as st
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

ROOT = Path(__file__).resolve().parent
DATA = json.loads((ROOT / "data" / "questions.json").read_text(encoding="utf-8"))
DIRECTIONS = {d["id"]: d for d in DATA["directions"]}
PUBLIC_JWK = json.loads((ROOT / "public_key.json").read_text(encoding="utf-8"))
DEFAULT_MAIL_TO = DATA.get("mailTo", ["2160634966@qq.com"])


def secret(name: str, default: str = "") -> str:
    try:
        return st.secrets[name]
    except Exception:
        return os.environ.get(name, default)


st.set_page_config(page_title="菌护禾 · 团队招募评估", page_icon="🌱", layout="centered")


def call_ai(messages: list[dict], json_mode: bool = True, max_tokens: int = 900, temperature: float = 0.4) -> str | dict:
    key = secret("DEEPSEEK_API_KEY")
    if not key:
        raise RuntimeError("NO_KEY")
    base = secret("AI_BASE_URL", "https://api.deepseek.com").rstrip("/")
    model = secret("AI_MODEL", "deepseek-flash")
    body = {"model": model, "messages": messages, "temperature": temperature, "max_tokens": max_tokens}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    res = requests.post(base + "/chat/completions", headers={"Authorization": f"Bearer {key}"}, json=body, timeout=60)
    res.raise_for_status()
    text = res.json()["choices"][0]["message"]["content"]
    if not json_mode:
        return text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise RuntimeError("AI 返回不是 JSON")


def encrypt_report(payload: dict) -> dict:
    import hashlib
    password = b"00000"
    salt = os.urandom(16)
    key = hashlib.pbkdf2_hmac("sha256", password, salt, 120000, dklen=32)
    raw = gzip.compress(json.dumps(payload, ensure_ascii=False).encode("utf-8"))
    iv = os.urandom(12)
    ct = AESGCM(key).encrypt(iv, raw, None)
    return {
        "v": 2,
        "alg": "A256GCM+PBKDF2+gzip",
        "mode": "full",
        "to": list(DEFAULT_MAIL_TO),
        "createdAt": datetime.now().isoformat(),
        "salt": b64encode(salt).decode(),
        "iv": b64encode(iv).decode(),
        "data": b64encode(ct).decode(),
    }


def send_email(pkg: dict, candidate: str, total: float) -> str:
    host = secret("SMTP_HOST")
    if not host:
        return "SMTP 未配置：请下载/复制密文后手动发送"
    user = secret("SMTP_USER")
    pwd = secret("SMTP_PASS")
    port = int(secret("SMTP_PORT", "465") or 465)
    msg = EmailMessage()
    msg["Subject"] = f"【菌护禾】{candidate} 的加密面试分析（{total:.1f} 分）"
    msg["From"] = user
    msg["To"] = ", ".join(DEFAULT_MAIL_TO)
    msg.set_content(
        "菌护禾 · 加密面试分析\n\n"
        f"同学：{candidate}\n综合分：{total:.1f} / 100\n生成时间：{datetime.now():%Y-%m-%d %H:%M}\n\n"
        "详细分析已加密，请用团队私钥在 /decrypt.html 解密：\n"
        "===BEGIN ENCRYPTED ANALYSIS===\n"
        + json.dumps(pkg, ensure_ascii=False)
        + "\n===END ENCRYPTED ANALYSIS===\n"
    )
    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as s:
        s.login(user, pwd)
        s.send_message(msg)
    return "已发送到：" + "、".join(DEFAULT_MAIL_TO)


def dim_keys() -> list[str]:
    return list(DATA["dimensions"].keys())


def questions(direction_id: str) -> list[dict]:
    d = DIRECTIONS[direction_id]
    return [*DATA["generalQuestions"], DATA["projectQuestion"], *d["roleQuestions"]]


def mcq_score(direction_id: str, answers: dict) -> dict:
    qs = questions(direction_id)
    dims = {k: 0 for k in dim_keys()}
    max_total = {k: 0 for k in dim_keys()}
    for q in qs:
        for k in dim_keys():
            max_total[k] += max(o["scores"].get(k, 0) for o in q["options"])
        oi = answers.get(q["id"])
        if oi is None:
            continue
        for k in dim_keys():
            dims[k] += q["options"][oi]["scores"].get(k, 0)
    percent = {k: (dims[k] / max_total[k] * 100 if max_total[k] else 0) for k in dim_keys()}
    total = sum(percent.values()) / len(percent)
    complete = all(answers.get(q["id"]) is not None for q in qs)
    return {"dims": dims, "percent": percent, "total": total, "complete": complete}


def compute_fit(percent: dict) -> list[dict]:
    out = []
    for d in DATA["directions"]:
        w = d.get("fitWeights", {})
        tw = sum(w.values()) or 1
        out.append({"id": d["id"], "name": d["name"], "score": round(sum(percent.get(k, 0) * v for k, v in w.items()) / tw, 1)})
    return sorted(out, key=lambda x: -x["score"])


def verdict_of(total: float) -> str:
    if total >= 80:
        return "强推荐进入下一轮"
    if total >= 65:
        return "推荐进入下一轮"
    if total >= 50:
        return "待定，建议补面"
    return "暂不建议推进"


def bar(label: str, value: float) -> None:
    st.progress(max(0.0, min(1.0, value / 100)), text=f"{label}：{value:.1f}")


# ------------------------------------------------------------------ session
st.session_state.setdefault("direction", "tech")
st.session_state.setdefault("answers", {})
st.session_state.setdefault("intro", "")
st.session_state.setdefault("intro_tries", 0)
st.session_state.setdefault("intro_score", None)
st.session_state.setdefault("chat", [])
st.session_state.setdefault("chat_scored", None)
st.session_state.setdefault("report", None)
st.session_state.setdefault("pkg", None)

with st.sidebar:
    st.header("🌱 金种子杯 · 菌护禾")
    st.caption("情境测评 · 自我介绍 · AI 真实面试 · 评分")
    name = st.text_input("姓名 / 昵称", placeholder="同学")
    dir_id = st.selectbox("方向", list(DIRECTIONS), format_func=lambda x: DIRECTIONS[x]["name"], key="dir_sel")
    if dir_id != st.session_state["direction"]:
        st.session_state["direction"] = dir_id
        st.session_state["answers"] = {}
        st.session_state["chat"] = []
        st.session_state["chat_scored"] = None
        st.rerun()
    exp = st.selectbox("相关经验", ["0-1 年", "1-3 年", "3-5 年", "5 年以上"])
    st.divider()
    st.caption("AI：" + ("✅ 已配置" if secret("DEEPSEEK_API_KEY") else "⚠️ 未配置（本地规则）"))
    st.caption("邮件：" + ("✅ SMTP 已配置" if secret("SMTP_HOST") else "⚠️ 未配置 SMTP"))
    if st.button("清空本次数据", use_container_width=True):
        for k in ("answers", "intro", "intro_score", "chat", "chat_scored", "report", "pkg"):
            st.session_state[k] = [] if k == "chat" else ({} if k == "answers" else None)
        st.session_state["intro"] = ""
        st.rerun()

st.caption(f"**{DATA['team']['name']}**：{DATA['team']['positioning']}　｜　{DATA['team']['stage']}")
d = DIRECTIONS[dir_id]
st.info(f"当前方向：**{d['name']}** — {d['mission']}　要求：{'、'.join(d['mustHave'])}")

# ------------------------------------------------------------------ step 1
st.subheader("① 情境测评（5 题）")
answers = st.session_state["answers"]
for qi, q in enumerate(questions(dir_id)):
    st.markdown(f"**{qi + 1}. {q['tag']}** {q['title']}")
    opts = [o["text"] for o in q["options"]]
    cur = answers.get(q["id"])
    choice = st.radio("", opts, index=cur, key=f"q_{q['id']}", label_visibility="collapsed")
    answers[q["id"]] = opts.index(choice)

m = mcq_score(dir_id, answers)
st.caption(f"已作答 {sum(answers.get(q['id']) is not None for q in questions(dir_id))} / 5 题")

# ------------------------------------------------------------------ step 2
st.divider()
st.subheader("② 自我介绍（最多提交 3 次）")
intro = st.text_area("不限结构，想写什么就写什么；最多提交 3 次，取最好的一次。", value=st.session_state["intro"], height=220, max_chars=3000)
st.session_state["intro"] = intro
if st.button("提交并评分", type="primary", disabled=st.session_state["intro_tries"] >= 3):
    if len(intro.strip()) < 30:
        st.warning("至少 30 字")
    else:
        try:
            if secret("DEEPSEEK_API_KEY"):
                rubric = "\n".join(f"- {r['key']}（{r['label']}）：{r['desc']}" for r in DATA["introRubric"])
                prompt = f"""你是菌护禾团队的面试官。按 4 个维度给自我介绍打分（0–25/维度），只输出 JSON。
方向：{d['name']}；要求：{'、'.join(d['mustHave'])}
维度：
{rubric}
输出：{{"dimensions":{{"structure":{{"score":0,"reason":""}},"specificity":{{"score":0,"reason":""}},"selfAwareness":{{"score":0,"reason":""}},"roleFit":{{"score":0,"reason":""}}}},"total":0,"highlights":[],"risks":[],"suggestions":[]}}
要求：理由引用原文；total 为四维之和。
自我介绍：
{intro}"""
                out = call_ai(prompt)
                out["mode"] = "ai"
                out["total"] = max(0, min(100, int(out.get("total") or 0)))
            else:
                digits = len([c for c in intro if c.isdigit()])
                total = min(85, 45 + min(25, len(intro) // 20) + min(15, digits * 5))
                out = {"dimensions": {r["key"]: {"score": round(total / 4), "reason": "本地规则评分"} for r in DATA["introRubric"]},
                       "total": total, "highlights": [], "risks": [], "suggestions": [], "mode": "local"}
            st.session_state["intro_tries"] += 1
            if not st.session_state["intro_score"] or out["total"] > st.session_state["intro_score"]["total"]:
                st.session_state["intro_score"] = out
        except Exception as exc:
            st.error(f"评分失败：{exc}")

intro_score = st.session_state["intro_score"]
if intro_score:
    st.metric("自我介绍", f"{intro_score['total']} / 100", "AI" if intro_score.get("mode") == "ai" else "本地规则")
    for r in DATA["introRubric"]:
        bar(r["label"], intro_score.get("dimensions", {}).get(r["key"], {}).get("score", 0) * 4)

# ------------------------------------------------------------------ step 3
st.divider()
st.subheader("③ AI 真实面试")
rounds = DATA["chat"]["rounds"] * 1


def chat_system_prompt() -> str:
    return (
        DATA["chat"]["systemPrompt"]
        .replace("{direction}", d["name"])
        .replace("{team}", f"{DATA['team']['name']}：{DATA['team']['positioning']}（{DATA['team']['stage']}）")
        .replace("{mustHave}", "、".join(d["mustHave"]))
        .replace("{intro}", st.session_state["intro"] or "（未填写）")
        .replace("{rounds}", str(rounds))
    )


if not st.session_state["chat"]:
    if st.button("开始面试", type="primary"):
        st.session_state["chat"] = []
        st.session_state["chat_scored"] = None
        try:
            first = call_ai(
                [
                    {"role": "system", "content": chat_system_prompt()},
                    {"role": "user", "content": "请开始第 1 轮提问，只问一个问题。"},
                ],
                json_mode=False,
                max_tokens=300,
            )
        except Exception:
            first = DATA["chat"]["fallbackQuestions"][0]
        st.session_state["chat"].append({"role": "assistant", "content": first})
        st.rerun()

for msg in st.session_state["chat"]:
    with st.chat_message("assistant" if msg["role"] == "assistant" else "user"):
        st.write(msg["content"])

asked = sum(1 for x in st.session_state["chat"] if x["role"] == "assistant")
answer = st.chat_input("输入你的回答…", disabled=sum(1 for x in st.session_state["chat"] if x["role"] == "user") >= rounds)
if answer:
    st.session_state["chat"].append({"role": "user", "content": answer})
    try:
        messages = [{"role": "system", "content": chat_system_prompt()}] + [
            {"role": x["role"], "content": x["content"]} for x in st.session_state["chat"]
        ]
        nxt = call_ai(messages, json_mode=False, max_tokens=300)
    except Exception:
        nxt = DATA["chat"]["fallbackQuestions"][min(asked, len(DATA["chat"]["fallbackQuestions"]) - 1)]
    if asked + 1 >= rounds:
        nxt = nxt + "\n\n（已完成全部轮次，可以点击「结束面试并评分」。）"
    st.session_state["chat"].append({"role": "assistant", "content": nxt})
    st.rerun()

if st.session_state["chat"] and not st.session_state["chat_scored"]:
    if st.button("结束面试并评分", type="primary"):
        transcript = "\n\n".join(
            f"{'面试官' if x['role'] == 'assistant' else '候选人'}：{x['content']}" for x in st.session_state["chat"]
        )
        try:
            if secret("DEEPSEEK_API_KEY"):
                prompt = (
                    DATA["chat"]["scoringPrompt"]
                    .replace("{direction}", d["name"])
                    .replace("{mustHave}", "、".join(d["mustHave"]))
                    .replace("{intro}", st.session_state["intro"] or "（未填写）")
                    .replace("{transcript}", transcript)
                )
                out = call_ai(prompt, json_mode=True, temperature=0.2, max_tokens=2000)
                out["mode"] = "ai"
            else:
                avg = sum(len(x["content"]) for x in st.session_state["chat"] if x["role"] == "user") / max(1, rounds)
                out = {
                    "overall": min(100, int(45 + avg / 12) * 4),
                    "perQuestion": [{"round": i + 1, "score": 18, "comment": "本地规则评分"} for i in range(rounds)],
                    "strengths": [], "risks": [], "suggestions": [], "verdict": "本地规则评分", "mode": "local",
                }
            st.session_state["chat_scored"] = out
            st.rerun()
        except Exception as exc:
            st.error(f"打分失败：{exc}")

chat_scored = st.session_state["chat_scored"]
if chat_scored:
    st.metric("AI 面试", f"{chat_scored.get('overall', 0)} / 100", "AI" if chat_scored.get("mode") == "ai" else "本地规则")
    for i, s in enumerate(chat_scored.get("perQuestion", [])):
        st.progress(min(1.0, s["score"] / 25), text=f"第 {i + 1} 轮：{s['score']} / 25")

# ------------------------------------------------------------------ step 4
st.divider()
st.subheader("④ 评分")
if st.button("生成评分", type="primary"):
    if not m["complete"] or not st.session_state["intro_score"] or not st.session_state["chat_scored"]:
        st.warning("请先完成 5 道题、自我介绍评分与 AI 面试评分")
    else:
        parts = [("情境测评", m["total"], DATA["weights"]["mcq"]),
                 ("自我介绍", st.session_state["intro_score"]["total"], DATA["weights"]["intro"]),
                 ("AI 面试", st.session_state["chat_scored"]["overall"], DATA["weights"]["chat"])]
        wsum = sum(p[2] for p in parts) or 1
        total = sum(p[1] * p[2] for p in parts) / wsum
        report = {
            "candidate": {"name": name or "匿名候选人", "direction": d["name"], "directionId": dir_id, "exp": exp},
            "scores": {
                "total": round(total, 1), "verdict": verdict_of(total),
                "parts": [{"name": p[0], "score": round(p[1], 1), "weight": p[2]} for p in parts],
                "dims": [{"label": DATA["dimensions"][k]["label"], "type": DATA["dimensions"][k]["type"], "value": round(m["percent"][k], 1)} for k in dim_keys()],
                "fit": compute_fit(m["percent"]),
                "chat": {"overall": st.session_state["chat_scored"]["overall"], "perQuestion": st.session_state["chat_scored"].get("perQuestion", []), "mode": st.session_state["chat_scored"].get("mode")},
            },
            "analysis": {
                "intro": {k: st.session_state["intro_score"].get(k) for k in ("total", "mode", "dimensions", "highlights", "risks", "suggestions")},
                "chat": {k: st.session_state["chat_scored"].get(k) for k in ("strengths", "risks", "suggestions", "verdict")},
            },
            "introText": st.session_state["intro"],
            "mcqAnswers": [{"q": q["title"], "answer": q["options"][answers[q["id"]]]["text"]} for q in questions(dir_id)],
            "transcript": st.session_state["chat"],
            "createdAt": datetime.now().isoformat(),
        }
        st.session_state["report"] = report
        st.session_state["pkg"] = encrypt_report(report)
        st.rerun()

report = st.session_state["report"]
if report:
    s = report["scores"]
    c1, c2 = st.columns([1, 2])
    c1.metric("综合评分", f"{s['total']} / 100", s["verdict"])
    with c2:
        for p in s["parts"]:
            st.progress(min(1.0, p["score"] / 100), text=f"{p['name']}：{p['score']}（权重 {round(p['weight'] / sum(x['weight'] for x in s['parts']) * 100)}%）")
    st.markdown("**四维画像**")
    for x in s["dims"]:
        bar(f"{x['label']}（{'能力' if x['type'] == 'ability' else '性格'}）", x["value"])
    st.markdown("**方向匹配**")
    for i, f in enumerate(s["fit"]):
        bar(("最匹配" if i == 0 else f"第 {i + 1}") + " · " + f["name"], f["score"])
    st.markdown("**AI 面试逐轮**")
    for i, x in enumerate(s["chat"]["perQuestion"]):
        bar(f"第 {i + 1} 轮", x["score"] * 4)
    st.caption("页面只展示分数；完整分析会随邮件发送给团队。")
    st.markdown("**面试完成，请把结果发送给团队：未发送将无法进入后续筛选，可能失去这次机会。**")
    pkg = st.session_state["pkg"]
    col1, col2 = st.columns(2)
    if col1.button("发送邮件给团队", type="primary"):
        try:
            st.success(send_email(pkg, report["candidate"]["name"], s["total"]))
        except Exception as exc:
            st.error(f"发送失败：{exc}")
    col2.download_button("下载邮件内容文件", data=json.dumps(pkg, ensure_ascii=False).encode(), file_name="菌护禾-面试结果.json", mime="application/json")

st.caption(DATA["disclaimer"])
