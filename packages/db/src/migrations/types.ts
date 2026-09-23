export interface Migration {
  id: string;
  checksum: string;
  sql: string;
}
