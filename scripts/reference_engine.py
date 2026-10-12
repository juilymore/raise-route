#!/usr/bin/env python3
"""
Reference implementation of the deterministic scoring + action engine.
  python3 scripts/reference_engine.py          -> prints a table + (re)writes config/golden_vectors.json

PURPOSE: remove ambiguity. The TypeScript engine (src/lib/engine/*) must reproduce
config/golden_vectors.json EXACTLY (a vitest test loads that file). If you change a rule,
change it here, regenerate the vectors, bump config/scoring.v1.json "version", port to TS.

Rounding: round-half-up on each component (not Python banker's rounding).
"""
import json, math, os, datetime as dt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "config", "scoring.v1.json")))
A = CFG["actions"]
D = dt.date.fromisoformat
rnd = lambda x: int(math.floor(x + 0.5))


def age_days(sig, today):
    return (today - D(sig["event_date"])).days


def qualifies(sig, today):
    age = age_days(sig, today)
    if age < -CFG["future_date_tolerance_days"]:
        return False                                   # future-dated => never qualifies
    return age <= CFG["window_days"] and sig["relevance_tier"] != "none"


def signal_points(sig, today):
    age = max(0, age_days(sig, today))
    rel = rnd(CFG["max_points"]["relevance"] * CFG["relevance_tier_weight"][sig["relevance_tier"]])
    damp = CFG["relevance_damping"]["by_tier"][sig["relevance_tier"]]
    rec = max(CFG["recency"]["min_points_if_in_window"],
              rnd(CFG["max_points"]["recency"] * (1 - age / CFG["window_days"]) * damp))
    S = CFG["strength"]
    cm = 1.0
    if sig["signal_type"] in S["commitment_types"]:
        cm = S["commitment_multiplier"][sig.get("commitment", "confirmed")]
    stn = rnd(S["base_by_signal_type"][sig["signal_type"]] * S["multiplier_by_relevance_tier"][sig["relevance_tier"]] * cm)
    E = CFG["evidence_quality"]
    eq = (E["source_type_points"][sig["source_type"]] + E["date_basis_points"][sig["date_basis"]]
          + (E["excerpt_verified_points"] if sig["excerpt_verified"] else 0)
          + (E["url_ok_points"] if sig.get("url_ok", True) else 0))
    eq = rnd(eq * damp)                                  # irrelevant activity gets less credit for being well-sourced
    if sig.get("is_synthetic"):
        eq = min(eq, E["synthetic_cap"])
    return {"relevance": rel, "recency": rec, "strength": stn, "evidence_quality": eq,
            "sum": rel + rec + stn + eq, "age_days": age}


def corroboration(qualifying, top):
    C = CFG["corroboration"]
    n = len([s for s in qualifying if s["relevance_tier"] in C["counts_tiers"]])
    pts = min(C["max_from_events"], C["per_additional_independent_event"] * max(n - 1, 0))
    if top.get("independent_source_count", 1) >= 2:
        pts += C["bonus_if_top_event_has_2plus_independent_sources"]
    return min(CFG["max_points"]["corroboration"], pts)


def fund_fit(fund, company_geo):
    F = CFG["fund_fit"]
    stage = F["stage_points"].get(fund.get("stage_focus") or "UNKNOWN", F["stage_points"]["UNKNOWN"])
    known = [F["sector_points"][t] for t in (fund.get("sector_tags") or []) if t in F["sector_points"]]
    sector = max(known) if known else F["sector_unknown_points"]
    G = F["geo_points"]
    if company_geo is None:
        geo = G["company_unknown"]
    elif fund.get("hq_region") == "Global" or fund.get("hq_region") == company_geo:
        geo = G["match_or_global"]
    else:
        geo = G["mismatch"]
    return {"stage": stage, "sector": sector, "geo": geo, "total": stage + sector + geo}


