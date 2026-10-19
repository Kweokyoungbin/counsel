
    if (req.method === 'POST' && url.pathname === '/api/music/recommend') {
      const apiKey = process.env.GEMINI_API_KEY;
      const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

      if (!apiKey) {
        return send(res, 503, {
          error: 'Gemini API 키가 서버에 설정되지 않았어.'
        });
      }

      const body = await readBody(req);
      const messages = Array.isArray(body.messages) ? body.messages : [];

      const context = messages
        .filter(m =>
          m &&
          ['user', 'model'].includes(m.role) &&
          typeof m.text === 'string' &&
          m.text.trim()
        )
        .slice(-12)
        .map(m =>
          `${m.role === 'user' ? '학생' : '상담 AI'}: ${m.text.slice(0, 2500)}`
        )
        .join('\n');

      if (
        !context ||
        !messages.some(m =>
          m &&
          m.role === 'user' &&
          typeof m.text === 'string' &&
          m.text.trim()
        )
      ) {
        return send(res, 400, {
          error: '먼저 상담에서 고민을 이야기해 줘.'
        });
      }

      const prompt = `학생의 실제 고민과 상담 대화를 바탕으로 가사 주제와 의미가 고민에 잘 맞는 노래 5곡을 추천해.
단순히 분위기가 비슷한 곡이 아니라, 노래가 다루는 이야기와 메시지가 왜 고민에 맞는지 설명해.
실제로 존재하는 곡을 선택하고, 한국어와 영어 곡을 적절히 섞어 줘.
가사를 길게 인용하지 마.
JSON 배열만 반환해:
[{"title":"곡 제목","artist":"가수","reason":"고민과 노래의 주제가 연결되는 이유"}]

상담 대화:
${context}`;

      try {
        let response;
        let raw = '';
        let result = {};
        const maxAttempts = 4;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
              },
              body: JSON.stringify({
                contents: [
                  {
                    role: 'user',
                    parts: [{ text: prompt }]
                  }
                ],
                generationConfig: {
                  temperature: 0.45,
                  maxOutputTokens: 1200,
                  responseMimeType: 'application/json'
                }
              }),
              signal: AbortSignal.timeout(45000)
            }
          );

          raw = await response.text();
          try {
            result = raw ? JSON.parse(raw) : {};
          } catch {
            result = {};
          }

          if (response.ok) break;

          const retryable = [429, 500, 502, 503, 504]
            .includes(response.status);

          if (!retryable || attempt === maxAttempts - 1) break;

          const delay = 1500 * (2 ** attempt);
          console.log(
            `곡 추천 Gemini 오류 ${response.status}. ` +
            `${delay}ms 후 ${attempt + 2}/${maxAttempts}회차 재시도`
          );

          await new Promise(resolve => setTimeout(resolve, delay));
        }

        if (!response || !response.ok) {
          const status = response ? response.status : 502;
          const detail = result?.error?.message || raw || '상세 오류 없음';

          console.error('Gemini music recommendation error:', status, detail);

          return send(res, 502, {
            error: status === 503 || status === 429
              ? 'AI 노래 추천 서버가 혼잡해. 잠시 기다렸다가 다시 시도해 줘.'
              : 'AI 노래 추천 요청에 실패했어.',
            upstreamStatus: status
          });
        }

        const answer = (
          result.candidates?.[0]?.content?.parts || []
        ).map(p => p.text || '').join('').trim();

        let songs = [];

        try {
          const cleaned = answer
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '');

          const parsed = JSON.parse(cleaned);
          songs = Array.isArray(parsed) ? parsed : (parsed.songs || []);
        } catch (err) {
          console.error('곡 추천 JSON 파싱 오류:', err.message);
        }

        songs = songs
          .filter(s =>
            s &&
            typeof s.title === 'string' &&
            typeof s.artist === 'string'
          )
          .slice(0, 5)
          .map(s => ({
            title: s.title.slice(0, 120),
            artist: s.artist.slice(0, 120),
            reason: String(
              s.reason || '상담 내용과 주제가 연결되는 곡이야.'
            ).slice(0, 500),
            youtubeUrl:
              'https://www.youtube.com/results?search_query=' +
              encodeURIComponent(s.title + ' ' + s.artist)
          }));

        if (!songs.length) {
          console.error('Gemini 곡 추천 응답:', answer.slice(0, 1500));

          return send(res, 502, {
            error: '추천 결과를 해석하지 못했어. 다시 시도해 줘.'
          });
        }

        return send(res, 200, { songs });

      } catch (err) {
        console.error(
          'Music recommendation error:',
          err.name || 'Error',
          err.message || ''
        );

        return send(res, 502, {
          error: err.name === 'TimeoutError'
            ? '노래 추천 시간이 초과됐어. 잠시 후 다시 시도해 줘.'
            : '노래 추천 서버에 연결하지 못했어.'
        });
      }
    }
