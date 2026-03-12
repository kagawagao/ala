/**
 * Renderer-side AI Service
 *
 * Uses fetch API directly for OpenAI-compatible API calls.
 * Supports streaming responses for real-time output.
 * Network requests are visible in DevTools for easier debugging.
 */

import { AIConfig } from '../types';

/**
 * Log entry type (minimal, for AI analysis)
 */
interface LogEntryForAI {
  timestamp: string | null;
  level: string;
  tag: string;
  message: string;
}

/**
 * AI prompt preset (shared with backend definition)
 */
export interface AIPromptPreset {
  id: string;
  name: string;
  nameKey: string;
  description: string;
  descriptionKey: string;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}

export const AI_PROMPT_PRESETS: AIPromptPreset[] = [
  {
    id: 'general',
    name: 'General Analysis',
    nameKey: 'aiPresetGeneral',
    description: 'Comprehensive log analysis covering errors, warnings, and patterns',
    descriptionKey: 'aiPresetGeneralDesc',
    systemPrompt: `You are an expert Android log analyzer. Analyze the provided Android logs and provide insights about:
1. Errors and warnings
2. Potential issues or crashes
3. Performance concerns
4. Notable patterns or anomalies
5. Recommendations for debugging

Be concise and focus on actionable insights.`,
    userPrompt: 'Analyze these Android logs and provide insights.',
    maxTokens: 1000,
    temperature: 0.7,
  },
  {
    id: 'crash',
    name: 'Crash Analysis',
    nameKey: 'aiPresetCrash',
    description: 'Focus on crash diagnostics, stack traces, and root cause analysis',
    descriptionKey: 'aiPresetCrashDesc',
    systemPrompt: `You are an expert Android crash analyzer. Focus on:
1. Identifying crash causes and stack traces
2. Root cause analysis of fatal errors
3. Related errors that may have led to the crash
4. Memory issues (OOM, leaks)
5. Thread/concurrency problems
6. Specific recommendations to fix the crash

Provide detailed analysis with line references where possible.`,
    userPrompt: 'Analyze these logs to identify crashes and their root causes.',
    maxTokens: 1500,
    temperature: 0.5,
  },
  {
    id: 'performance',
    name: 'Performance Analysis',
    nameKey: 'aiPresetPerformance',
    description: 'Analyze performance issues, lag, memory usage, and optimization opportunities',
    descriptionKey: 'aiPresetPerformanceDesc',
    systemPrompt: `You are an Android performance expert. Analyze logs for:
1. Performance bottlenecks and slow operations
2. Memory usage patterns and potential leaks
3. UI thread blocking and ANR (Application Not Responding)
4. Resource usage (CPU, GPU, Network)
5. Database and I/O performance
6. Frame drops and rendering issues
7. Optimization recommendations

Focus on measurable metrics and specific improvements.`,
    userPrompt: 'Analyze these logs for performance issues and optimization opportunities.',
    maxTokens: 1200,
    temperature: 0.6,
  },
  {
    id: 'security',
    name: 'Security Analysis',
    nameKey: 'aiPresetSecurity',
    description: 'Identify security vulnerabilities, permission issues, and potential exploits',
    descriptionKey: 'aiPresetSecurityDesc',
    systemPrompt: `You are a mobile security expert. Examine logs for:
1. Security vulnerabilities and warnings
2. Permission issues and unauthorized access attempts
3. Data leaks or exposure of sensitive information
4. Authentication and authorization problems
5. Network security issues (TLS, certificates)
6. Potential exploit attempts or suspicious behavior
7. Security best practices violations

Provide severity ratings and mitigation strategies.`,
    userPrompt: 'Analyze these logs for security vulnerabilities and risks.',
    maxTokens: 1200,
    temperature: 0.5,
  },
  {
    id: 'network',
    name: 'Network Analysis',
    nameKey: 'aiPresetNetwork',
    description: 'Focus on network requests, API calls, connectivity, and data transfer issues',
    descriptionKey: 'aiPresetNetworkDesc',
    systemPrompt: `You are an Android networking specialist. Analyze logs for:
1. Network request failures and timeouts
2. API errors and HTTP status codes
3. Connectivity issues (WiFi, mobile data)
4. SSL/TLS certificate problems
5. Data transfer performance
6. Network protocol issues
7. Retry patterns and error handling

Identify patterns and suggest improvements.`,
    userPrompt: 'Analyze these logs for network-related issues.',
    maxTokens: 1000,
    temperature: 0.6,
  },
  {
    id: 'lifecycle',
    name: 'App Lifecycle Analysis',
    nameKey: 'aiPresetLifecycle',
    description: 'Analyze Activity/Fragment lifecycle, state management, and navigation issues',
    descriptionKey: 'aiPresetLifecycleDesc',
    systemPrompt: `You are an Android lifecycle expert. Focus on:
1. Activity and Fragment lifecycle events
2. State management issues
3. Configuration changes (rotation, etc.)
4. Navigation problems
5. Memory leaks in lifecycle components
6. Incorrect lifecycle handling
7. Background/foreground transitions

Explain lifecycle-related bugs and best practices.`,
    userPrompt: 'Analyze these logs for app lifecycle and state management issues.',
    maxTokens: 1000,
    temperature: 0.6,
  },
  {
    id: 'ui',
    name: 'UI/UX Analysis',
    nameKey: 'aiPresetUI',
    description:
      'Focus on UI rendering, layout issues, touch events, and user interaction problems',
    descriptionKey: 'aiPresetUIDesc',
    systemPrompt: `You are a UI/UX specialist for Android. Analyze logs for:
1. UI rendering errors and inflation issues
2. Layout problems and constraint violations
3. Touch event handling and gesture issues
4. RecyclerView/ListView problems
5. View binding and data binding errors
6. Animation and transition issues
7. Accessibility problems

Provide UI-specific recommendations.`,
    userPrompt: 'Analyze these logs for UI/UX issues.',
    maxTokens: 1000,
    temperature: 0.6,
  },
];

