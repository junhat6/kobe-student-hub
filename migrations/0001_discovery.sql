CREATE TABLE public_profiles (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, department TEXT NOT NULL,
 year_label TEXT NOT NULL, bio TEXT NOT NULL, initials TEXT NOT NULL,
 is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1))
);
CREATE TABLE content (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('article','project')),
 title TEXT NOT NULL, summary TEXT NOT NULL, body TEXT NOT NULL,
 tags_json TEXT NOT NULL CHECK(json_valid(tags_json)),
 author_id TEXT NOT NULL REFERENCES public_profiles(id),
 audience TEXT NOT NULL, prerequisite TEXT NOT NULL, outcome TEXT NOT NULL,
 updated_at TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes > 0),
 related_ids_json TEXT NOT NULL CHECK(json_valid(related_ids_json)),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','hidden','deleted')),
 is_sample INTEGER NOT NULL DEFAULT 0 CHECK(is_sample IN (0,1))
);
CREATE INDEX content_public_feed ON content(status,is_sample,updated_at DESC);
CREATE INDEX content_author ON content(author_id,status,is_sample);