def score(signals, fund, company_geo, today):
    q = [s for s in signals if qualifies(s, today)]
    fit = fund_fit(fund, company_geo)
    if not q:
        return {"qualifying": 0, "follow_up_score": None, "fit": fit, "top": None, "breakdown": None,
                "last_signal_date": None}
    scored = [(signal_points(s, today), s) for s in q]
    top_pts, top = max(scored, key=lambda ps: (ps[0]["sum"], ps[1]["event_date"], ps[1].get("independent_source_count", 1)))
    corr = corroboration(q, top)
    total = top_pts["sum"] + corr + fit["total"]
    return {"qualifying": len(q), "follow_up_score": total, "fit": fit, "top": top,
            "breakdown": {"relevance": top_pts["relevance"], "recency": top_pts["recency"],
                          "strength": top_pts["strength"], "corroboration": corr,
                          "evidence_quality": top_pts["evidence_quality"], "fund_fit": fit["total"]},
            "last_signal_date": max(s["event_date"] for s in q)}


def decide(res, rel, today, assessment_status="SIGNAL_FOUND"):
    st = rel["contact_status"]
    last = D(rel["last_contact_date"]) if rel.get("last_contact_date") else None
    rc = D(rel["reconnect_after"]) if rel.get("reconnect_after") else None
    days = (today - last).days if last else None
    top, s, has = res["top"], res["follow_up_score"], res["qualifying"] > 0

    if assessment_status == "FAILED" or (assessment_status == "PARTIAL" and not has):
        return {"action": "ASSESSMENT_INCOMPLETE", "hold_reason": None, "reason_code": "INCOMPLETE"}

    strong_ok = bool(has and top["relevance_tier"] in A["gate_tiers"]
                     and (top["excerpt_verified"] or not A["gate_require_excerpt_verified"])
                     and res["fit"]["stage"] >= A["gate_min_stage_points"]
                     and not top.get("is_synthetic")
                     and top.get("commitment") not in A["gate_disallow_commitments"]
                     and (today - D(top["event_date"])).days <= A["reach_out_max_signal_age_days"])
    monitor_ok = bool(has and top["relevance_tier"] in A["monitor_requires_tiers"])

    if st == "PASSED":
        if rc and today >= rc and has and s >= A["reach_out_now_min_score"] and strong_ok:
            return {"action": "MONITOR", "hold_reason": None, "reason_code": "REOPEN_WINDOW"}
        return {"action": "DONT_PRIORITIZE", "hold_reason": None, "reason_code": "PASSED"}
    if rc and rc > today:
        return {"action": "HOLD", "hold_reason": "RECONNECT_DATE", "reason_code": "RECONNECT_DATE"}
    if st in ("IN_CONVERSATION", "MEETING_SCHEDULED"):
        hook = has and s >= A["follow_up_now_min_score"] and strong_ok
        return {"action": "HOLD", "hold_reason": "ACTIVE_CONVERSATION",
                "reason_code": "ACTIVE_CONVERSATION_WITH_HOOK" if hook else "ACTIVE_CONVERSATION"}
    if st == "WAITING_FOR_RESPONSE":
        if days is None:
            return {"action": "HOLD", "hold_reason": "AWAITING_RESPONSE", "reason_code": "AWAITING_RESPONSE"}
        if days < A["waiting_cooldown_days"]:
            return {"action": "HOLD", "hold_reason": "RECENT_CONTACT", "reason_code": "RECENT_CONTACT"}
        if has and D(top["event_date"]) >= last and s >= A["follow_up_now_min_score"] and strong_ok:
            return {"action": "FOLLOW_UP_NOW", "hold_reason": None, "reason_code": "NEW_HOOK_SINCE_CONTACT"}
        if monitor_ok and s >= A["monitor_min_score"]:
            return {"action": "MONITOR", "hold_reason": None, "reason_code": "WAITING_NO_STRONG_HOOK"}
        return {"action": "DONT_PRIORITIZE", "hold_reason": None,
                "reason_code": "OVERDUE_NO_HOOK" if days >= A["overdue_follow_up_days"] else "NO_HOOK"}
    # TO_REACH_OUT
    if not has:
        return {"action": "DONT_PRIORITIZE", "hold_reason": None, "reason_code": "QUIET"}
    if strong_ok and s >= A["reach_out_now_min_score"]:
        return {"action": "REACH_OUT_NOW", "hold_reason": None, "reason_code": "STRONG_RELEVANT_SIGNAL"}
    if monitor_ok and s >= A["monitor_min_score"]:
        return {"action": "MONITOR", "hold_reason": None,
                "reason_code": "GATE_CAPPED" if s >= A["reach_out_now_min_score"] else "MODERATE_SIGNAL"}
    if has and not monitor_ok:
        return {"action": "DONT_PRIORITIZE", "hold_reason": None, "reason_code": "GENERIC_ACTIVITY_NOT_RELEVANT"}
    return {"action": "DONT_PRIORITIZE", "hold_reason": None, "reason_code": "WEAK_SIGNAL"}


