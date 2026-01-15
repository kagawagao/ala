/**
 * AI Service for analyzing Android logs
 * Supports OpenAI API integration
 */
class AIService {
  constructor() {
    this.openai = null;
    this.apiKey = process.env.OPENAI_API_KEY || null;
    
    if (this.apiKey) {
      this.initializeOpenAI();
    }
  }

  initializeOpenAI() {
    try {
      const { OpenAI } = require('openai');
      this.openai = new OpenAI({
        apiKey: this.apiKey
      });
    } catch (error) {
      console.error('Failed to initialize OpenAI:', error);
      this.openai = null;
    }
  }

  isConfigured() {
    return this.openai !== null && this.apiKey !== null;
  }

  /**
   * Analyze logs using AI
   */
  async analyzeLogs(logs, prompt = '') {
    if (!this.isConfigured()) {
      return {
        success: false,
        error: 'AI service is not configured. Please set OPENAI_API_KEY environment variable.'
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
          { role: 'user', content: `${userPrompt}\n\nLogs:\n${logSummary}` }
        ],
        max_tokens: 1000,
        temperature: 0.7
      });

      return {
        success: true,
        analysis: response.choices[0].message.content,
        usage: response.usage
      };
    } catch (error) {
      console.error('AI analysis error:', error);
      return {
        success: false,
        error: error.message || 'Failed to analyze logs with AI'
      };
    }
  }

  /**
   * Prepare logs for AI analysis (truncate if necessary)
   */
  prepareLogSummary(logs) {
    const maxLogs = 100; // Limit to avoid token limits
    const maxLength = 8000; // Character limit
    
    let summary = '';
    const logsToAnalyze = logs.slice(0, maxLogs);
    
    // Group logs by level for better context
    const errors = logsToAnalyze.filter(log => log.level === 'E');
    const warnings = logsToAnalyze.filter(log => log.level === 'W');
    const fatals = logsToAnalyze.filter(log => log.level === 'F');
    
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
    const otherLogs = logsToAnalyze.filter(log => !['E', 'W', 'F'].includes(log.level)).slice(0, 20);
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

  formatLogsForAI(logs) {
    return logs.map(log => {
      return `[${log.timestamp || 'N/A'}] ${log.level}/${log.tag}: ${log.message}`;
    }).join('\n');
  }
}

module.exports = AIService;
