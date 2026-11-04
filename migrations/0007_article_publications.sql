-- Local snapshot boundary only. No enrollment/admission, profile editing, publication route, or retention policy.
CREATE TABLE account_public_profiles (
 owner_account_id TEXT NOT NULL PRIMARY KEY REFERENCES private_accounts(id) ON DELETE CASCADE,
 public_profile_id TEXT NOT NULL UNIQUE REFERENCES public_profiles(id)
);
CREATE TABLE article_publications (
 content_id TEXT NOT NULL PRIMARY KEY REFERENCES content(id) CHECK(length(content_id)=36),
 owner_account_id TEXT REFERENCES private_accounts(id) ON DELETE SET NULL,
 draft_id TEXT UNIQUE REFERENCES private_article_drafts(id) ON DELETE SET NULL,
 public_profile_id TEXT NOT NULL REFERENCES public_profiles(id),
 source_version INTEGER NOT NULL CHECK(source_version BETWEEN 1 AND 9007199254740991),
 summary TEXT NOT NULL CHECK(length(summary)<=300),
 tags_json TEXT NOT NULL CHECK(json_valid(tags_json) AND json_type(tags_json)='array' AND json_array_length(tags_json)<=5),
 audience TEXT NOT NULL CHECK(length(audience)<=200),
 prerequisite TEXT NOT NULL CHECK(length(prerequisite)<=200),
 outcome TEXT NOT NULL CHECK(length(outcome)<=200),
 minutes INTEGER NOT NULL CHECK(minutes BETWEEN 1 AND 240),
 published_at_ms INTEGER NOT NULL CHECK(published_at_ms BETWEEN 0 AND 253402300799999)
);
CREATE TRIGGER article_publications_snapshot AFTER INSERT ON article_publications BEGIN INSERT INTO content(id,kind,title,summary,body,tags_json,author_id,audience,prerequisite,outcome,updated_at,minutes,related_ids_json,status,is_sample) SELECT NEW.content_id,'article',d.title,NEW.summary,d.body,NEW.tags_json,NEW.public_profile_id,NEW.audience,NEW.prerequisite,NEW.outcome,strftime('%Y-%m-%d',NEW.published_at_ms/1000,'unixepoch'),NEW.minutes,'[]','published',0 FROM private_article_drafts d JOIN account_public_profiles m ON m.owner_account_id=d.owner_account_id JOIN public_profiles p ON p.id=m.public_profile_id WHERE d.id=NEW.draft_id AND d.owner_account_id=NEW.owner_account_id AND d.version=NEW.source_version AND d.updated_at_ms<=NEW.published_at_ms AND length(trim(d.title,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND length(d.title)<=200 AND instr(d.title,char(0))=0 AND length(CAST(d.title AS BLOB))<=800 AND length(trim(d.body,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND length(CAST(d.body AS BLOB))<=262144 AND NOT EXISTS(SELECT 1 FROM private_accounts private_id WHERE private_id.id=m.public_profile_id OR private_id.google_subject=m.public_profile_id) AND p.id=NEW.public_profile_id AND p.is_sample=0 AND length(p.id) BETWEEN 1 AND 128 AND instr(p.id,char(0))=0 AND length(CAST(p.id AS BLOB))<=512 AND substr(p.id,1,1) GLOB '[A-Za-z0-9]' AND p.id NOT GLOB '*[^A-Za-z0-9_-]*' AND length(trim(p.display_name,char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)))>0 AND length(p.display_name)<=80 AND instr(p.display_name,char(0))=0 AND length(CAST(p.display_name AS BLOB))<=320 AND length(p.department)<=80 AND instr(p.department,char(0))=0 AND length(CAST(p.department AS BLOB))<=320 AND length(p.year_label)<=32 AND instr(p.year_label,char(0))=0 AND length(CAST(p.year_label AS BLOB))<=128 AND length(p.bio)<=800 AND instr(p.bio,char(0))=0 AND length(CAST(p.bio AS BLOB))<=3200 AND length(p.initials)<=8 AND instr(p.initials,char(0))=0 AND length(CAST(p.initials AS BLOB))<=32; SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'publication unavailable') END; END;
