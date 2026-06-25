const fs = require('fs');
const path = require('path');

const logPath = process.env.OPENCLAW_FETCH_CAPTURE || path.join(process.cwd(), 'openclaw-request-capture.jsonl');
const originalFetch = globalThis.fetch;

function hashSample(value) {
  const text = String(value || '');
  if (!text) return null;
  return {
    length: text.length,
    prefix: text.slice(0, 4),
    suffix: text.slice(-2),
  };
}

function headersToObject(headersLike) {
  const result = {};
  if (!headersLike) return result;
  try {
    const headers = new Headers(headersLike);
    for (const [key, value] of headers.entries()) {
      if (key.toLowerCase() === 'authorization') {
        const parts = value.split(/\s+/);
        result[key] = {
          scheme: parts[0] || '',
          token: hashSample(parts.slice(1).join(' ')),
        };
      } else {
        result[key] = value;
      }
    }
  } catch {
    return { parseError: true };
  }
  return result;
}

function summarizeBody(rawBody) {
  if (typeof rawBody !== 'string') {
    return { type: typeof rawBody, byteLength: rawBody ? Buffer.byteLength(String(rawBody)) : 0 };
  }
  const summary = { type: 'string', byteLength: Buffer.byteLength(rawBody) };
  try {
    const json = JSON.parse(rawBody);
    summary.keys = Object.keys(json);
    summary.model = json.model;
    summary.stream = json.stream;
    summary.maxTokensField = Object.prototype.hasOwnProperty.call(json, 'max_completion_tokens')
      ? 'max_completion_tokens'
      : Object.prototype.hasOwnProperty.call(json, 'max_tokens')
        ? 'max_tokens'
        : null;
    summary.maxTokens = json.max_completion_tokens || json.max_tokens || null;
    summary.toolCount = Array.isArray(json.tools) ? json.tools.length : 0;
    summary.toolStrictValues = Array.isArray(json.tools)
      ? Array.from(new Set(json.tools.map((tool) => tool && tool.function && tool.function.strict)))
      : [];
    summary.messageRoles = Array.isArray(json.messages) ? json.messages.map((message) => message.role) : [];
    summary.messageContentLengths = Array.isArray(json.messages)
      ? json.messages.map((message) => {
        const content = message.content;
        if (typeof content === 'string') return content.length;
        if (Array.isArray(content)) return JSON.stringify(content).length;
        return content == null ? 0 : JSON.stringify(content).length;
      })
      : [];
    summary.extraKeys = Object.keys(json).filter((key) => ![
      'model',
      'messages',
      'stream',
      'stream_options',
      'store',
      'max_completion_tokens',
      'max_tokens',
      'temperature',
      'tools',
      'tool_choice',
    ].includes(key));
    summary.firstSystemPrefix = Array.isArray(json.messages)
      ? String((json.messages.find((message) => message.role === 'system' || message.role === 'developer') || {}).content || '').slice(0, 160)
      : '';
    summary.lastUserPrefix = Array.isArray(json.messages)
      ? String(([...json.messages].reverse().find((message) => message.role === 'user') || {}).content || '').slice(0, 160)
      : '';
  } catch (error) {
    summary.jsonError = error instanceof Error ? error.message : String(error);
  }
  return summary;
}

function write(entry) {
  try {
    fs.appendFileSync(logPath, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
  } catch {
    // Avoid changing application behavior if capture logging fails.
  }
}

function saveBodyForReplay(url, body) {
  const bodyPath = process.env.OPENCLAW_FETCH_BODY_CAPTURE;
  if (!bodyPath || typeof body !== 'string') return;
  if (!String(url || '').includes('/chat/completions')) return;
  try {
    fs.writeFileSync(bodyPath, body, 'utf8');
  } catch {
    // Avoid changing application behavior if capture logging fails.
  }
}

if (typeof originalFetch === 'function') {
  globalThis.fetch = async function capturedFetch(input, init = {}) {
    let url = '';
    let method = init && init.method;
    let headers = init && init.headers;
    let body = init && init.body;

    if (typeof input === 'string' || input instanceof URL) {
      url = String(input);
    } else if (input) {
      url = input.url || '';
      method = method || input.method;
      headers = headers || input.headers;
      if (body === undefined && input.bodyUsed === false && typeof input.clone === 'function') {
        try {
          body = await input.clone().text();
        } catch {
          body = undefined;
        }
      }
    }

    write({
      phase: 'request',
      url,
      method: method || 'GET',
      headers: headersToObject(headers),
      body: summarizeBody(body),
    });
    saveBodyForReplay(url, body);

    const response = await originalFetch.apply(this, arguments);
    write({
      phase: 'response',
      url,
      status: response.status,
      statusText: response.statusText,
      contentType: response.headers && response.headers.get ? response.headers.get('content-type') : null,
    });
    return response;
  };
}