# ------------------------------- golden vectors -------------------------------
TODAY = "2026-10-12"
T = D(TODAY)
F_LOG = {"stage_focus": "PRESEED_SEED", "sector_tags": ["mobility", "logistics", "supply_chain"], "hq_region": "US"}
F_GEN = {"stage_focus": "SEED_EARLY", "sector_tags": ["generalist", "b2b_saas"], "hq_region": "India"}
F_GRO = {"stage_focus": "GROWTH", "sector_tags": ["generalist"], "hq_region": "Global"}
F_UNK = {"stage_focus": None, "sector_tags": [], "hq_region": None}

def d(n):  # ISO date n days before TODAY
    return (T - dt.timedelta(days=n)).isoformat()

def sig(id, days_ago, **kw):
    base = dict(id=id, event_date=d(days_ago), signal_type="investment", relevance_tier="direct", commitment="confirmed",
                source_type="portfolio_announcement", date_basis="structured_metadata", excerpt_verified=True,
                is_synthetic=False, independent_source_count=1, url_ok=True)
    base.update(kw); return base

STRONG = sig("s_strong", 5)
REL = lambda st="TO_REACH_OUT", last=None, rc=None: {"contact_status": st, "last_contact_date": last, "reconnect_after": rc}

CASES = [
 ("V01 quiet fund, no signals, to-reach-out",           [], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V02 strong direct investment 5d, to-reach-out",     [STRONG], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V03 same, waiting 3 days (cooldown)",               [STRONG], F_LOG, None, REL("WAITING_FOR_RESPONSE", d(3)), "SIGNAL_FOUND"),
 ("V04 same, waiting 18d, hook newer than contact",    [STRONG], F_LOG, None, REL("WAITING_FOR_RESPONSE", d(18)), "SIGNAL_FOUND"),
 ("V05 same, reconnect_after in future",               [STRONG], F_LOG, None, REL("TO_REACH_OUT", None, (T + dt.timedelta(days=20)).isoformat()), "SIGNAL_FOUND"),
 ("V06 same, active conversation",                     [STRONG], F_LOG, None, REL("IN_CONVERSATION", d(4)), "SIGNAL_FOUND"),
 ("V07 same, passed, no reconnect date",               [STRONG], F_LOG, None, REL("PASSED", d(40)), "SIGNAL_FOUND"),
 ("V08 same, growth-stage fund (stage gate)",          [STRONG], F_GRO, None, REL(), "SIGNAL_FOUND"),
 ("V09 broad generic blog 2d (AI chips-type)",         [sig("s_broad", 2, signal_type="blog_post", relevance_tier="broad", source_type="official_blog")], F_GEN, None, REL(), "SIGNAL_FOUND"),
 ("V10 adjacent trade-press mention 20d",              [sig("s_adj", 20, signal_type="news_mention", relevance_tier="adjacent", source_type="trade_press", date_basis="published_date")], F_GEN, None, REL(), "SIGNAL_FOUND"),
 ("V11 direct event 31d old => out of window",         [sig("s_old", 31)], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V12 synthetic strong signal => capped",             [sig("s_syn", 3, is_synthetic=True)], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V13 two events, top has 2 independent sources",     [sig("s_a", 6, independent_source_count=2), sig("s_b", 14, signal_type="blog_post", source_type="official_blog")], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V14 partial assessment, nothing found",             [], F_LOG, None, REL(), "PARTIAL"),
 ("V15 failed assessment",                             [], F_LOG, None, REL(), "FAILED"),
 ("V16 rumored investment 3d",                         [sig("s_rum", 3, commitment="rumor", source_type="reputable_news", date_basis="published_date")], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V17 relevance 'none' never qualifies",              [sig("s_none", 2, relevance_tier="none")], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V18 event dated +3 days (future) rejected",         [sig("s_fut", -3)], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V19 event dated +1 day tolerated (clamped to 0)",   [sig("s_tol", -1)], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V20 excerpt NOT verified => evidence gate",         [sig("s_unv", 5, excerpt_verified=False)], F_LOG, None, REL(), "SIGNAL_FOUND"),
 ("V21 passed + reconnect due + strong signal",        [STRONG], F_LOG, None, REL("PASSED", d(70), d(1)), "SIGNAL_FOUND"),
 ("V22 waiting 10d but signal PRE-dates contact",      [sig("s_pre", 12)], F_LOG, None, REL("WAITING_FOR_RESPONSE", d(10)), "SIGNAL_FOUND"),
 ("V23 unknown fund profile + strong signal",          [STRONG], F_UNK, None, REL(), "SIGNAL_FOUND"),
 ("V24 company geography known (India) vs US fund",    [STRONG], F_LOG, "India", REL(), "SIGNAL_FOUND"),
 ("V25 waiting 31d, quiet (overdue, no hook)",         [], F_GEN, None, REL("WAITING_FOR_RESPONSE", d(31)), "SIGNAL_FOUND"),
 ("V26 direct official blog post 12d, generalist fund", [sig("s_blog", 12, signal_type="blog_post", source_type="official_blog")], F_GEN, None, REL(), "SIGNAL_FOUND"),
 ("V27 direct podcast 25d (aging => freshness gate)",  [sig("s_pod", 25, signal_type="podcast", source_type="podcast", date_basis="published_date")], F_GEN, None, REL(), "SIGNAL_FOUND"),
 ("V28 INVESTMENT in unrelated company (broad) 1d",    [sig("s_chip", 1, relevance_tier="broad")], F_GEN, None, REL(), "SIGNAL_FOUND"),
 ("V29 b2b_saas thesis post 8d, generalist fund",      [sig("s_saas", 8, signal_type="thesis_update", relevance_tier="b2b_saas", source_type="official_blog")], F_GEN, None, REL(), "SIGNAL_FOUND"),
 ("V30 exactly 30 days old direct event",              [sig("s_30", 30, signal_type="blog_post", source_type="official_blog")], F_LOG, None, REL(), "SIGNAL_FOUND"),
]

def run_all():
    out = []
    for name, signals, fund, geo, rel, status in CASES:
        res = score(signals, fund, geo, T)
        dec = decide(res, rel, T, status)
        out.append({"name": name, "today": TODAY,
                    "input": {"signals": signals, "fund": fund, "company_geography": geo, "relationship": rel,
                              "assessment_status": status},
                    "expected": {"qualifying_signals": res["qualifying"], "follow_up_score": res["follow_up_score"],
                                 "fit": res["fit"], "breakdown": res["breakdown"],
                                 "last_signal_date": res["last_signal_date"],
                                 "action": dec["action"], "hold_reason": dec["hold_reason"],
                                 "reason_code": dec["reason_code"]}})
    return out

if __name__ == "__main__":
    vectors = run_all()
    json.dump({"scoring_version": CFG["version"], "today": TODAY, "vectors": vectors},
              open(os.path.join(ROOT, "config", "golden_vectors.json"), "w"), indent=2)
    print(f"{'case':<55}{'score':>6} {'fit':>4}  action / hold / reason")
    for v in vectors:
        e = v["expected"]
        sc = "—" if e["follow_up_score"] is None else e["follow_up_score"]
        print(f"{v['name']:<55}{str(sc):>6} {e['fit']['total']:>4}  {e['action']} / {e['hold_reason']} / {e['reason_code']}")
    print(f"\nwrote config/golden_vectors.json ({len(vectors)} vectors, version {CFG['version']})")
