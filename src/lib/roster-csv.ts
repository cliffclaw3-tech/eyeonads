export type CsvAgent = { name: string; email: string; social_url: string; office: string };

function rowsFromCsv(text: string): string[][] {
  const rows: string[][] = [], row: string[] = [];
  let field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else if (!field || quoted) quoted = !quoted;
      else throw Error('The roster file has an invalid quote.');
    } else if (char === ',' && !quoted) { row.push(field.trim()); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field.trim()); field = '';
      if (row.some(Boolean)) rows.push([...row]);
      row.length = 0;
    } else field += char;
  }
  if (quoted) throw Error('The roster file has an unfinished quoted field.');
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseRosterCsv(text: string): CsvAgent[] {
  if (text.length > 1_000_000) throw Error('Choose a roster CSV smaller than 1 MB.');
  const rows = rowsFromCsv(text.replace(/^\uFEFF/, ''));
  if (!rows.length) throw Error('The roster file is empty.');
  if (rows.length > 1001) throw Error('This beta supports up to 1,000 agents per roster.');
  const headers = rows[0].map(value => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const col = (...names: string[]) => headers.findIndex(value => names.includes(value));
  const nameCol = col('name', 'fullname', 'agentname', 'membername');
  const firstCol = col('firstname', 'givenname'), lastCol = col('lastname', 'surname', 'familyname');
  if (nameCol < 0 && (firstCol < 0 || lastCol < 0)) throw Error('The roster CSV needs a Name column, or First Name and Last Name columns.');
  const emailCol = col('email', 'emailaddress', 'agentemail');
  const officeCol = col('office', 'officename', 'branch');
  const agents: CsvAgent[] = [], seen = new Set<string>();
  for (const [index, row] of rows.slice(1).entries()) {
    const name = (nameCol >= 0 ? row[nameCol] : `${row[firstCol] || ''} ${row[lastCol] || ''}`).replace(/\s+/g, ' ').trim();
    if (!name) continue;
    if (name.length > 150 || /[\r\n,]/.test(name)) throw Error(`Row ${index + 2}: check the agent name.`);
    const email = emailCol < 0 ? '' : (row[emailCol] || '').trim();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw Error(`Row ${index + 2}: check the email address.`);
    const key = email ? `email:${email.toLowerCase()}` : `name:${name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    agents.push({ name, email, social_url: '', office: officeCol < 0 ? '' : (row[officeCol] || '').trim() });
  }
  if (!agents.length) throw Error('No agent names were found in the roster file.');
  return agents;
}
