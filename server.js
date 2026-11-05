const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// .env 파일의 설정을 읽어 환경변수로 등록
const envPath = path.join(__dirname, '.env');

if (fs.existsSync(envPath)) {
  const envText = fs.readFileSync(envPath, 'utf8');

  for (const line of envText.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) continue;

    const index = trimmed.indexOf('=');
    if (index < 1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();

    if (key && process.env[key] === undefined) {
      process.env[key] = value.replace(/^["']|["']$/g, '');
    }
  }
}

const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'demo-admin';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 60000);
// 선택: 생각(thinking) 수준을 낮추고 싶을 때 Render 환경변수에 GEMINI_THINKING_LEVEL=low 등으로 설정
function thinkingCfg() {
  const lv = process.env.GEMINI_THINKING_LEVEL;
  return lv ? { thinkingConfig: { thinkingLevel: lv } } : {};
}
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'human-requests.json');
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');

function readRequests() {
  try { const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); return Array.isArray(data) ? data : []; }
  catch { return []; }
}
function writeRequests(data) {
  const temp = DATA_FILE + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(temp, DATA_FILE);
}
function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(type.startsWith('application/json') ? JSON.stringify(data) : data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; if (raw.length > 200000) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('invalid json')); } });
    req.on('error', reject);
  });
}
function isAdmin(req) { return Boolean(ADMIN_PASSWORD) && req.headers['x-admin-password'] === ADMIN_PASSWORD; }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

async function fetchGeminiWithRetry(url, options, maxAttempts = 3) {
  let response;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    response = await fetch(url, options);
    if (![500, 502, 503, 504].includes(response.status) || attempt === maxAttempts - 1) return response;
    // 일시적인 과부하/서버 오류에만 짧게 재시도한다.
    await new Promise(resolve => setTimeout(resolve, 1200 * (attempt + 1)));
  }
  return response;
}


