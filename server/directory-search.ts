import type { Ctx } from './core';
import { all, one } from './core';

type DirectoryRow = {
  id: string; user_id: number | null; name: string;
  profile_name: string | null; title: string | null; specialty: string | null;
  city: string | null; photo: string | null; allow_contact: number | null;
};
const fields = ['name', 'title', 'specialty', 'city', 'photo'] as const;
const hidden = "COALESCE(v.hidden_fields, json_extract(s.published, '$.hidden'), '[]')";
// Fixed identifiers only. User input is always a bound parameter, never SQL.
function visibleText(field: typeof fields[number]) {
  return `CASE WHEN NOT EXISTS (SELECT 1 FROM json_each(hidden_fields) h WHERE h.value='${field}')
    AND json_type(published, '$.${field}')='text' THEN json_extract(published, '$.${field}') ELSE NULL END`;
}
const eligible = `WITH eligible AS (
  SELECT s.id, s.user_id, n.name, s.published, s.updated_at,
    CASE WHEN json_valid(${hidden}) THEN ${hidden}
      ELSE '["name","title","specialty","city","photo","allowContact"]' END AS hidden_fields
  FROM sites s JOIN dns_names n ON n.site_id=s.id
  LEFT JOIN site_visibility v ON v.site_id=s.id
  JOIN users u ON u.id=COALESCE(s.user_id,n.owner_id)
  WHERE u.status='active' AND s.status='published' AND s.published IS NOT NULL
    AND json_valid(s.published) AND COALESCE(v.visible,1)=1
    AND COALESCE(v.listed,s.searchable)=1 AND (s.lock_hash IS NULL OR s.lock_hash='')
), visible AS (
  SELECT id,user_id,name,updated_at,${visibleText('name')} AS profile_name,
    ${visibleText('title')} AS title,${visibleText('specialty')} AS specialty,
    ${visibleText('city')} AS city,${visibleText('photo')} AS photo,
    CASE WHEN EXISTS (SELECT 1 FROM json_each(hidden_fields) h WHERE h.value='allowContact') THEN 0
      WHEN json_type(published,'$.allowContact') IN ('true','false') THEN json_extract(published,'$.allowContact')
      ELSE NULL END AS allow_contact,
    CASE WHEN EXISTS (SELECT 1 FROM json_each(hidden_fields) h WHERE h.value='specialty') THEN NULL
      WHEN json_type(published,'$.specialty')='text' AND trim(json_extract(published,'$.specialty'))<>''
        THEN json_extract(published,'$.specialty')
      ELSE ${visibleText('title')} END AS search_specialty
  FROM eligible
)`;
const matches = `WHERE instr(lower(name || ' ' || CASE WHEN user_id IS NULL THEN '' ELSE 'c'||user_id END
  || ' ' || COALESCE(profile_name,'') || ' ' || COALESCE(title,'')
  || ' ' || COALESCE(specialty,'') || ' ' || COALESCE(city,'')), ?) > 0
  AND (?='' OR lower(trim(COALESCE(city,'')))=?)
  AND (?='' OR lower(trim(COALESCE(search_specialty,'')))=?)`;
const pageSize = 20;
const facetLimit = 200;

/** Read-only directory: filtering and pagination happen in D1, not over a 200-row sample. */
export async function searchDirectory(c: Ctx) {
  const query = (c.req.query('q') || '').slice(0,100).trim().toLocaleLowerCase();
  const city = (c.req.query('city') || '').slice(0,120).trim().toLocaleLowerCase();
  const specialty = (c.req.query('specialty') || '').slice(0,120).trim().toLocaleLowerCase();
  const suppliedOffset = Number(c.req.query('offset') || 0);
  const offset = Number.isFinite(suppliedOffset) ? Math.min(1_000_000,Math.max(0,Math.floor(suppliedOffset))) : 0;
  const params = [query,city,city,specialty,specialty];
  // Return scalar fields only; even a large profile cannot inflate the directory response.
  const rows = await all<DirectoryRow>(c,`${eligible} SELECT id,user_id,name,profile_name,title,specialty,city,photo,allow_contact
    FROM visible ${matches} ORDER BY updated_at DESC,id ASC LIMIT ? OFFSET ?`,...params,pageSize,offset);
  const count = await one<{ total: number }>(c,`${eligible} SELECT COUNT(*) AS total FROM visible ${matches}`,...params);
  const cities = await all<{ value: string }>(c,`${eligible} SELECT DISTINCT city AS value FROM visible
    WHERE city IS NOT NULL AND trim(city)<>'' ORDER BY value LIMIT ?`,facetLimit+1);
  const specialties = await all<{ value: string }>(c,`${eligible} SELECT DISTINCT search_specialty AS value FROM visible
    WHERE search_specialty IS NOT NULL AND trim(search_specialty)<>'' ORDER BY value LIMIT ?`,facetLimit+1);
  return {
    items: rows.map(row => {
      const profile: Record<string, string | boolean> = {};
      for (const [field,value] of Object.entries({ name:row.profile_name,title:row.title,specialty:row.specialty,city:row.city,photo:row.photo })) {
        if (typeof value==='string') profile[field]=value;
      }
      if (row.allow_contact!==null) profile.allowContact=Boolean(row.allow_contact);
      return { site:row.id,name:row.name,userId:row.user_id?'C'+row.user_id:null,profile,url:'https://'+row.name+'.'+c.env.ROOT_DOMAIN };
    }),
    total: count?.total || 0,
    cities: cities.slice(0,facetLimit).map(row=>row.value),
    specialties: specialties.slice(0,facetLimit).map(row=>row.value),
    facetsTruncated: { cities:cities.length>facetLimit,specialties:specialties.length>facetLimit },
  };
}
