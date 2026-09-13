const DAY = 86400000;
export const fail = code => Object.assign(new Error(code), { code });
export function syncWindow(now = Date.now()) { return { timeMin: new Date(now - 90 * DAY).toISOString(), timeMax: new Date(now + 365 * DAY).toISOString() }; }
export async function googleFetch(fetchImpl, url, options = {}) {
  const target = new URL(url);
  if (!['www.googleapis.com', 'oauth2.googleapis.com', 'openidconnect.googleapis.com'].includes(target.hostname) || target.protocol !== 'https:') throw fail('CALENDAR_INVALID_INPUT');
  try { return await fetchImpl(target.toString(), { ...options, redirect: 'error', signal: AbortSignal.timeout(12000) }); }
  catch { throw fail('CALENDAR_TEMPORARY_FAILURE'); }
}
export async function googleJson(fetchImpl, url, options) {
  const response = await googleFetch(fetchImpl, url, options);
  let data; try { data = await response.json(); } catch { throw fail('CALENDAR_TEMPORARY_FAILURE'); }
  if (!response.ok) throw fail(data?.error === 'invalid_grant' || response.status === 401 ? 'CALENDAR_RECONNECT' : response.status === 410 ? 'CALENDAR_TOKEN_EXPIRED' : 'CALENDAR_TEMPORARY_FAILURE');
  return data;
}
function normalize(event, calendarId) {
  if (!event?.id || typeof event.id !== 'string') throw fail('CALENDAR_INVALID_RESPONSE');
  if (event.status === 'cancelled') return { id: event.id, status: 'cancelled' };
  const allDay = Boolean(event.start?.date);
  const start = allDay ? event.start.date : event.start?.dateTime, end = allDay ? event.end?.date : event.end?.dateTime;
  const valid = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && (allDay ? /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0,10) === value : /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value));
  if (!valid(start) || !valid(end) || Date.parse(end) <= Date.parse(start)) throw fail('CALENDAR_INVALID_RESPONSE');
  return { id: event.id, calendarId, title: String(event.summary || '(제목 없음)').slice(0,1000), description: String(event.description || '').slice(0,10000), location: String(event.location || '').slice(0,2000), start, end, allDay, status: event.status === 'tentative' ? 'tentative' : 'confirmed' };
}
export async function syncCalendar({ calendarId, previous, accessToken, fetchImpl = fetch, now = Date.now(), window = syncWindow(now) }) {
  const incremental = Boolean(previous?.syncToken && now - previous.fullSyncedAt < DAY);
  const bounds = incremental ? previous.window || window : window;
  const events = new Map(incremental ? (previous.events || []).map(e => [e.id,e]) : []);
  let pageToken = '', count = 0;
  do {
    if (++count > 50) throw fail('CALENDAR_LIMIT_EXCEEDED');
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set('fields','nextPageToken,nextSyncToken,items(id,status,summary,description,location,start,end)');
    Object.entries({ singleEvents:'true', showDeleted:'true', maxResults:'1000', ...(incremental ? { syncToken:previous.syncToken } : bounds), ...(pageToken ? {pageToken} : {}) }).forEach(([k,v]) => url.searchParams.set(k,v));
    let data;
    try { data = await googleJson(fetchImpl,url,{headers:{authorization:`Bearer ${accessToken}`}}); }
    catch(error) { if (error.code === 'CALENDAR_TOKEN_EXPIRED' && incremental) return syncCalendar({calendarId,accessToken,fetchImpl,now,window}); throw error; }
    if (!Array.isArray(data.items || [])) throw fail('CALENDAR_INVALID_RESPONSE');
    for (const raw of data.items || []) {
      const e=normalize(raw,calendarId);
      if(e.status==='cancelled' || Date.parse(e.end)<=Date.parse(bounds.timeMin) || Date.parse(e.start)>=Date.parse(bounds.timeMax)) events.delete(e.id); else events.set(e.id,e);
      if(events.size>10000) throw fail('CALENDAR_LIMIT_EXCEEDED');
    }
    pageToken=data.nextPageToken || '';
    if (!pageToken) {
      if(typeof data.nextSyncToken !== 'string' || !data.nextSyncToken) throw fail('CALENDAR_INVALID_RESPONSE');
      return { events:[...events.values()], syncToken:data.nextSyncToken, window:bounds, fullSyncedAt:incremental?previous.fullSyncedAt:now, lastSyncedAt:new Date(now).toISOString() };
    }
  } while(pageToken);
}