export function getPresetById(id: string): AIPromptPreset | undefined {
  return AI_PROMPT_PRESETS.find((p) => p.id === id);
}

export function getPresetList(): Array<{
  id: string;
  name: string;
  nameKey: string;
  description: string;
  descriptionKey: string;
}> {
  return AI_PROMPT_PRESETS.map((p) => ({
    id: p.id,
    name: p.name,
    nameKey: p.nameKey,
    description: p.description,
    descriptionKey: p.descriptionKey,
  }));
}

// Configuration constants
const MAX_LOGS_FOR_ANALYSIS = 100;
const MAX_SUMMARY_LENGTH = 8000;

/**
 * Get AI config from localStorage
 */
export function getAIConfig(): AIConfig | null {
  const saved = localStorage.getItem('aiConfig');
  if (saved) {
    try {
      return JSON.parse(saved);
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Save AI config to localStorage
 */
export function saveAIConfig(config: AIConfig): void {
  localStorage.setItem('aiConfig', JSON.stringify(config));
}

/**
 * Check if AI is configured
 */
export function isAIConfigured(): boolean {
  const config = getAIConfig();
  return config !== null && config.apiKey !== '' && config.apiEndpoint !== '';
}

/**
 * Format log entries for AI analysis
 */
function formatLogsForAI(logs: LogEntryForAI[]): string {
  return logs
    .map((log) => {
      return `[${log.timestamp ?? 'N/A'}] ${log.level}/${log.tag}: ${log.message}`;
    })
    .join('\n');
}

/**
 * Prepare log summary for AI analysis (truncate if necessary)
 */
export function prepareLogSummary(logs: LogEntryForAI[]): string {
  const maxLogs = MAX_LOGS_FOR_ANALYSIS;
  const maxLength = MAX_SUMMARY_LENGTH;

  let summary = '';
  const logsToAnalyze = logs.slice(0, maxLogs);

  const errors = logsToAnalyze.filter((log) => log.level === 'E');
  const warnings = logsToAnalyze.filter((log) => log.level === 'W');
  const fatals = logsToAnalyze.filter((log) => log.level === 'F');

  summary += `Total logs: ${logs.length}\n`;
  summary += `Errors: ${errors.length}, Warnings: ${warnings.length}, Fatals: ${fatals.length}\n\n`;

  if (fatals.length > 0) {
    summary += '=== FATAL ERRORS ===\n';
    summary += formatLogsForAI(fatals.slice(0, 10));
    summary += '\n';
  }

  if (errors.length > 0) {
    summary += '=== ERRORS ===\n';
    summary += formatLogsForAI(errors.slice(0, 20));
    summary += '\n';
  }

  if (warnings.length > 0) {
    summary += '=== WARNINGS ===\n';
    summary += formatLogsForAI(warnings.slice(0, 20));
    summary += '\n';
  }

  const otherLogs = logsToAnalyze
    .filter((log) => !['E', 'W', 'F'].includes(log.level))
    .slice(0, 20);
  if (otherLogs.length > 0) {
    summary += '=== OTHER LOGS (SAMPLE) ===\n';
    summary += formatLogsForAI(otherLogs);
  }

  if (summary.length > maxLength) {
    summary = summary.substring(0, maxLength) + '\n... (truncated)';
  }

  return summary;
}

/**
 * Get the language instruction for the AI prompt
 */
function getLanguageInstruction(language: string): string {
  switch (language) {
    case 'zh':
      return '\n\nIMPORTANT: You MUST respond in Chinese (简体中文).';
    case 'en':
      return '\n\nIMPORTANT: You MUST respond in English.';
    default:
      return '';
  }
}

/**
 * Streaming AI analysis using fetch API
 * Calls OpenAI-compatible chat completions endpoint with streaming
 */
export async function analyzeLogsStream(params: {
  logs: LogEntryForAI[];
  prompt?: string;
  presetId?: string;
  sourceCode?: string;
  language?: string;
  onChunk: (chunk: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const config = getAIConfig();
  if (!config || !config.apiKey) {
    params.onError('AI service is not configured. Please configure API settings in Settings.');
    return;
  }

  const logSummary = prepareLogSummary(params.logs);

  // Determine system prompt and user prompt from preset
  let systemPrompt: string;
  let userPrompt: string;
  let maxTokens = 1000;
  let temperature = 0.7;

  if (params.presetId) {
    const preset = getPresetById(params.presetId);
    if (preset) {
      systemPrompt = preset.systemPrompt;
      userPrompt = params.prompt || preset.userPrompt;
      maxTokens = preset.maxTokens ?? 1000;
      temperature = preset.temperature ?? 0.7;
    } else {
      systemPrompt = AI_PROMPT_PRESETS[0].systemPrompt;
      userPrompt = params.prompt || 'Analyze these Android logs and provide insights.';
    }
  } else {
    systemPrompt = AI_PROMPT_PRESETS[0].systemPrompt;
    userPrompt = params.prompt || 'Analyze these Android logs and provide insights.';
  }

  // Add source code context
  if (params.sourceCode) {
    systemPrompt +=
      '\n\nYou also have access to relevant source code. Use it to provide more accurate analysis and pinpoint exact locations of issues in the code.';
    maxTokens = Math.max(maxTokens, 1500);
  }

  // Add language instruction
  if (params.language) {
    systemPrompt += getLanguageInstruction(params.language);
  }

  // Build user message
  let userMessage = `${userPrompt}\n\nLogs:\n${logSummary}`;
  if (params.sourceCode) {
    userMessage += `\n\n=== RELEVANT SOURCE CODE ===\n${params.sourceCode}`;
  }

  // Build API URL
  const baseUrl = config.apiEndpoint.replace(/\/+$/, '');
  const url = `${baseUrl}/chat/completions`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        max_tokens: maxTokens,
        temperature,
        stream: true,
      }),
      signal: params.signal,
    });

    if (!response.ok) {
      let errorMessage = `API request failed with status ${response.status}`;
      try {
        const errorBody = await response.json();
        if (errorBody.error?.message) {
          errorMessage = errorBody.error.message;
        }
      } catch {
        // Use default error message
      }
      params.onError(errorMessage);
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      params.onError('Failed to get response stream reader');
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process SSE events
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed === '') continue;
        if (trimmed === 'data: [DONE]') {
          params.onDone();
          return;
        }
        if (trimmed.startsWith('data: ')) {
          try {
            const json = JSON.parse(trimmed.slice(6));
            const content = json.choices?.[0]?.delta?.content;
            if (content) {
              params.onChunk(content);
            }
          } catch {
            // Skip malformed SSE data
          }
        }
      }
    }

    params.onDone();
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      params.onDone();
      return;
    }
    params.onError(error instanceof Error ? error.message : 'Failed to analyze logs with AI');
  }
}
