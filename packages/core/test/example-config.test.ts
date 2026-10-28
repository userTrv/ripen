import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_CONFIG, parseConfig } from '@ripen/core';

test('ripen.config.example.json is valid and matches the defaults', () => {
  const file = join(import.meta.dirname, '../../../ripen.config.example.json');
  const parsed = parseConfig(JSON.parse(readFileSync(file, 'utf8')));
  assert.deepEqual(parsed.channels.map((c) => c.id), DEFAULT_CONFIG.channels.map((c) => c.id));
  assert.deepEqual(parsed.gate, DEFAULT_CONFIG.gate);
});
