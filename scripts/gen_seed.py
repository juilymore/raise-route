#!/usr/bin/env python3
"""
Generates data/seed_vcs.csv and db/seed.sql  (run: python3 scripts/gen_seed.py)

HONESTY RULES (do not remove):
  * VC identities are real firms. Their `thesis`, `stage_focus`, `sector_tags`, `website`
    and `tracked_people` are ANALYST HINTS from general knowledge — profile_source =
    'seed_unverified'. The pipeline's profile-enrichment step must verify them from
    official sources before they influence fit scoring with high confidence.
  * Relationship data (contact status, dates, notes, history) is SYNTHETIC DEMO DATA for
    the fictional founder "Vikram" — is_demo_relationship = true. Dates are expressed as
    "N days ago" and resolved in SQL with current_date, so the demo never goes stale.
  * seed.sql is idempotent and NEVER overwrites founder data: ON CONFLICT (slug) DO NOTHING.
"""
import csv, json, os

# stage tokens: PRESEED_SEED | SEED_EARLY | MULTI_STAGE | EARLY_GROWTH | GROWTH | ACCELERATOR
# sector tags  : logistics supply_chain mobility industrial proptech b2b_saas enterprise_software
#                fintech consumer deeptech marketplaces generalist
# (slug, firm, contact|None, region, stage, tags, aliases, website|None, thesis)
FIRMS = [
 ("peak-xv-partners","Peak XV Partners","Shailendra Singh","India","MULTI_STAGE",["generalist","enterprise_software","b2b_saas","consumer","fintech"],["Peak XV","Peak XV Partners","Sequoia Capital India","Sequoia India"],"peakxv.com","Multi-stage investor across India and Southeast Asia; backs enterprise software/SaaS, consumer and fintech from seed to growth. Formerly Sequoia Capital India & SEA."),
 ("accel","Accel","Prashanth Prakash","India","MULTI_STAGE",["b2b_saas","enterprise_software","consumer","fintech"],["Accel","Accel India","Accel Partners"],"accel.com","Early-stage investor with a long B2B/SaaS record; the India team backs seed and Series A software companies."),
 ("elevation-capital","Elevation Capital",None,"India","MULTI_STAGE",["consumer","b2b_saas","fintech"],["Elevation Capital","SAIF Partners"],"elevationcapital.com","India-focused early-stage investor (formerly SAIF Partners) across consumer internet, SaaS and fintech."),
 ("lightspeed-india","Lightspeed India","Hemant Mohapatra","India","MULTI_STAGE",["b2b_saas","enterprise_software","consumer","fintech"],["Lightspeed India","Lightspeed India Partners"],"lsvp.com","India arm of Lightspeed; backs enterprise/SaaS and consumer companies from seed onward."),
 ("nexus-venture-partners","Nexus Venture Partners","Sameer Brij Verma","India","SEED_EARLY",["enterprise_software","b2b_saas","consumer"],["Nexus Venture Partners","Nexus VP"],"nexusvp.com","India-US early-stage fund known for enterprise software, SaaS and infrastructure companies."),
 ("blume-ventures","Blume Ventures","Karthik Reddy","India","PRESEED_SEED",["generalist","b2b_saas","consumer","deeptech"],["Blume Ventures"],"blume.vc","India seed-stage fund backing founders across software, consumer, fintech and deeptech."),
 ("stellaris-venture-partners","Stellaris Venture Partners","Alok Goyal","India","PRESEED_SEED",["b2b_saas","enterprise_software","consumer"],["Stellaris Venture Partners","Stellaris VP"],"stellarisvp.com","India seed-stage fund focused on early technology companies including B2B and SaaS."),
 ("z47","Z47","Tarun Davda","India","EARLY_GROWTH",["consumer","enterprise_software","b2b_saas"],["Z47","Matrix Partners India","Matrix India"],"z47.com","Formerly Matrix Partners India; early-stage and growth investments in consumer and enterprise software."),
 ("chiratae-ventures","Chiratae Ventures","Sudhir Sethi","India","SEED_EARLY",["b2b_saas","enterprise_software","consumer","fintech"],["Chiratae Ventures","Chiratae","IDG Ventures India"],"chiratae.com","India early-stage VC (formerly IDG Ventures India) across technology sectors."),
 ("india-quotient","India Quotient","Anand Lunia","India","PRESEED_SEED",["consumer","b2b_saas"],["India Quotient"],"indiaquotient.in","India seed-stage fund backing early-stage technology startups."),
 ("kalaari-capital","Kalaari Capital","Vani Kola","India","SEED_EARLY",["consumer","b2b_saas","deeptech"],["Kalaari Capital","Kalaari"],"kalaari.com","India early-stage VC investing across consumer tech, SaaS and deeptech."),
 ("3one4-capital","3one4 Capital","Pranav Karnavat","India","SEED_EARLY",["b2b_saas","fintech","consumer"],["3one4 Capital","3one4"],"3one4capital.com","Bengaluru-based early-stage VC across technology sectors."),
 ("speciale-invest","Speciale Invest","Vishesh Rajaram","India","PRESEED_SEED",["deeptech","industrial","b2b_saas"],["Speciale Invest"],None,"Deeptech-focused seed fund (hardware, robotics, AI); adjacent to supply-chain automation."),
 ("info-edge-ventures","Info Edge Ventures",None,"India","SEED_EARLY",["consumer","b2b_saas"],["Info Edge Ventures"],None,"Venture arm of Info Edge; invests in early-stage Indian internet and technology companies."),
 ("prime-venture-partners","Prime Venture Partners","Sanjay Swamy","India","PRESEED_SEED",["b2b_saas","enterprise_software"],["Prime Venture Partners"],None,"Bengaluru seed-stage fund focused on SaaS and B2B startups."),
 ("better-capital","Better Capital","Vaibhav Domkundwar","India","PRESEED_SEED",["b2b_saas","consumer"],["Better Capital"],"better.capital","Pre-seed/seed investor backing early founders in India."),
 ("titan-capital","Titan Capital","Kunal Bahl","India","PRESEED_SEED",["consumer","b2b_saas"],["Titan Capital"],None,"Seed-stage investor backing Indian startups."),
 ("axilor-ventures","Axilor Ventures",None,"India","PRESEED_SEED",["b2b_saas","deeptech"],["Axilor Ventures","Axilor"],None,"Bengaluru-based early-stage fund and accelerator."),
 ("endiya-partners","Endiya Partners",None,"India","PRESEED_SEED",["b2b_saas","consumer"],["Endiya Partners","Endiya"],None,"India seed-stage fund investing in technology startups."),
 ("together-fund","Together Fund","Girish Mathrubootham","India","PRESEED_SEED",["b2b_saas","enterprise_software"],["Together Fund"],"together.fund","Founder-led fund backing early SaaS and technology startups."),
 ("venture-highway","Venture Highway",None,"India","PRESEED_SEED",["b2b_saas","consumer"],["Venture Highway"],None,"India seed-stage fund backing early technology founders."),
 ("general-catalyst","General Catalyst",None,"Global","MULTI_STAGE",["generalist","enterprise_software","b2b_saas"],["General Catalyst"],"generalcatalyst.com","Global multi-stage VC with an India presence; invests across software and other sectors."),
 ("orios-venture-partners","Orios Venture Partners",None,"India","PRESEED_SEED",["b2b_saas","consumer"],["Orios Venture Partners","Orios"],None,"India seed-stage fund investing in early technology companies."),
 ("waterbridge-ventures","WaterBridge Ventures",None,"India","SEED_EARLY",["b2b_saas","consumer"],["WaterBridge Ventures","WaterBridge"],None,"India early-stage VC across technology sectors."),
 ("exfinity-venture-partners","Exfinity Venture Partners",None,"India","PRESEED_SEED",["b2b_saas","enterprise_software"],["Exfinity Venture Partners","Exfinity"],None,"Bengaluru early-stage fund with a SaaS/enterprise software focus."),
 # ---- logistics / supply-chain specialists & global seed funds ----
 ("dynamo-ventures","Dynamo Ventures",None,"Europe","SEED_EARLY",["logistics","supply_chain","mobility"],["Dynamo Ventures","Dynamo VC"],"dynamo.vc","Early-stage fund focused on transportation, logistics and supply-chain technology."),
 ("trucks-vc","Trucks VC","Reilly Brennan","US","PRESEED_SEED",["mobility","logistics","supply_chain"],["Trucks VC","Trucks Venture Capital"],"trucks.vc","Pre-seed/seed fund focused on mobility, transportation and logistics."),
 ("schematic-ventures","Schematic Ventures",None,"US","SEED_EARLY",["industrial","supply_chain","logistics"],["Schematic Ventures","Schematic"],"schematicventures.com","Early-stage fund focused on industrial and supply-chain technology."),
 ("maersk-growth","Maersk Growth",None,"Europe","EARLY_GROWTH",["logistics","supply_chain"],["Maersk Growth"],None,"Corporate venture arm of A.P. Moller-Maersk investing in logistics and supply-chain technology."),
 ("prologis-ventures","Prologis Ventures",None,"US","EARLY_GROWTH",["logistics","supply_chain","proptech"],["Prologis Ventures"],None,"Corporate venture arm of Prologis investing in logistics real estate, supply-chain and related technology."),
 ("eclipse-ventures","Eclipse Ventures",None,"US","MULTI_STAGE",["industrial","deeptech","supply_chain"],["Eclipse Ventures"],"eclipse.vc","Industrial-technology VC focused on the physical economy: manufacturing, logistics and energy."),
 ("construct-capital","Construct Capital",None,"US","SEED_EARLY",["industrial","supply_chain"],["Construct Capital"],"constructcap.com","Early-stage fund focused on industrial and supply-chain technology."),
 ("bessemer-venture-partners","Bessemer Venture Partners",None,"Global","MULTI_STAGE",["b2b_saas","enterprise_software","fintech","consumer"],["Bessemer Venture Partners","Bessemer","BVP"],"bvp.com","Long-standing multi-stage investor with a deep cloud/B2B software practice and an India presence."),
 ("lightspeed-venture-partners","Lightspeed Venture Partners",None,"US","MULTI_STAGE",["enterprise_software","b2b_saas","consumer"],["Lightspeed Venture Partners","Lightspeed"],"lsvp.com","Global multi-stage investor with enterprise-software and consumer practices."),
 ("bain-capital-ventures","Bain Capital Ventures",None,"US","MULTI_STAGE",["b2b_saas","enterprise_software","fintech"],["Bain Capital Ventures","BCV"],"bcv.com","Multi-stage venture investor with a focus on B2B software and fintech."),
 ("craft-ventures","Craft Ventures",None,"US","MULTI_STAGE",["b2b_saas","enterprise_software","marketplaces"],["Craft Ventures"],"craftventures.com","Venture firm investing in B2B software and marketplaces from seed onward."),
 ("foundation-capital","Foundation Capital","Ashu Garg","US","SEED_EARLY",["enterprise_software","b2b_saas"],["Foundation Capital"],"foundationcapital.com","Early-stage investor focused on enterprise software."),
 ("emergence-capital","Emergence Capital",None,"US","EARLY_GROWTH",["b2b_saas","enterprise_software"],["Emergence Capital","Emergence"],"emcap.com","B2B SaaS-focused investor, typically Series A/B."),
 ("point-nine","Point Nine","Christoph Janz","Europe","PRESEED_SEED",["b2b_saas","marketplaces"],["Point Nine","Point Nine Capital"],"pointnine.com","Seed-stage investor focused on B2B SaaS and marketplaces."),
 ("speedinvest","Speedinvest",None,"Europe","PRESEED_SEED",["b2b_saas","fintech","deeptech"],["Speedinvest"],"speedinvest.com","European early-stage VC across B2B software, fintech and deeptech."),
 ("susa-ventures","Susa Ventures","Chad Byers","US","PRESEED_SEED",["b2b_saas","enterprise_software","fintech"],["Susa Ventures"],"susaventures.com","Seed-stage investor focused on software and fintech."),
 ("precursor-ventures","Precursor Ventures","Charles Hudson","US","PRESEED_SEED",["generalist","b2b_saas"],["Precursor Ventures"],"precursorvc.com","Pre-seed investor backing early-stage founders across sectors."),
 ("initialized-capital","Initialized Capital",None,"US","PRESEED_SEED",["b2b_saas","enterprise_software","consumer"],["Initialized Capital","Initialized"],"initialized.com","Early-stage investor backing software and consumer founders."),
 ("eniac-ventures","Eniac Ventures",None,"US","PRESEED_SEED",["b2b_saas","enterprise_software"],["Eniac Ventures","Eniac"],"eniac.vc","Seed-stage investor focused on software and infrastructure."),
 ("lerer-hippeau","Lerer Hippeau",None,"US","PRESEED_SEED",["consumer","b2b_saas"],["Lerer Hippeau"],"lererhippeau.com","Seed-stage investor across consumer and business technology."),
 ("sosv","SOSV",None,"US","ACCELERATOR",["deeptech","industrial","b2b_saas"],["SOSV"],"sosv.com","Venture capital firm running accelerator programs for hardware, deeptech and other startups."),
 ("antler","Antler",None,"Global","ACCELERATOR",["generalist","b2b_saas"],["Antler"],"antler.co","Global early-stage investor building companies from day zero, with presence in India and Southeast Asia."),
 ("jungle-ventures","Jungle Ventures",None,"SEA","EARLY_GROWTH",["b2b_saas","consumer"],["Jungle Ventures"],"jungle-ventures.com","Southeast Asia-focused venture investor across stages."),
 ("insight-partners","Insight Partners",None,"Global","GROWTH",["b2b_saas","enterprise_software"],["Insight Partners"],"insightpartners.com","Growth-stage software investor; typically later than seed."),
 ("tiger-global","Tiger Global",None,"Global","GROWTH",["generalist","consumer","b2b_saas"],["Tiger Global","Tiger Global Management"],"tigerglobal.com","Growth-stage crossover investor; rarely leads seed rounds."),
]
assert len(FIRMS) == 50, len(FIRMS)
assert len({f[0] for f in FIRMS}) == 50

