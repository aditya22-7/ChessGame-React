const journalDDL = `CREATE TABLE IF NOT EXISTS schema_migration (
  version CHAR(3) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  filename VARCHAR(128) NOT NULL,
  checksum CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at DATETIME(3) NULL,
  failure_code VARCHAR(64) NULL,
  CONSTRAINT ck_migration_status CHECK (status IN ('RUNNING','APPLIED','FAILED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`;
module.exports={journalDDL};
