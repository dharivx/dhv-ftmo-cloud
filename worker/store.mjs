export const UPSERT_MESSAGES=`INSERT INTO messages (id,source_key,category,payload,deliver_at,expires_at,created_at)
SELECT json_extract(value,'$.id'),json_extract(value,'$.source_key'),json_extract(value,'$.category'),json_extract(value,'$.payload'),json_extract(value,'$.deliver_at'),json_extract(value,'$.expires_at'),json_extract(value,'$.created_at')
FROM json_each(?) WHERE true
ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,deliver_at=excluded.deliver_at,expires_at=excluded.expires_at
WHERE messages.sent_at IS NULL`;
export async function enqueue(db,messages) {
  if(messages.length) await db.prepare(UPSERT_MESSAGES).bind(JSON.stringify(messages)).run();
}
export async function putSnapshot(db,p,rows,now) {
  await db.batch([
    db.prepare(`INSERT INTO snapshots(source_key,payload,revision,checked_at,attempted_at,error) VALUES(?,?,?,?,?,NULL)
      ON CONFLICT(source_key) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,checked_at=excluded.checked_at,attempted_at=excluded.attempted_at,error=NULL`)
      .bind(p.key,JSON.stringify(p),p.revision,p.checkedAt,now),
    db.prepare(`DELETE FROM messages WHERE source_key=? AND sent_at IS NULL AND category='reminder' AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(p.key,JSON.stringify(rows)),
    db.prepare(`DELETE FROM messages WHERE source_key=? AND sent_at IS NULL AND category='source-error'`).bind(p.key),
    db.prepare(UPSERT_MESSAGES).bind(JSON.stringify(rows)),
  ]);
}
export async function claim(db,now,token) {
  const r=await db.prepare(`UPDATE messages SET lease_until=?,lease_token=? WHERE id IN
    (SELECT id FROM messages WHERE sent_at IS NULL AND deliver_at<=? AND expires_at>? AND next_attempt<=? AND lease_until<=? ORDER BY deliver_at,id LIMIT 3)
    RETURNING *`).bind(now+180000,token,now,now,now,now).all();
  return r.results;
}