# DEMO relationship state (synthetic). status, days_ago (last contact), reconnect_in_days, note, history[(days_ago,type,summary)]
W, I, M, P = "WAITING_FOR_RESPONSE", "IN_CONVERSATION", "MEETING_SCHEDULED", "PASSED"
REL = {
 "trucks-vc":              (W, 3, None, "Sent intro + deck. Logistics focus is a very close match — top priority.", [(3,"email_sent","Intro email with deck")]),
 "schematic-ventures":     (W, 18, None, "Intro + one-pager sent, no reply yet. Look for a natural hook before nudging.", [(18,"email_sent","Intro email with one-pager")]),
 "accel":                  (W, 5, None, "Emailed after their SaaS-metrics content; waiting.", [(5,"email_sent","Intro email")]),
 "blume-ventures":         (W, 9, None, "Applied via their founder form; also emailed a partner.", [(9,"email_sent","Intro email + form submission")]),
 "nexus-venture-partners": (W, 12, None, "Warm intro via a mutual contact; partner said 'will review'.", [(12,"email_sent","Intro via mutual contact")]),
 "stellaris-venture-partners": (W, 2, None, "Sent deck yesterday-ish. Do not chase yet.", [(2,"email_sent","Deck sent")]),
 "lightspeed-india":       (W, 24, None, "No answer after first email. Needs a reason to follow up.", [(24,"email_sent","Intro email"),(17,"follow_up_sent","Short bump")]),
 "elevation-capital":      (W, 15, None, "Cold email to associate. Waiting.", [(15,"email_sent","Intro email to associate")]),
 "prime-venture-partners": (W, 31, None, "Cold email, one bump, silence. Probably low priority unless something changes.", [(31,"email_sent","Intro email"),(24,"follow_up_sent","Bump")]),
 "better-capital":         (W, 7, None, "DM'd partner after seeing a post.", [(7,"dm_sent","DM after post")]),
 "bessemer-venture-partners": (W, 21, None, "Emailed generic inbox; low response odds.", [(21,"email_sent","Intro to generic inbox")]),
 "susa-ventures":          (W, 14, None, "Intro email sent; no response.", [(14,"email_sent","Intro email")]),
 "point-nine":             (W, 6, None, "Sent intro; they usually reply within 2 weeks.", [(6,"email_sent","Intro email")]),
 "maersk-growth":          (I, 4, None, "In discussion — they asked for customer references and a data room link.", [(25,"email_sent","Intro email"),(11,"call","First call (30 min)"),(4,"email_sent","Sent references")]),
 "peak-xv-partners":       (I, 8, None, "Second call went well; partner wants to see Q3 pipeline numbers.", [(30,"email_sent","Intro"),(14,"call","First call"),(8,"call","Second call")]),
 "together-fund":          (I, 10, None, "Friendly operator feedback on pricing. Not a formal process yet.", [(20,"email_sent","Intro"),(10,"call","Intro call")]),
 "foundation-capital":     (I, 13, None, "Partner replied; exchanging materials.", [(19,"email_sent","Intro"),(13,"email_sent","Shared deck + metrics")]),
 "speedinvest":            (I, 16, None, "Discussing fit; they invest mostly in Europe.", [(22,"email_sent","Intro"),(16,"call","Intro call")]),
 "chiratae-ventures":      (M, 6, None, "Meeting booked. Prep: market sizing + unit economics.", [(18,"email_sent","Intro"),(6,"email_sent","Meeting confirmed")]),
 "z47":                    (M, 5, None, "Partner meeting next week.", [(16,"email_sent","Intro"),(5,"email_sent","Meeting confirmed")]),
 "emergence-capital":      (M, 9, None, "Booked an intro call; may be too late-stage for us.", [(15,"email_sent","Intro"),(9,"email_sent","Call booked")]),
 "construct-capital":      (P, 40, 60, "Passed: 'too early for our thesis right now'. Revisit after we show enterprise traction.", [(55,"email_sent","Intro"),(40,"email_received","Pass")]),
 "insight-partners":       (P, 35, None, "Passed — growth-stage only. Not a fit until Series B.", [(50,"email_sent","Intro"),(35,"email_received","Pass")]),
 "tiger-global":           (P, 45, None, "No seed investing. Marked passed to stop tracking noise.", [(60,"email_sent","Intro"),(45,"email_received","Pass")]),
 "3one4-capital":          (P, 28, 45, "Passed this quarter; asked to reconnect after we cross a revenue milestone.", [(42,"email_sent","Intro"),(28,"email_received","Pass, reconnect later")]),
}
NOTES_TO = {
 "dynamo-ventures": "Dedicated logistics/supply-chain fund — highest-fit target. Haven't reached out yet.",
 "prologis-ventures": "Logistics real-estate angle; check whether they do seed software.",
 "eclipse-ventures": "Industrial thesis; maybe too hardware-heavy.",
 "antler": "Pre-seed program; probably too early for us.",
 "sosv": "Accelerator model; low priority.",
 "kalaari-capital": "Want a warm intro; ask around.",
 "india-quotient": "Saw a partner talk on B2B SaaS. Draft intro pending.",
 "bain-capital-ventures": "Larger checks; later-stage target.",
 "craft-ventures": "Active in B2B SaaS; maybe.",
 "lerer-hippeau": "Consumer-leaning; low fit.",
}

