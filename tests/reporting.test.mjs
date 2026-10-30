import test from 'node:test';
import assert from 'node:assert/strict';
import {reportingWindow} from '../dashboard/reporting.mjs';

test('today follows the workspace calendar across the São Paulo midnight boundary',()=>{
  assert.deepEqual(reportingWindow(0,'America/Sao_Paulo',new Date('2026-10-29T01:00:00Z')),{
    since:'2026-10-28T03:00:00.000Z',fromDate:'2026-10-28',untilDate:'2026-10-28',
  });
  assert.deepEqual(reportingWindow(0,'America/Sao_Paulo',new Date('2026-10-29T03:00:00Z')),{
    since:'2026-10-29T03:00:00.000Z',fromDate:'2026-10-29',untilDate:'2026-10-29',
  });
});

test('seven and thirty days contain the selected number of inclusive calendar dates',()=>{
  assert.deepEqual(reportingWindow(7,'UTC',new Date('2026-01-02T16:27:30Z')),{
    since:'2025-12-27T00:00:00.000Z',fromDate:'2025-12-27',untilDate:'2026-01-02',
  });
  assert.deepEqual(reportingWindow(30,'UTC',new Date('2026-01-10T16:27:30Z')),{
    since:'2025-12-12T00:00:00.000Z',fromDate:'2025-12-12',untilDate:'2026-01-10',
  });
  assert.deepEqual(reportingWindow(7,'America/Sao_Paulo',new Date('2026-10-29T01:00:00Z')),{
    since:'2026-10-22T03:00:00.000Z',fromDate:'2026-10-22',untilDate:'2026-10-28',
  });
});

test('historical midnight uses the offset before spring daylight saving rather than the current one',()=>{
  assert.deepEqual(reportingWindow(7,'America/New_York',new Date('2026-03-12T16:00:00Z')),{
    since:'2026-03-06T05:00:00.000Z',fromDate:'2026-03-06',untilDate:'2026-03-12',
  });
  assert.equal(reportingWindow(0,'America/New_York',new Date('2026-03-08T16:00:00Z')).since,'2026-03-08T05:00:00.000Z');
});

test('historical midnight keeps the earlier daylight offset across autumn fallback',()=>{
  assert.deepEqual(reportingWindow(7,'America/New_York',new Date('2026-11-06T16:00:00Z')),{
    since:'2026-10-31T04:00:00.000Z',fromDate:'2026-10-31',untilDate:'2026-11-06',
  });
  assert.equal(reportingWindow(0,'America/New_York',new Date('2026-11-01T17:00:00Z')).since,'2026-11-01T04:00:00.000Z');
});

test('Tokyo may report tomorrow relative to UTC while its start remains in the past',()=>{
  assert.deepEqual(reportingWindow(0,'Asia/Tokyo',new Date('2026-10-28T16:00:00Z')),{
    since:'2026-10-28T15:00:00.000Z',fromDate:'2026-10-29',untilDate:'2026-10-29',
  });
});

test('a skipped midnight starts at the first actual instant and a repeated midnight keeps its first occurrence',()=>{
  assert.equal(reportingWindow(0,'America/Sao_Paulo',new Date('2018-11-04T12:00:00Z')).since,'2018-11-04T03:00:00.000Z');
  assert.equal(reportingWindow(0,'America/Havana',new Date('2026-11-01T17:00:00Z')).since,'2026-11-01T04:00:00.000Z');
});

test('invalid periods, time zones, dates and unsupported calendar ranges fail closed',()=>{
  for(const period of [-1,1,6,8,31,'7',null,undefined,NaN]){
    assert.throws(()=>reportingWindow(period,'UTC',new Date('2026-10-29T12:00:00Z')),/Período/);
  }
  for(const timezone of ['Not/A_Zone','America/Sao_Paulo ','+03:00','',null,undefined]){
    assert.throws(()=>reportingWindow(0,timezone,new Date('2026-10-29T12:00:00Z')),/Fuso/);
  }
  for(const now of [new Date(NaN),'2026-10-29T12:00:00Z',null,0,new Date('0000-01-01T00:00:00Z'),new Date('+010000-01-01T00:00:00Z')]){
    assert.throws(()=>reportingWindow(0,'UTC',now),/Data/);
  }
  assert.throws(()=>reportingWindow(30,'UTC',new Date('0001-01-02T00:00:00Z')),/Data/);
});
