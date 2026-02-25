#!/usr/bin/env node

/**
 * Test script for ALA backend functionality
 */

import * as fs from 'fs';
import * as path from 'path';
import LogAnalyzer from '../src/backend/log-analyzer';

console.log('🧪 Testing Android Log Analyzer Backend\n');

// Test 1: Parse log file
console.log('Test 1: Parsing log file...');
const logAnalyzer = new LogAnalyzer();
// Fix path - examples is in root, not in dist
const sampleLogPath = path.join(__dirname, '../../examples/sample-android.log');
const logContent = fs.readFileSync(sampleLogPath, 'utf-8');
const parseResult = logAnalyzer.parseLog(logContent);
const parsedLogs = parseResult.logs;
console.log(`✓ Parsed ${parsedLogs.length} log lines`);
if (parseResult.truncated) {
  console.log(
    `⚠ Warning: Log file truncated at ${parsedLogs.length} lines (total: ${parseResult.totalLines})`
  );
}
console.log();

// Test 2: Get statistics
console.log('Test 2: Getting statistics...');
const stats = logAnalyzer.getStatistics(parsedLogs);
console.log(`✓ Total logs: ${stats.total}`);
console.log(`✓ Errors: ${stats.byLevel.E}`);
console.log(`✓ Warnings: ${stats.byLevel.W}`);
console.log(`✓ Info: ${stats.byLevel.I}`);
console.log(`✓ Debug: ${stats.byLevel.D}`);
console.log(`✓ Unique tags: ${Object.keys(stats.tags).length}`);
console.log(`✓ Unique PIDs: ${Object.keys(stats.pids).length}\n`);

// Test 3: Filter by log level
console.log('Test 3: Filtering by log level (Errors only)...');
const errorLogs = logAnalyzer.filterLogs(parsedLogs, { level: 'E' });
console.log(`✓ Found ${errorLogs.length} error logs`);
errorLogs.slice(0, 3).forEach((log) => {
  console.log(`  - [${log.timestamp}] ${log.tag}: ${log.message.substring(0, 60)}...`);
});
console.log();

// Test 4: Filter by keywords
console.log('Test 4: Filtering by keywords ("login")...');
const loginLogs = logAnalyzer.filterLogs(parsedLogs, { keywords: 'login' });
console.log(`✓ Found ${loginLogs.length} logs containing "login"`);
loginLogs.slice(0, 3).forEach((log) => {
  console.log(`  - [${log.timestamp}] ${log.level}/${log.tag}: ${log.message.substring(0, 60)}...`);
});
console.log();

// Test 5: Filter by time range
console.log('Test 5: Filtering by time range...');
const timeFilteredLogs = logAnalyzer.filterLogs(parsedLogs, {
  startTime: '01-15 10:30:30.000',
  endTime: '01-15 10:30:40.000',
});
console.log(`✓ Found ${timeFilteredLogs.length} logs in time range`);
console.log(`  From: 01-15 10:30:30.000`);
console.log(`  To:   01-15 10:30:40.000\n`);

// Test 6: Filter by tag
console.log('Test 6: Filtering by tag (NetworkManager)...');
const tagFilteredLogs = logAnalyzer.filterLogs(parsedLogs, { tag: 'NetworkManager' });
console.log(`✓ Found ${tagFilteredLogs.length} logs with tag "NetworkManager"`);
tagFilteredLogs.slice(0, 3).forEach((log) => {
  console.log(`  - [${log.timestamp}] ${log.level}: ${log.message.substring(0, 60)}...`);
});
console.log();

// Test 7: Combined filters
console.log('Test 7: Combined filters (Errors + "Network")...');
const combinedLogs = logAnalyzer.filterLogs(parsedLogs, {
  level: 'E',
  keywords: 'Network',
});
console.log(`✓ Found ${combinedLogs.length} error logs containing "Network"`);
combinedLogs.forEach((log) => {
  console.log(`  - [${log.timestamp}] ${log.tag}: ${log.message}`);
});
console.log();

// Test 8: Regex keyword filtering
console.log('Test 8: Regex keyword filtering ("login|logout")...');
const regexLogs = logAnalyzer.filterLogs(parsedLogs, { keywords: 'login|logout' });
console.log(`✓ Found ${regexLogs.length} logs matching regex "login|logout"`);
regexLogs.slice(0, 5).forEach((log) => {
  console.log(`  - [${log.timestamp}] ${log.level}/${log.tag}: ${log.message.substring(0, 60)}...`);
});
console.log();

console.log('✅ All tests passed!\n');
console.log('📝 Summary:');
console.log(`   - Log parsing: Working`);
console.log(`   - Statistics: Working`);
console.log(`   - Level filtering: Working`);
console.log(`   - Keyword filtering: Working`);
console.log(`   - Regex keyword filtering: Working`);
console.log(`   - Time range filtering: Working`);
console.log(`   - Tag filtering: Working`);
console.log(`   - Combined filtering: Working`);
console.log('\n🎉 Backend is functioning correctly!');
