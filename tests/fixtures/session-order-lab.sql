-- Local Miniflare fixture ONLY. Not a migration. All accounts/content are fictional.
-- @statement
CREATE TABLE lab_contexts(id TEXT PRIMARY KEY,epoch INTEGER NOT NULL DEFAULT 0 CHECK(epoch BETWEEN 0 AND 9007199254740991),expires INTEGER NOT NULL);
-- @statement
CREATE TABLE lab_commands(id TEXT PRIMARY KEY,context TEXT NOT NULL REFERENCES lab_contexts(id),action TEXT NOT NULL CHECK(action IN('start','logout')),expected INTEGER NOT NULL,expires INTEGER NOT NULL,completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),attempt TEXT UNIQUE);
-- @statement
CREATE TABLE lab_attempts(id TEXT PRIMARY KEY,context TEXT NOT NULL REFERENCES lab_contexts(id),epoch INTEGER NOT NULL,expires INTEGER NOT NULL,owner TEXT,completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)));
-- @statement
CREATE TRIGGER lab_command_commit AFTER UPDATE OF completed ON lab_commands WHEN OLD.completed=0 AND NEW.completed=1 BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM lab_contexts WHERE id=NEW.context AND epoch=NEW.expected AND epoch<9007199254740991) THEN RAISE(ABORT,'lab epoch conflict') END;
 UPDATE lab_contexts SET epoch=epoch+1 WHERE id=NEW.context AND epoch=NEW.expected;
 INSERT INTO lab_attempts(id,context,epoch,expires) SELECT NEW.attempt,NEW.context,NEW.expected+1,NEW.expires WHERE NEW.action='start';
END;
-- @statement
CREATE TABLE lab_accounts(id TEXT PRIMARY KEY,status TEXT NOT NULL CHECK(status IN('active','suspended')),epoch INTEGER NOT NULL DEFAULT 0);
-- @statement
INSERT INTO lab_accounts VALUES('A','active',0),('B','active',0);
-- @statement
CREATE TABLE lab_sessions(token TEXT PRIMARY KEY,context TEXT NOT NULL REFERENCES lab_contexts(id),epoch INTEGER NOT NULL,attempt TEXT NOT NULL UNIQUE REFERENCES lab_attempts(id),actor TEXT NOT NULL REFERENCES lab_accounts(id),account_epoch INTEGER NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
-- @statement
CREATE TRIGGER lab_session_commit AFTER INSERT ON lab_sessions BEGIN UPDATE lab_attempts SET completed=1 WHERE id=NEW.attempt; END;
-- @statement
CREATE TABLE lab_records(actor TEXT PRIMARY KEY REFERENCES lab_accounts(id),value TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
-- @statement
INSERT INTO lab_records VALUES('A','fictional-A',0),('B','fictional-B',0);
