function getBoundary(contentType = '') {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  return match ? (match[1] || match[2] || '').trim() : '';
}

function parseHeaders(value) {
  const headers = {};
  for (const line of value.split('\r\n')) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function parseDisposition(value) {
  const result = {};
  for (const part of value.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim().toLowerCase();
    let val = part.slice(index + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    result[key] = val;
  }
  return result;
}

export function parseMultipart(buffer, contentType) {
  const boundary = getBoundary(contentType);
  if (!boundary) throw new Error('缺少 multipart boundary');
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = [];
  let position = buffer.indexOf(delimiter);
  if (position === -1) throw new Error('multipart 内容为空');

  while (position !== -1) {
    let start = position + delimiter.length;
    if (buffer.slice(start, start + 2).toString() === '--') break;
    if (buffer.slice(start, start + 2).toString() === '\r\n') start += 2;
    const next = buffer.indexOf(delimiter, start);
    if (next === -1) break;
    let part = buffer.slice(start, next);
    if (part.slice(-2).toString() === '\r\n') part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headers = parseHeaders(part.slice(0, headerEnd).toString('utf8'));
      const content = part.slice(headerEnd + 4);
      const disposition = parseDisposition(headers['content-disposition'] || '');
      const name = disposition.name;
      if (name && disposition.filename != null) {
        files.push({
          field: name,
          filename: disposition.filename,
          contentType: headers['content-type'] || 'application/octet-stream',
          buffer: content,
        });
      } else if (name) {
        fields[name] = content.toString('utf8').trim();
      }
    }
    position = next;
  }
  return { fields, files };
}

