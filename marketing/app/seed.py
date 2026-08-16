from __future__ import annotations

from .domain import score_topic


TOPICS = [
    ("free-trial-trap", "무료체험은 왜 꼭 결제로 끝날까", "생활경제", 91, 84, 3, 8, "low", "무료였는데 13개월째 돈이 나갑니다", "0원 버튼이 가장 비싼 이유"),
    ("delivery-minimum", "배달 최소주문이 지출을 키우는 방식", "소비심리", 88, 79, 4, 5, "low", "9천 원 먹으려다 2만 원 쓴 사람", "배달비 아끼려다 메뉴가 늘었습니다"),
    ("salary-account", "월급날에 돈이 가장 빨리 사라지는 이유", "돈관리", 86, 75, 4, 4, "low", "월급은 들어왔는데 왜 어제보다 가난할까요", "통장에 스쳐 간 월급의 행방"),
    ("used-market", "중고거래 가격 흥정의 심리", "관계/소비", 82, 73, 3, 6, "medium", "5천 원 깎아달라는 말에 거래를 접었습니다", "당근에서 가격보다 기분이 먼저 팔립니다"),
    ("wedding-gift", "결혼식 축의금 기준이 매번 어려운 이유", "관계/돈", 81, 70, 5, 9, "medium", "안 친한데 10만 원, 친한데 못 갔다면?", "축의금 봉투 앞에서 관계가 숫자가 됩니다"),
    ("coffee-subscription", "카페 구독이 절약이 되는 사람", "생활경제", 79, 68, 3, 12, "low", "커피 구독, 매일 마셔도 손해일 수 있습니다", "할인보다 출석이 먼저인 구독"),
    ("return-friction", "환불이 귀찮게 설계되는 이유", "행동경제", 78, 72, 4, 7, "low", "환불 버튼만 찾다가 포기한 적 있나요", "기업은 당신의 귀찮음을 압니다"),
    ("parking-choice", "주차비 아끼려다 시간을 더 쓰는 선택", "시간/돈", 76, 64, 3, 11, "low", "3천 원 아끼려고 40분을 썼습니다", "주차비와 내 시간, 뭐가 더 비쌀까요"),
    ("giftcard-balance", "상품권 잔액이 남는 이유", "소비심리", 74, 61, 3, 13, "low", "상품권 회사는 남은 700원을 기억합니다", "쓰고 남은 돈이 진짜 수익이 됩니다"),
    ("office-lunch", "직장인 점심 메뉴 결정 피로", "직장/생활", 73, 77, 2, 10, "low", "점심 고르는 데 회의보다 오래 걸렸습니다", "오늘도 결국 어제 먹던 걸 먹습니다"),
    ("phone-upgrade", "멀쩡한 휴대폰을 바꾸고 싶은 순간", "소비심리", 71, 60, 4, 14, "low", "배터리 82%가 새 폰을 부릅니다", "고장보다 신제품 발표가 먼저 옵니다"),
    ("friend-loan", "친구에게 돈을 빌려줄 때 생기는 문제", "관계/돈", 69, 58, 2, 18, "high", "친구를 잃기 싫어 돈을 빌려줬습니다", "차용증보다 어려운 한마디"),
]


