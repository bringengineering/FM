from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


def now_iso():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class OpsStore:
    def __init__(self, path):
        self.path = str(Path(path))

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        finally:
            db.close()

    def initialize(self):
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript("""
            CREATE TABLE IF NOT EXISTS topics (
              id INTEGER PRIMARY KEY, slug TEXT UNIQUE, title TEXT, category TEXT,
              source TEXT, score REAL, demand REAL, velocity REAL, evidence_count INTEGER,
              duplicate_pct REAL, risk TEXT, hook_a TEXT, hook_b TEXT, status TEXT,
              live INTEGER DEFAULT 0, created_at TEXT);
            CREATE TABLE IF NOT EXISTS jobs (
              id INTEGER PRIMARY KEY, topic_slug TEXT, stage TEXT, status TEXT,
              checkpoint TEXT, attempts INTEGER DEFAULT 1, error TEXT, cost REAL DEFAULT 0,
              updated_at TEXT);
            CREATE TABLE IF NOT EXISTS qc_checks (
              id INTEGER PRIMARY KEY, job_id INTEGER, name TEXT, passed INTEGER,
              critical INTEGER, measured TEXT, threshold TEXT);
            CREATE TABLE IF NOT EXISTS metrics (
              day TEXT PRIMARY KEY, subscribers INTEGER, views INTEGER,
              completion REAL, shares REAL, conversion REAL, uploads INTEGER);
            CREATE TABLE IF NOT EXISTS competitors (
              id INTEGER PRIMARY KEY, channel TEXT UNIQUE, format TEXT, frequency TEXT,
              recent_velocity REAL, signal TEXT, live INTEGER DEFAULT 0);
            CREATE TABLE IF NOT EXISTS alerts (
              id INTEGER PRIMARY KEY, severity TEXT, message TEXT, resolved INTEGER DEFAULT 0,
              created_at TEXT);
            CREATE TABLE IF NOT EXISTS brands (
              id INTEGER PRIMARY KEY, name TEXT UNIQUE, industry TEXT, audience TEXT,
              created_at TEXT);
            CREATE TABLE IF NOT EXISTS blog_keywords (
              id INTEGER PRIMARY KEY, brand_id INTEGER, keyword TEXT, intent TEXT,
              score REAL, volume INTEGER DEFAULT 0, competition TEXT DEFAULT 'unknown',
              source_mode TEXT DEFAULT 'DEMO', created_at TEXT,
              UNIQUE(brand_id, keyword));
            CREATE TABLE IF NOT EXISTS blog_posts (
              id INTEGER PRIMARY KEY, brand_id INTEGER, keyword_id INTEGER, title TEXT,
              status TEXT DEFAULT 'idea', evidence_count INTEGER DEFAULT 0,
              duplicate_pct REAL DEFAULT 0, scheduled_at TEXT, published_url TEXT,
              updated_at TEXT);
            """)

    def topics(self, limit=20):
        with self.connect() as db:
            rows = db.execute("SELECT * FROM topics ORDER BY score DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]

    def upsert_topic(self, item):
        cols = ["slug", "title", "category", "source", "score", "demand", "velocity",
                "evidence_count", "duplicate_pct", "risk", "hook_a", "hook_b", "status", "live", "created_at"]
        vals = [item.get(c, now_iso() if c == "created_at" else 0 if c == "live" else "") for c in cols]
        with self.connect() as db:
            db.execute(f"INSERT INTO topics ({','.join(cols)}) VALUES ({','.join('?'*len(cols))}) ON CONFLICT(slug) DO NOTHING", vals)

    def create_job(self, topic_slug, stage="queued", status=None):
        with self.connect() as db:
            cur = db.execute("INSERT INTO jobs(topic_slug,stage,status,checkpoint,updated_at) VALUES(?,?,?,?,?)",
                             (topic_slug, stage, status or stage, "start", now_iso()))
            return cur.lastrowid

    def jobs(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM jobs ORDER BY id DESC").fetchall()]

    def fail_job(self, job_id, error, checkpoint):
        with self.connect() as db:
            db.execute("UPDATE jobs SET status='failed',error=?,checkpoint=?,updated_at=? WHERE id=?",
                       (error, checkpoint, now_iso(), job_id))

    def resume_job(self, job_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
            if not row or row["status"] != "failed":
                raise ValueError("Only failed jobs can be resumed")
            db.execute("UPDATE jobs SET status=stage,error='',attempts=attempts+1,updated_at=? WHERE id=?",
                       (now_iso(), job_id))
            return dict(db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone())

    def add_qc(self, job_id, name, passed, measured="", threshold="", critical=True):
        with self.connect() as db:
            db.execute("INSERT INTO qc_checks(job_id,name,passed,critical,measured,threshold) VALUES(?,?,?,?,?,?)",
                       (job_id, name, int(passed), int(critical), measured, threshold))

    def qc(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM qc_checks ORDER BY id DESC").fetchall()]

    def metrics(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM metrics ORDER BY day").fetchall()]

    def competitors(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM competitors ORDER BY recent_velocity DESC").fetchall()]

    def alerts(self):
        with self.connect() as db:
            return [dict(r) for r in db.execute("SELECT * FROM alerts WHERE resolved=0 ORDER BY id DESC").fetchall()]

    def create_brand(self, name, industry, audience):
        with self.connect() as db:
            cur = db.execute("INSERT INTO brands(name,industry,audience,created_at) VALUES(?,?,?,?)",
                             (name, industry, audience, now_iso()))
            return cur.lastrowid

    def create_blog_keyword(self, brand_id, keyword, intent, score, volume=0, competition="unknown", source_mode="DEMO"):
        with self.connect() as db:
            cur = db.execute("INSERT INTO blog_keywords(brand_id,keyword,intent,score,volume,competition,source_mode,created_at) VALUES(?,?,?,?,?,?,?,?)",
                             (brand_id, keyword, intent, score, volume, competition, source_mode, now_iso()))
            return cur.lastrowid

    def create_blog_post(self, brand_id, keyword_id, title, status="idea"):
        with self.connect() as db:
            cur = db.execute("INSERT INTO blog_posts(brand_id,keyword_id,title,status,updated_at) VALUES(?,?,?,?,?)",
                             (brand_id, keyword_id, title, status, now_iso()))
            return cur.lastrowid

    def update_blog_post_status(self, post_id, status):
        allowed = {"idea", "research", "draft", "review", "approved", "scheduled", "published", "failed"}
        if status not in allowed:
            raise ValueError("Invalid blog post status")
        with self.connect() as db:
            db.execute("UPDATE blog_posts SET status=?,updated_at=? WHERE id=?", (status, now_iso(), post_id))

    def blog_workspace(self):
        with self.connect() as db:
            brands = [dict(r) for r in db.execute("SELECT * FROM brands ORDER BY id").fetchall()]
            keywords = [dict(r) for r in db.execute("SELECT * FROM blog_keywords ORDER BY score DESC").fetchall()]
            posts = [dict(r) for r in db.execute("SELECT * FROM blog_posts ORDER BY id DESC").fetchall()]
        return {"brands": brands, "keywords": keywords, "posts": posts}
