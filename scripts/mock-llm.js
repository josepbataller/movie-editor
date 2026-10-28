// Mock OpenAI-compatible server for testing the assistant pipeline offline.
// Replies with scripted tool calls, then a final text. Usage: node scripts/mock-llm.js [port]
const http = require('http');
const port = Number(process.argv[2] || 8765);
http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (!req.url.endsWith('/chat/completions')) { res.writeHead(404); return res.end('nope'); }
    const j = JSON.parse(body);
    const toolTurns = j.messages.filter((m) => m.role === 'tool').length;
    const toolNames = (j.tools || []).map((t) => t.function.name);
    let message;
    if (toolTurns === 0) message = { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'studio_add_track', arguments: JSON.stringify({ kind: 'instrument', instrument: '808 Kit', name: 'Drums' }) } }] };
    else if (toolTurns === 1) message = { role: 'assistant', content: null, tool_calls: [
      { id: 'c2', type: 'function', function: { name: 'studio_add_pattern', arguments: JSON.stringify({ track: 'Drums', start: 0, lengthBeats: 4, notes: [{ pitch: 'Kick', start: 0 }, { pitch: 'Snare', start: 1 }, { pitch: 'Kick', start: 2 }, { pitch: 'Snare', start: 3 }] }) } },
      { id: 'c3', type: 'function', function: { name: 'studio_eq', arguments: JSON.stringify({ target: 'Drums', bands: [{ type: 'lowpass', frequency: 5000 }] }) } },
    ] };
    else message = { role: 'assistant', content: `Listo: pista Drums con un patrón de 4 pulsos y un filtro paso bajo a 5 kHz. (tools visibles: ${toolNames.length})` };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'mock', choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
  });
}).listen(port, () => console.log('mock llm on', port));
