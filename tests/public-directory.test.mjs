import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectDirectory, readOfficialDirectory } from '../src/lib/public-directory.ts';

test('follows an official agent link and pagination without an MLS key', async () => {
  const office = { name: 'Example Realty Jonesborough', location: 'Jonesborough, Tennessee', website: 'https://example.com/', source_url: 'https://example.com/locations' };
  const html = new Map([
    ['https://example.com/', '<html><body><h1>Example Realty</h1><a href="/agents.php">Agents</a></body></html>'],
    ['https://example.com/locations', '<html><body><h1>Locations</h1><a href="/agents.php">Agents</a></body></html>'],
    ['https://example.com/agents.php', '<html><body><h1>Roster</h1><article><h2>Aaron Murphy</h2><h3>REALTOR</h3></article><a href="/agents.php?page=2">Next</a></body></html>'],
    ['https://example.com/agents.php?page=2', '<html><body><article><h2>Bethany Wisdom</h2><h3>Managing Broker</h3></article></body></html>'],
  ]);
  const result = await readOfficialDirectory([office], office, async url => {
    if (!html.has(url)) throw Error('Unexpected page');
    return { url, html: html.get(url) };
  });
  assert.deepEqual(result.agents.map(agent => agent.name), ['Aaron Murphy', 'Bethany Wisdom']);
  assert.equal(result.pagesRead, 2);
  assert.equal(result.incomplete, false);
  assert.equal(result.agents[1].source_url, 'https://example.com/agents.php?page=2');
});

test('supports a different brokerage team layout and rejects cross-site links', async () => {
  const office = { name: 'Acme Realty Austin', location: 'Austin, Texas', website: 'https://acmerealty.example/', source_url: 'https://acmerealty.example/offices/austin' };
  const html = new Map([
    ['https://acmerealty.example/', '<html><body><a href="/our-team">Our Team</a><a href="https://other.example/agents">Agents</a></body></html>'],
    ['https://acmerealty.example/offices/austin', '<html><body><a href="/our-team">Our Team</a></body></html>'],
    ['https://acmerealty.example/our-team', '<html><body><div><h3>Jordan Lee</h3><span>Real Estate Agent</span></div><div><h3>Casey Jones</h3><span>Broker</span></div></body></html>'],
  ]);
  const result = await readOfficialDirectory([office], office, async url => {
    if (!html.has(url)) throw Error('Unexpected page');
    return { url, html: html.get(url) };
  });
  assert.deepEqual(result.agents.map(agent => agent.name), ['Jordan Lee', 'Casey Jones']);
  assert.equal(result.incomplete, false);
});

test('blocked directory is reported as incomplete and not a complete zero roster', async () => {
  const office = { name: 'Sample Brokerage', location: 'Portland, Oregon', website: 'https://sample.example/', source_url: 'https://sample.example/offices' };
  const result = await readOfficialDirectory([office], office, async url => {
    if (url.endsWith('/agents')) throw Error('Blocked');
    return { url, html: '<html><body><a href="/agents">Agents</a></body></html>' };
  });
  assert.equal(result.agents.length, 0);
  assert.equal(result.incomplete, true);
});

test('directory parser does not treat navigation labels or unrelated pages as agents', () => {
  const parsed = inspectDirectory('<main><h2>Contact Us</h2><h2>Greater Impact Realty</h2><article><h2>Alex Morgan</h2><p>REALTOR</p></article><a href="https://other.example/agents">Other agents</a></main>', 'https://example.com/agents', true);
  assert.deepEqual(parsed.names, ['Alex Morgan']);
  assert.deepEqual(parsed.links, []);
});

test('recognizes team cards whose names are not headings', () => {
  const html = '<html><body><div class="uc_subcontainer_holder"><div class="team_member_box_overlay_title">Taylor Colwell</div><div class="team_member_box_overlay_subtitle">Broker/Owner, Realtor®</div></div></body></html>';
  assert.deepEqual(inspectDirectory(html, 'https://example.com/agents/', true).names, ['Taylor Colwell']);
});
