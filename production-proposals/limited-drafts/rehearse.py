from pathlib import Path
import sqlite3,time
root=Path(__file__).resolve().parents[2]
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
for name in ['0001_discovery.sql','0002_sample_content.sql','0003_oauth_attempts.sql','0004_private_sessions.sql','0012_browser_session_order.sql']:
    db.executescript((root/'migrations'/name).read_text())
db.execute('CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY,name TEXT UNIQUE)')
for n,name in enumerate(['0001','0002','0003','0004','0012'],1):db.execute('INSERT INTO d1_migrations VALUES(?,?)',(n,name))
db.execute("INSERT INTO private_accounts(id,google_subject,email,status,created_at_ms) VALUES('fixture-a','fictional-subject','fictional@example.invalid','pending',0)")
db.commit()
tables=['content','public_profiles','private_accounts','d1_migrations']
before={t:db.execute('SELECT * FROM '+t+' ORDER BY 1').fetchall() for t in tables}
for f in ['0005-private-drafts.sql','limited-draft-grants.sql']:db.executescript((Path(__file__).parent/f).read_text())
assert before=={t:db.execute('SELECT * FROM '+t+' ORDER BY 1').fetchall() for t in tables}
assert db.execute('SELECT status,session_epoch FROM private_accounts').fetchone()==('pending',0)
assert db.execute('SELECT count(*) FROM limited_draft_grants').fetchone()[0]==0
# A pending account is not admitted; this grant is a fictional draft-only trial.
epoch=db.execute("SELECT session_epoch FROM private_accounts WHERE id='fixture-a'").fetchone()[0]
now=int(time.time()*1000);expiry=now+30000
db.execute('INSERT INTO limited_draft_grants(account_id,account_epoch,expires_at_ms) VALUES(?,?,?)',('fixture-a',epoch,expiry))
try:
    db.execute('INSERT INTO limited_draft_grants(singleton,account_id,account_epoch,expires_at_ms) VALUES(2,?,?,?)',('fixture-a',epoch,expiry))
    raise AssertionError('second grant accepted')
except sqlite3.IntegrityError:pass
sql="SELECT count(*) FROM limited_draft_grants g JOIN private_accounts a ON a.id=g.account_id WHERE a.status='pending' AND a.session_epoch=g.account_epoch AND g.revoked_at_ms IS NULL AND g.expires_at_ms>CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)"
assert db.execute(sql).fetchone()[0]==1
db.execute('UPDATE limited_draft_grants SET expires_at_ms=? WHERE singleton=1',(now-1,))
assert db.execute(sql).fetchone()[0]==0
db.execute('UPDATE limited_draft_grants SET expires_at_ms=? WHERE singleton=1',(expiry,))
db.execute('UPDATE limited_draft_grants SET revoked_at_ms=? WHERE singleton=1',(now,))
assert db.execute(sql).fetchone()[0]==0
assert db.execute('SELECT count(*) FROM private_article_drafts').fetchone()[0]==0
assert db.execute('SELECT status,session_epoch FROM private_accounts').fetchone()==('pending',0)
print('PASS: existing sample/account/ledger preserved; fictional pending trial only; single grant; DB-time expiry and revocation guards')
