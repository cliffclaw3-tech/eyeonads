import test from 'node:test';
import assert from 'node:assert/strict';
import { sparkPilotAvailable } from '../src/lib/spark-access.ts';

test('a configured Spark feed is limited to the verified Greater Impact pilot', () => {
  const previous = [process.env.SPARK_API_ENDPOINT, process.env.SPARK_API_TOKEN, process.env.EYEONADS_SPARK_OWNER_ID];
  try {
    process.env.SPARK_API_ENDPOINT = 'https://example.com/odata/';
    process.env.SPARK_API_TOKEN = 'test-token';
    process.env.EYEONADS_SPARK_OWNER_ID = 'old-account';
    const wes = { id: 'current-account', email: 'theshieldsteam@gmail.com', app_metadata: { eyeonads_pilot: true } };
    assert.equal(sparkPilotAvailable(wes, 'Greater Impact Realty'), true);
    assert.equal(sparkPilotAvailable({ ...wes, app_metadata: {} }, 'Greater Impact Realty'), false);
    assert.equal(sparkPilotAvailable({ ...wes, email: 'other@example.com' }, 'Greater Impact Realty'), false);
    assert.equal(sparkPilotAvailable(wes, 'Other Realty'), false);
  } finally {
    [process.env.SPARK_API_ENDPOINT, process.env.SPARK_API_TOKEN, process.env.EYEONADS_SPARK_OWNER_ID] = previous;
  }
});