// ===== Gemini 한도/오류 시 사용할 대체 추천 곡 (미리 준비한 목록) =====
const FALLBACK_CATEGORIES = [
  { re: /힘들|지치|지쳤|피곤|우울|슬프|눈물|번아웃|스트레스|힘내|포기/g, songs: [
    ['수고했어 오늘도', '옥상달빛', '하루를 버텨 낸 나에게 수고했다고 말해 주는 노래야.'],
    ['Fix You', 'Coldplay', '힘들어하는 사람 곁에서 다시 괜찮아질 수 있다고 다독이는 노래야.'],
    ['한숨', '이하이', '지친 마음을 알아주고 숨 쉴 틈을 건네는 노래야.'],
    ['Lean on Me', 'Bill Withers', '혼자 짊어지지 말고 기대도 된다는 메시지를 담은 노래야.'],
    ['Rise Up', 'Andra Day', '힘든 시간 속에서도 다시 일어서자는 이야기를 담은 노래야.'] ] },
  { re: /불안|걱정|긴장|무서|떨리|초조|두려/g, songs: [
    ['Let It Be', 'The Beatles', '걱정이 클 때 조금 내려놓고 흐름에 맡겨 보자는 노래야.'],
    ['Three Little Birds', 'Bob Marley', '모든 게 괜찮아질 거라고 부드럽게 말해 주는 노래야.'],
    ['밤편지', '아이유', '차분한 분위기라 복잡한 생각을 가라앉히고 싶을 때 어울려.'],
    ['Weightless', 'Marconi Union', '가사 없이 잔잔해서 긴장을 가라앉힐 때 자주 추천되는 곡이야.'] ] },
  { re: /외롭|혼자|고독|쓸쓸|소외|왕따|아무도/g, songs: [
    ['홀로', '이하이', '혼자라는 감정을 솔직하게 마주하는 노래야.'],
    ['The Sound of Silence', 'Simon & Garfunkel', '소통이 끊긴 듯한 고립감을 다룬 노래야.'],
    ["You've Got a Friend", 'James Taylor', '힘들 때 곁에 있어 주겠다는 약속을 담은 노래야.'],
    ['Mad World', 'Gary Jules', '세상과 어긋난 듯한 쓸쓸함을 차분하게 풀어낸 노래야.'] ] },
  { re: /친구|우정|관계|싸웠|싸움|멀어|오해|따돌|사이가/g, songs: [
    ['Count on Me', 'Bruno Mars', '힘들 때 서로 기댈 수 있는 친구 사이를 노래해.'],
    ['Lean on Me', 'Bill Withers', '서로에게 기대며 함께 버티자는 메시지를 담았어.'],
    ["You've Got a Friend", 'James Taylor', '친구가 곁에 있다는 믿음을 전하는 노래야.'],
    ['With a Little Help from My Friends', 'The Beatles', '친구의 작은 도움이 큰 힘이 된다는 이야기를 담았어.'] ] },
  { re: /공부|시험|성적|수행|입시|진로|목표|미래|꿈|노력|결과/g, songs: [
    ['Fight Song', 'Rachel Platten', '내 안의 힘을 믿고 계속 나아가자는 노래야.'],
    ['나의 사춘기에게', '볼빨간사춘기', '불안한 시기를 지나는 나 자신에게 건네는 이야기야.'],
    ["Don't Stop Believin'", 'Journey', '포기하지 않고 계속 믿고 나아가자는 메시지를 담았어.'],
    ['Rise Up', 'Andra Day', '힘든 시간 속에서도 다시 일어서자는 이야기를 담은 노래야.'] ] },
  { re: /이별|헤어|그리워|보고 싶|연애|짝사랑|차였/g, songs: [
    ['눈사람', '정승환', '이별 뒤에 남은 마음을 담담하게 풀어낸 노래야.'],
    ['Someone Like You', 'Adele', '떠난 사람을 떠올리며 마음을 정리해 가는 노래야.'],
    ['Say Something', 'A Great Big World', '멀어지는 관계 앞에서의 아픈 마음을 담은 노래야.'],
    ['어떻게 이별까지 사랑하겠어, 널 사랑하는 거지', '악동뮤지션', '이별을 받아들이는 복잡한 마음을 담은 노래야.'] ] },
  { re: /자존감|자신감|못생|비교|열등|부족|쓸모|못난|실패|자책/g, songs: [
    ['Scars To Your Beautiful', 'Alessia Cara', '있는 그대로의 내 모습이 충분히 아름답다고 말해 주는 노래야.'],
    ['Just the Way You Are', 'Bruno Mars', '지금 모습 그대로도 괜찮다는 메시지를 전하는 노래야.'],
    ['Unwritten', 'Natasha Bedingfield', '아직 쓰이지 않은 내 이야기는 내가 만든다는 노래야.'],
    ['나의 사춘기에게', '볼빨간사춘기', '불안하고 흔들리는 나 자신에게 건네는 이야기야.'] ] },
  { re: /화나|화가|짜증|억울|분노|답답/g, songs: [
    ['Let It Go', 'Idina Menzel', '붙들고 있던 감정을 털어내고 싶을 때 어울리는 노래야.'],
    ['Shake It Off', 'Taylor Swift', '남의 시선과 말을 가볍게 털어내자는 노래야.'],
    ['Fight Song', 'Rachel Platten', '답답한 마음을 힘으로 바꾸고 싶을 때 어울리는 노래야.'] ] }
];
const FALLBACK_DEFAULT = [
  ['수고했어 오늘도', '옥상달빛', '하루를 버텨 낸 나에게 수고했다고 말해 주는 노래야.'],
  ['Fix You', 'Coldplay', '힘들어하는 사람 곁에서 다시 괜찮아질 수 있다고 다독이는 노래야.'],
  ['밤편지', '아이유', '차분한 분위기라 복잡한 생각을 가라앉히고 싶을 때 어울려.'],
  ['한숨', '이하이', '지친 마음을 알아주고 숨 쉴 틈을 건네는 노래야.'],
  ['Let It Be', 'The Beatles', '걱정이 클 때 조금 내려놓고 흐름에 맡겨 보자는 노래야.']
];
function pickFallbackSongs(text) {
  const t = String(text || '');
  const matched = FALLBACK_CATEGORIES
    .map(c => ({ c, n: (t.match(c.re) || []).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => b.n - a.n);
  const out = []; const seen = new Set();
  const add = row => { const k = row[0] + '|' + row[1]; if (!seen.has(k) && out.length < 5) { seen.add(k); out.push(row); } };
  for (let i = 0; out.length < 5 && i < 4; i++) matched.forEach(x => { if (x.c.songs[i]) add(x.c.songs[i]); });
  FALLBACK_DEFAULT.forEach(add);
  return out.map(([title, artist, reason]) => ({ title, artist, reason, youtubeUrl: 'https://www.youtube.com/results?search_query=' + encodeURIComponent(title + ' ' + artist) }));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, service: 'chinguya-jim', time: new Date().toISOString() });
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return send(res, 200, { supabaseUrl: process.env.SUPABASE_URL || '', supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || '' });
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') {
      const apiKey = process.env.GEMINI_API_KEY;
      const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

      if (!apiKey) {
        return send(res, 503, {
          error: 'GEMINI_API_KEY가 설정되지 않았습니다. .env 파일을 확인하세요.'
        });
      }

      const body = await readBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];

      const contents = messages
        .filter(m =>
          m &&
          ['user', 'model'].includes(m.role) &&
          typeof m.text === 'string' &&
          m.text.trim()
        )
        .slice(-20)
        .map(m => ({
          role: m.role,
          parts: [{ text: m.text.slice(0, 6000) }]
        }));

      if (!contents.length || !contents.some(m => m.role === 'user')) {
        return send(res, 400, { error: '상담 메시지를 입력해 주세요.' });
      }

      const t0 = Date.now();
      try {
        const response = await fetchGeminiWithRetry(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
              systemInstruction: {
                parts: [{
                  text: '너는 학생의 고민을 듣는 따뜻하고 신중한 상담 도우미다. 먼저 감정을 공감하고 사용자의 이야기를 충분히 이해하려고 한다. 성급하게 판단하거나 진단하지 말고, 필요할 때만 현실적인 선택지를 몇 가지 제안한다. 한 번에 질문을 너무 많이 하지 않는다. 한국어로 자연스럽게 답한다.'
                }]
              },
              contents,
              generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 2048,
                ...thinkingCfg()
              }
            }),
            signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS)
          }
        );

        console.log(`[chat] model=${model} status=${response.status} ${Date.now() - t0}ms`);
        const responseText = await response.text();
        let result = {};
        try {
          result = responseText ? JSON.parse(responseText) : {};
        } catch {
          result = {};
        }

        if (!response.ok) {
          const detail = result?.error?.message || responseText || '상세 오류 메시지가 없습니다.';
          console.error('Gemini API HTTP 오류:', response.status);
          console.error('Gemini 상세 오류:', detail);

          return send(res, 502, {
            error: 'Gemini API 요청에 실패했습니다.',
            upstreamStatus: response.status,
            details: detail
          });
        }

        const answer = (result.candidates?.[0]?.content?.parts || [])
          .map(part => part.text || '')
          .join('')
          .trim();

        if (!answer) {
          return send(res, 502, {
            error: 'Gemini가 답변을 반환하지 않았습니다. 다른 메시지로 다시 시도해 주세요.'
          });
        }

        return send(res, 200, { reply: answer });
      } catch (err) {
        console.error('Gemini 요청 오류:', err.name || 'Error', err.message || '', err.cause || '');
        return send(res, 502, {
          error: err.name === 'TimeoutError'
            ? 'Gemini 응답 시간이 초과됐습니다. 다시 시도해 주세요.'
            : 'Gemini 서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.'
        });
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/verify') {
      const body = await readBody(req);
      if (!safeEqual(body.password || '', ADMIN_PASSWORD)) return send(res, 401, { error: 'unauthorized' });
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/music/recommend') {
      const apiKey = process.env.GEMINI_API_KEY;
      const model = process.env.GEMINI_MUSIC_MODEL || process.env.GEMINI_MODEL || 'gemini-3.8-flash';
      const body = await readBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const context = messages.filter(m => m && ['user','model'].includes(m.role) && typeof m.text === 'string' && m.text.trim()).slice(-12).map(m => `${m.role === 'user' ? '학생' : '상담 AI'}: ${m.text.slice(0,2500)}`).join('\n');
      if (!context || !messages.some(m => m && m.role === 'user' && typeof m.text === 'string' && m.text.trim())) return send(res, 400, { error: '먼저 상담에서 고민을 이야기해 줘.' });
      const userText = messages.filter(m => m && m.role === 'user' && typeof m.text === 'string').map(m => m.text).join(' ').slice(0, 3000);
      const fallback = why => { console.log('[music] 대체 추천 사용:', why); return send(res, 200, { songs: pickFallbackSongs(userText), fallback: true }); };
      if (!apiKey) return fallback('API 키 없음');
      try {
        const prompt = `학생의 실제 고민과 상담 대화를 바탕으로, 가사 주제와 의미가 고민에 잘 맞는 노래 5곡을 추천해. 기분이 비슷하다는 이유만으로 고르지 말고, 노래가 다루는 이야기와 메시지가 왜 맞는지 설명해. 실제로 존재하는 곡만 선택하고, 가능한 한 한국어/영어 곡을 섞되 자연스럽게 선택해. 가사를 길게 인용하지 마. 아래 JSON 배열만 반환해: [{"title":"곡 제목","artist":"가수","reason":"고민과 노래의 주제가 어떻게 연결되는지 1~2문장"}].
대화:
${context}`;
        const response = await fetchGeminiWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { method:'POST', headers:{'Content-Type':'application/json','x-goog-api-key':apiKey}, body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{temperature:0.45,maxOutputTokens:3000,responseMimeType:'application/json',...thinkingCfg()}}), signal:AbortSignal.timeout(GEMINI_TIMEOUT_MS) });
        console.log(`[music] model=${model} status=${response.status}`); const raw = await response.text(); let result={}; try{result=JSON.parse(raw)}catch{}
        if(!response.ok){const detail=result?.error?.message||raw||'';console.error('Gemini music recommendation error:',response.status,detail);return fallback('Gemini HTTP '+response.status)}
        const answer=(result.candidates?.[0]?.content?.parts||[]).map(p=>p.text||'').join('').trim();
        let songs=[]; const finish=result.candidates?.[0]?.finishReason || '';
        try {
          const cleaned=answer.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
          let parsed;
          try { parsed=JSON.parse(cleaned); }
          catch { const a=cleaned.indexOf('['), b=cleaned.lastIndexOf(']'); parsed=JSON.parse(cleaned.slice(a,b+1)); }
          songs=Array.isArray(parsed)?parsed:(parsed.songs||[]);
        } catch {}
        songs=songs.filter(s=>s && typeof s.title==='string' && typeof s.artist==='string').slice(0,5).map(s=>({title:s.title.slice(0,120),artist:s.artist.slice(0,120),reason:String(s.reason||'상담 내용과 주제가 연결되는 곡이야.').slice(0,500),youtubeUrl:'https://www.youtube.com/results?search_query='+encodeURIComponent(s.title+' '+s.artist)}));
        if(!songs.length){console.error('[music] 곡 목록 없음 finishReason='+finish,'answer='+answer.slice(0,300));return fallback('빈 목록 finishReason='+(finish||'없음'));}
        return send(res,200,{songs});
      } catch(err) { console.error('Music recommendation error:',err.message||err); return fallback(err.name||'오류'); }
    }
    if (url.pathname === '/api/music' && req.method === 'GET') {
      const rawTerms = String(url.searchParams.get('terms') || '').slice(0, 800);
      const terms = [...new Set(rawTerms.split('||').map(x => x.trim()).filter(Boolean))].slice(0, 4);
      if (!terms.length) return send(res, 400, { error: 'search terms required' });
      const batches = await Promise.all(terms.map(async term => {
        try {
          const endpoint = 'https://itunes.apple.com/search?' + new URLSearchParams({ country: 'kr', media: 'music', entity: 'song', limit: '8', term });
          const response = await fetch(endpoint, { signal: AbortSignal.timeout(7000) });
          if (!response.ok) { console.error('[itunes] status=' + response.status, 'term=' + term); return []; }
          const payload = await response.json();
          return Array.isArray(payload.results) ? payload.results : [];
        } catch (err) { console.error('[itunes] 요청 실패', err && err.name, err && err.message); return []; }
      }));
      const seen = new Set();
      const results = batches.flat().filter(track => {
        if (!track.trackName || !track.artistName) return false;
        const key = (track.trackName + '|' + track.artistName).toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key); return true;
      }).slice(0, 8);
      return send(res, 200, { results });
    }
    if (url.pathname === '/api/human-requests' && req.method === 'GET') {
      const records = readRequests();
      if (isAdmin(req)) return send(res, 200, records);
      const clientId = String(req.headers['x-client-id'] || '');
      if (!clientId || clientId.length > 200) return send(res, 401, { error: 'client id required' });
      return send(res, 200, records.filter(r => r.clientId === clientId));
    }
    if (url.pathname === '/api/human-requests' && req.method === 'POST') {
      const body = await readBody(req);
      const clientId = String(req.headers['x-client-id'] || '');
      if (!clientId || clientId.length > 200 || body.clientId !== clientId) return send(res, 401, { error: 'client id mismatch' });
      if (!body.id || !body.user || !body.summary) return send(res, 400, { error: 'missing fields' });
      const records = readRequests();
      if (records.some(r => r.id === body.id)) return send(res, 409, { error: 'duplicate id' });
      records.unshift({ id: String(body.id), chatId: String(body.chatId || ''), user: String(body.user).slice(0, 80), summary: String(body.summary).slice(0, 6000), status: '접수', created: Number(body.created) || Date.now(), reply: '', clientId, repliedAt: null });
      writeRequests(records);
      return send(res, 201, { ok: true });
    }
    const match = url.pathname.match(/^\/api\/human-requests\/([^/]+)$/);
    if (match && req.method === 'PUT') {
      if (!isAdmin(req)) return send(res, 401, { error: 'admin required' });
      const id = decodeURIComponent(match[1]);
      const body = await readBody(req);
      const records = readRequests();
      const item = records.find(r => r.id === id);
      if (!item) return send(res, 404, { error: 'not found' });
      if (typeof body.reply === 'string') item.reply = body.reply.slice(0, 10000);
      if (typeof body.status === 'string') item.status = body.status.slice(0, 40);
      if (body.repliedAt) item.repliedAt = Number(body.repliedAt);
      writeRequests(records);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET') {
      const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      const full = path.resolve(__dirname, '.' + requested);
      if (!full.startsWith(path.resolve(__dirname) + path.sep)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
      fs.readFile(full, (err, data) => {
        if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
        const ext = path.extname(full);
        const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
        send(res, 200, data, type);
      });
      return;
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'internal server error' });
  }
});
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`오류: ${PORT}번 포트가 이미 사용 중입니다. 기존 서버 창을 닫거나 Windows 명령 프롬프트에서 set PORT=3001 후 npm start로 실행하세요.`);
  } else if (err.code === 'EACCES') {
    console.error(`오류: ${PORT}번 포트를 사용할 권한이 없습니다. set PORT=3001 후 npm start로 다시 실행하세요.`);
  } else {
    console.error('서버 시작 오류:', err);
  }
  process.exitCode = 1;
});
server.listen(PORT, '0.0.0.0', () => {
  console.log('[env]', 'GEMINI_API_KEY=' + (process.env.GEMINI_API_KEY ? 'set' : 'MISSING'), 'GEMINI_MODEL=' + (process.env.GEMINI_MODEL || '(default gemini-3.8-flash)'), 'SUPABASE_URL=' + (process.env.SUPABASE_URL ? 'set' : 'MISSING'), 'SUPABASE_PUBLISHABLE_KEY=' + (process.env.SUPABASE_PUBLISHABLE_KEY ? 'set' : 'MISSING'));
  console.log('==============================================');
  console.log('친구야, 짐을 나누자 서버가 실행됐습니다.');
  console.log(`웹앱: http://localhost:${PORT}`);
  console.log(`상태 확인: http://localhost:${PORT}/api/health`);
  console.log('이 창을 닫으면 서버가 종료됩니다.');
  console.log('==============================================');
});