def sql_text(s):
    return "NULL" if s is None else "$q$" + s + "$q$"
def sql_arr(a):
    return "ARRAY[" + ",".join("$q$" + x + "$q$" for x in a) + "]::text[]" if a else "'{}'::text[]"
def sql_hist(h):
    if not h: return "'[]'::jsonb"
    parts = [f"jsonb_build_object('at',(current_date - {d})::text,'type',$q${t}$q$,'summary',$q${s}$q$)" for d,t,s in h]
    return "jsonb_build_array(" + ",".join(parts) + ")"

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
rows, sql = [], []
for slug, firm, contact, region, stage, tags, aliases, site, thesis in FIRMS:
    st, d, rc, note, hist = REL.get(slug, ("TO_REACH_OUT", None, None, NOTES_TO.get(slug), []))
    name = contact or "Investment team"
    people = [contact] if contact else []
    rows.append(dict(slug=slug, name=name, firm=firm, thesis=thesis, website=site or "", hq_region=region,
                     stage_focus=stage, sector_tags=";".join(tags), aliases=";".join(aliases),
                     tracked_people=";".join(people), profile_source="seed_unverified",
                     contact_status=st, last_contact_days_ago=d if d is not None else "",
                     reconnect_in_days=rc if rc is not None else "", personal_notes=note or "",
                     contact_history_json=json.dumps([{"days_ago":x,"type":t,"summary":s} for x,t,s in hist]),
                     is_demo_relationship="true"))
    sql.append(
 "insert into public.vc_pipeline (slug,name,firm,thesis,website,hq_region,stage_focus,sector_tags,aliases,tracked_people,"
 "profile_source,contact_status,last_contact_date,reconnect_after,contact_history,personal_notes,is_demo_relationship) values (\n"
 f"  {sql_text(slug)},{sql_text(name)},{sql_text(firm)},{sql_text(thesis)},{sql_text(('https://'+site) if site else None)},"
 f"{sql_text(region)},{sql_text(stage)},\n  {sql_arr(tags)},{sql_arr(aliases)},{sql_arr(people)},'seed_unverified',"
 f"{sql_text(st)},{('(current_date - %d)' % d) if d is not None else 'NULL'},{('(current_date + %d)' % rc) if rc is not None else 'NULL'},\n"
 f"  {sql_hist(hist)},{sql_text(note)},true\n) on conflict (slug) do nothing;")

