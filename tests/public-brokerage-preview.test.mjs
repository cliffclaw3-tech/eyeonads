import assert from 'node:assert/strict';
import test from 'node:test';
import { previewOffices, previewAgents, selectedOffices } from '../src/lib/public-brokerage-preview.ts';
import { validateBrokerage } from '../src/lib/brokerage.ts';

const selected = [
  { name: 'Example Realty Kingsport', location: 'Kingsport, Tennessee', website: 'https://example.com/kingsport', source_url: 'https://example.com/offices/kingsport' },
];

test('suggested agents are limited to the exact offices selected by the broker', () => {
  const candidates = [
    { name: 'Avery Smith', office: 'Example Realty Kingsport|Kingsport, Tennessee', source_url: 'https://example.com/agents/avery' },
    { name: 'Jordan Lee', office: 'Example Realty Greenville|Greenville, Tennessee', source_url: 'https://example.com/agents/jordan' },
  ];
  assert.deepEqual(previewAgents(candidates, selected).map(agent => agent.name), ['Avery Smith']);
  assert.equal(selectedOffices([{ ...selected[0], source_url: 'http://localhost/private' }]), null);
});

test('saved roster rejects agent affiliation outside selected offices', () => {
  const setup = { name: 'Example Realty', expected_agents: 1, scope: 'agents', offices: selected, agents: [{ name: 'Jordan Lee', email: '', social_url: '', office: 'Example Realty Greenville|Greenville, Tennessee' }] };
  assert.match(validateBrokerage(setup), /outside your selected offices/);
  assert.equal(validateBrokerage({ ...setup, agents: [{ ...setup.agents[0], office: 'Example Realty Kingsport|Kingsport, Tennessee' }] }), null);
});

test('public office candidates need a cited source and cannot be assumed from a brand', () => {
  const offices = previewOffices([
    { name: 'Example Realty Kingsport', location: 'Kingsport, Tennessee', website: '', source_url: 'https://example.com/offices/kingsport' },
    { name: 'Example Realty Johnson City', location: 'Johnson City, Tennessee', website: '', source_url: '' },
  ]);
  assert.equal(offices.length, 1);
});