def seed_demo(store):
    for i, (slug, title, category, demand, velocity, evidence, duplicate, risk, hook_a, hook_b) in enumerate(TOPICS):
        signals = dict(demand=demand, velocity=velocity, audience=86, utility=88-i,
                       emotion=75, curiosity=82, visual=80, monetization=45,
                       evidence=min(100, evidence*20), duplicate=duplicate,
                       risk={"low": 5, "medium": 20, "high": 45}[risk])
        store.upsert_topic(dict(slug=slug, title=title, category=category,
                                source="DEMO · 공개 신호 연결 전", score=score_topic(signals),
                                demand=demand, velocity=velocity, evidence_count=evidence,
                                duplicate_pct=duplicate, risk=risk, hook_a=hook_a, hook_b=hook_b,
                                status="research" if evidence < 3 else "candidate", live=0))
    with store.connect() as db:
        if db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0:
            jobs = [("free-trial-trap", "generating", "generating", "scene_06", 125.0),
                    ("delivery-minimum", "assembled", "assembled", "audio_done", 96.0),
                    ("salary-account", "queued", "queued", "start", 0.0),
                    ("used-market", "researched", "researched", "sources_checked", 0.0),
                    ("wedding-gift", "scripted", "scripted", "hook_b", 0.0)]
            db.executemany("INSERT INTO jobs(topic_slug,stage,status,checkpoint,cost,updated_at) VALUES(?,?,?,?,?,datetime('now'))", jobs)
            ids = [r[0] for r in db.execute("SELECT id FROM jobs").fetchall()]
            checks = [(ids[1], "caption_clip", 1, 1, "0 frames", "0"),
                      (ids[1], "silence", 1, 1, "0.11 sec", "<0.25 sec"),
                      (ids[1], "loudness", 0, 1, "-25.4 LUFS", ">=-18 LUFS"),
                      (ids[0], "character_consistency", 1, 1, "0.91", ">=0.85")]
            db.executemany("INSERT INTO qc_checks(job_id,name,passed,critical,measured,threshold) VALUES(?,?,?,?,?,?)", checks)
        if db.execute("SELECT COUNT(*) FROM metrics").fetchone()[0] == 0:
            db.executemany("INSERT INTO metrics VALUES(?,?,?,?,?,?,?)", [
                ("2026-08-14", 0, 0, 0, 0, 0, 0), ("2026-08-15", 0, 0, 0, 0, 0, 0),
                ("2026-08-16", 0, 0, 0, 0, 0, 0), ("2026-08-17", 0, 0, 0, 0, 0, 1)])
        if db.execute("SELECT COUNT(*) FROM competitors").fetchone()[0] == 0:
            db.executemany("INSERT INTO competitors(channel,format,frequency,recent_velocity,signal,live) VALUES(?,?,?,?,?,0)", [
                ("신비한 건축사전", "원리 시각화", "고빈도", 92, "한 개념을 움직임으로 증명"),
                ("군림보", "상황극+정보", "고빈도", 88, "캐릭터 리액션과 빠른 전개"),
                ("머니로드", "인터뷰+수익증명", "중빈도", 76, "증거 선공개 후 절차 교육")])
        if db.execute("SELECT COUNT(*) FROM alerts").fetchone()[0] == 0:
            db.executemany("INSERT INTO alerts(severity,message,created_at) VALUES(?,?,datetime('now'))", [
                ("critical", "1편이 음량 기준 미달로 게시 차단됨"),
                ("warning", "TOP20 중 3개 소재는 근거가 2개 미만임"),
                ("info", "외부 데이터는 아직 DEMO 모드입니다. YouTube 연결 후 LIVE로 전환됩니다.")])
        if db.execute("SELECT COUNT(*) FROM brands").fetchone()[0] == 0:
            cur = db.execute("INSERT INTO brands(name,industry,audience,created_at) VALUES('샘플 브랜드','생활 서비스','25–44세 생활 소비자',datetime('now'))")
            brand_id = cur.lastrowid
            kws = [(brand_id, "정기구독 해지 방법", "problem-solving", 88.2, 0, "unknown", "DEMO"),
                   (brand_id, "생활비 줄이는 법", "informational", 82.4, 0, "unknown", "DEMO"),
                   (brand_id, "무료체험 자동결제", "comparison", 80.1, 0, "unknown", "DEMO")]
            db.executemany("INSERT INTO blog_keywords(brand_id,keyword,intent,score,volume,competition,source_mode,created_at) VALUES(?,?,?,?,?,?,?,datetime('now'))", kws)
            key_ids = [r[0] for r in db.execute("SELECT id FROM blog_keywords WHERE brand_id=? ORDER BY id", (brand_id,)).fetchall()]
            db.executemany("INSERT INTO blog_posts(brand_id,keyword_id,title,status,evidence_count,duplicate_pct,updated_at) VALUES(?,?,?,?,?,?,datetime('now'))", [
                (brand_id, key_ids[0], "정기구독 해지 전에 확인할 5가지", "review", 3, 6.0),
                (brand_id, key_ids[1], "생활비가 새는 고정비 점검표", "draft", 2, 9.0),
                (brand_id, key_ids[2], "무료체험이 자동결제로 바뀌는 순간", "idea", 0, 14.0)])