with open(os.path.join(root, "data", "seed_vcs.csv"), "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)

header = """-- GENERATED by scripts/gen_seed.py — do not hand-edit.
-- Idempotent: re-running NEVER overwrites founder data (ON CONFLICT DO NOTHING).
-- Relationship fields are SYNTHETIC DEMO DATA (is_demo_relationship = true).

insert into public.company_profile
  (id, company_name, product_description, sector, business_model, stage, geography, icp, raise_context, relevance_keywords)
values (
  1,
  $q$Vikram's B2B Logistics SaaS (placeholder — edit in Settings)$q$,
  $q$Seed-stage B2B SaaS for logistics operations: shipment visibility, fleet and warehouse operations, and last-mile delivery coordination. (Placeholder description — replace with the real product.)$q$,
  'B2B logistics SaaS', 'B2B SaaS', 'Seed',
  NULL,
  $q$Logistics operators, 3PLs, shippers and fleet owners$q$,
  $q$Raising a Seed round (size not specified)$q$,
  ARRAY['logistics','supply chain','freight','fleet','warehouse','last-mile','delivery','3PL','shipping','transportation','trucking','route optimization','B2B SaaS','vertical SaaS','enterprise software']::text[]
) on conflict (id) do nothing;

"""
with open(os.path.join(root, "db", "seed.sql"), "w", encoding="utf-8") as f:
    f.write(header + "\n".join(sql) + "\n")
print("wrote data/seed_vcs.csv and db/seed.sql with", len(rows), "VCs")
