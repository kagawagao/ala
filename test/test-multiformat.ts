import { LogAnalyzer, LogFormat } from '../src/backend/log-analyzer';
import { readFileSync } from 'fs';

console.log('🧪 Testing Multi-Format Log Support\n');

const analyzer = new LogAnalyzer();

// Test Android logcat format
console.log('Test 1: Android Logcat Format Detection');
const androidLog = readFileSync('examples/sample-android.log', 'utf-8');
const androidFormat = analyzer.detectLogFormat(androidLog);
console.log(`✓ Detected format: ${androidFormat}`);
console.log(`✓ Expected: ${LogFormat.ANDROID_LOGCAT}`);
console.log(`✓ Match: ${androidFormat === LogFormat.ANDROID_LOGCAT ? 'Yes' : 'No'}\n`);

// Test generic timestamped format
console.log('Test 2: Generic Timestamped Format Detection');
const genericLog = `[2024-01-15 10:30:45] INFO: Test message
2024-01-15 10:30:46 [ERROR] Error message
[2024-01-15 10:30:47] WARNING: Warning message`;
const genericFormat = analyzer.detectLogFormat(genericLog);
console.log(`✓ Detected format: ${genericFormat}`);
console.log(`✓ Expected: ${LogFormat.GENERIC_TIMESTAMPED}`);
console.log(`✓ Match: ${genericFormat === LogFormat.GENERIC_TIMESTAMPED ? 'Yes' : 'No'}\n`);

// Test parsing Android logcat
console.log('Test 3: Parsing Android Logcat Logs');
const androidParsedResult = analyzer.parseLog(androidLog);
const androidParsed = androidParsedResult.logs;
console.log(`✓ Parsed ${androidParsed.length} log lines`);
console.log(`✓ First log level: ${androidParsed[0].level}`);
console.log(`✓ First log tag: ${androidParsed[0].tag}\n`);

// Test parsing generic logs
console.log('Test 4: Parsing Generic Timestamped Logs');
const genericParsedResult = analyzer.parseLog(genericLog);
const genericParsed = genericParsedResult.logs;
console.log(`✓ Parsed ${genericParsed.length} log lines`);
if (genericParsed.length > 0) {
  console.log(`✓ First log level: ${genericParsed[0].level}`);
  console.log(`✓ First log message: ${genericParsed[0].message}`);
  console.log(`✓ First log timestamp: ${genericParsed[0].timestamp}\n`);
}

// Test log level normalization
console.log('Test 5: Log Level Normalization');
const infoLog = '[2024-01-15 10:30:45] INFO: Test message';
const errorLog = '2024-01-15 10:30:46 [ERROR] Error message';
const warnLog = '[2024-01-15 10:30:47] WARNING: Warning message';

const infoParsed = analyzer.parseLog(infoLog).logs;
const errorParsed = analyzer.parseLog(errorLog).logs;
const warnParsed = analyzer.parseLog(warnLog).logs;

console.log(`✓ INFO normalized to: ${infoParsed[0]?.level} (expected: I)`);
console.log(`✓ ERROR normalized to: ${errorParsed[0]?.level} (expected: E)`);
console.log(`✓ WARNING normalized to: ${warnParsed[0]?.level} (expected: W)\n`);

console.log('✅ Multi-format support tests completed!\n');
