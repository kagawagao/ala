import { LogEntry } from './log-analyzer';

/**
 * AI analysis result
 */
export interface AIAnalysisResult {
  success: boolean;
  analysis?: string;
  usage?: any;
  error?: string;
}

/**
 * AI Service for analyzing Android logs
 * Supports OpenAI API integration
 */
export class AIService {
  private openai: any;
  private apiKey: string | null;
  private MAX_LOGS_FOR_ANALYSIS: number;
  private MAX_SUMMARY_LENGTH: number;

  constructor() {
    this.openai = null;
    this.apiKey = process.env.OPENAI_API_KEY || null;

    // Configuration constants
    this.MAX_LOGS_FOR_ANALYSIS = 100; // Maximum number of logs to send to AI
    this.MAX_SUMMARY_LENGTH = 8000; // Maximum character length for AI input

    if (this.apiKey) {
      this.initializeOpenAI();
    }
  }

  initializeOpenAI(): void {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { OpenAI } = require('openai');
      this.openai = new OpenAI({
        apiKey: this.apiKey,
      });
    } catch (error) {
      console.error('Failed to initialize OpenAI:', error);
      this.openai = null;
    }
  }

  isConfigured(): boolean {
    return this.openai !== null && this.apiKey !== null;
  }

  /**
   * Analyze logs using AI
   */
  async analyzeLogs(logs: LogEntry[], prompt: string = ''): Promise<AIAnalysisResult> {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'AI service is not configured. Please set OPENAI_API_KEY environment variable.',
      };
    }

    try {
      // Prepare log summary for AI analysis
      const logSummary = this.prepareLogSummary(logs);

      const systemPrompt = `You are an expert Android log analyzer. Analyze the provided Android logs and provide insights about:
1. Errors and warnings
2. Potential issues or crashes
3. Performance concerns
4. Notable patterns or anomalies
5. Recommendations for debugging

Be concise and focus on actionable insights.`;

      const userPrompt = prompt || 'Analyze these Android logs and provide insights.';

      const response = await this.openai.chat.completions.create({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `${userPrompt}\n\nLogs:\n${logSummary}` },
        ],
        max_tokens: 1000,
        temperature: 0.7,
      });

      return {
        success: true,
        analysis: response.choices[0].message.content,
        usage: response.usage,
      };
    } catch (error: any) {
      console.error('AI analysis error:', error);
      return {
        success: false,
        error: error.message || 'Failed to analyze logs with AI',
      };
    }
  }

  /**
   * Prepare logs for AI analysis (truncate if necessary)
   */
  prepareLogSummary(logs: LogEntry[]): string {
    const maxLogs = this.MAX_LOGS_FOR_ANALYSIS;
    const maxLength = this.MAX_SUMMARY_LENGTH;

    let summary = '';
    const logsToAnalyze = logs.slice(0, maxLogs);

    // Group logs by level for better context
    const errors = logsToAnalyze.filter((log) => log.level === 'E');
    const warnings = logsToAnalyze.filter((log) => log.level === 'W');
    const fatals = logsToAnalyze.filter((log) => log.level === 'F');

    // Prioritize errors and warnings
    summary += `Total logs: ${logs.length}\n`;
    summary += `Errors: ${errors.length}, Warnings: ${warnings.length}, Fatals: ${fatals.length}\n\n`;

    if (fatals.length > 0) {
      summary += '=== FATAL ERRORS ===\n';
      summary += this.formatLogsForAI(fatals.slice(0, 10));
      summary += '\n';
    }

    if (errors.length > 0) {
      summary += '=== ERRORS ===\n';
      summary += this.formatLogsForAI(errors.slice(0, 20));
      summary += '\n';
    }

    if (warnings.length > 0) {
      summary += '=== WARNINGS ===\n';
      summary += this.formatLogsForAI(warnings.slice(0, 20));
      summary += '\n';
    }

    // Add some context from other logs
    const otherLogs = logsToAnalyze
      .filter((log) => !['E', 'W', 'F'].includes(log.level))
      .slice(0, 20);
    if (otherLogs.length > 0) {
      summary += '=== OTHER LOGS (SAMPLE) ===\n';
      summary += this.formatLogsForAI(otherLogs);
    }

    // Truncate if too long
    if (summary.length > maxLength) {
      summary = summary.substring(0, maxLength) + '\n... (truncated)';
    }

    return summary;
  }

  formatLogsForAI(logs: LogEntry[]): string {
    return logs
      .map((log) => {
        return `[${log.timestamp || 'N/A'}] ${log.level}/${log.tag}: ${log.message}`;
      })
      .join('\n');
  }
}

export default AIService;
