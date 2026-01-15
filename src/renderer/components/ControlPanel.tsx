import React from 'react';
import { LogFilters } from '../types';

interface ControlPanelProps {
  filters: LogFilters;
  setFilters: (filters: LogFilters) => void;
  onOpenFiles: () => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
  onSaveFilters: () => void;
  onLoadFilters: () => void;
  onImportFilters: () => void;
  onExportFilters: () => void;
  onAnalyzeWithAI: (prompt?: string) => void;
  currentFiles: string[];
  aiConfigured: boolean;
  statusMessage: string;
  statusType: 'info' | 'error';
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  filters,
  setFilters,
  onOpenFiles,
  onApplyFilters,
  onClearFilters,
  onSaveFilters,
  onLoadFilters,
  onImportFilters,
  onExportFilters,
  onAnalyzeWithAI,
  currentFiles,
  aiConfigured,
  statusMessage,
  statusType,
}) => {
  const [aiPrompt, setAiPrompt] = React.useState<string>('');

  const updateFilter = (key: keyof LogFilters, value: string) => {
    setFilters({ ...filters, [key]: value });
  };

  return (
    <section className="w-96 bg-dark-panel p-5 overflow-y-auto scrollbar-custom border-r border-dark-border">
      {/* File Controls */}
      <div className="mb-6">
        <button 
          onClick={onOpenFiles}
          className="bg-accent-blue text-white px-5 py-2.5 rounded hover:bg-blue-700 transition font-medium w-full"
        >
          📁 Open Log File(s)
        </button>
        {currentFiles.length > 0 && (
          <span className="block mt-2.5 text-accent-teal text-xs break-all">
            {currentFiles.length === 1 
              ? `📄 ${currentFiles[0].split(/[\\/]/).pop()}`
              : `📄 ${currentFiles.length} files loaded`
            }
          </span>
        )}
      </div>

      {/* Filters Section */}
      <div className="mb-6">
        <h3 className="text-accent-teal text-base mb-4 border-b border-dark-border pb-2">Filters</h3>
        
        {/* Time Range */}
        <div className="flex gap-2.5 mb-3">
          <div className="flex-1 flex flex-col">
            <label className="text-xs text-text-secondary mb-1.5">Start Time (MM-DD HH:MM:SS.mmm):</label>
            <input 
              type="text" 
              value={filters.startTime}
              onChange={(e) => updateFilter('startTime', e.target.value)}
              placeholder="e.g., 01-15 10:30:00.000" 
              className="bg-dark-input border border-dark-border text-text-primary px-2 py-2 rounded text-sm focus:outline-none focus:border-accent-blue"
            />
          </div>
          <div className="flex-1 flex flex-col">
            <label className="text-xs text-text-secondary mb-1.5">End Time (MM-DD HH:MM:SS.mmm):</label>
            <input 
              type="text" 
              value={filters.endTime}
              onChange={(e) => updateFilter('endTime', e.target.value)}
              placeholder="e.g., 01-15 11:30:00.000" 
              className="bg-dark-input border border-dark-border text-text-primary px-2 py-2 rounded text-sm focus:outline-none focus:border-accent-blue"
            />
          </div>
        </div>

        {/* Keywords and Level */}
        <div className="flex gap-2.5 mb-3">
          <div className="flex-1 flex flex-col">
            <label className="text-xs text-text-secondary mb-1.5">Keywords (regex supported):</label>
            <input 
              type="text" 
              value={filters.keywords}
              onChange={(e) => updateFilter('keywords', e.target.value)}
              placeholder="e.g., error|crash|exception" 
              className="bg-dark-input border border-dark-border text-text-primary px-2 py-2 rounded text-sm focus:outline-none focus:border-accent-blue"
            />
          </div>
          <div className="flex-1 flex flex-col">
            <label className="text-xs text-text-secondary mb-1.5">Log Level:</label>
            <select 
              value={filters.level}
              onChange={(e) => updateFilter('level', e.target.value)}
              className="bg-dark-input border border-dark-border text-text-primary px-2 py-2 rounded text-sm focus:outline-none focus:border-accent-blue"
            >
              <option value="ALL">All</option>
              <option value="V">Verbose</option>
              <option value="D">Debug</option>
              <option value="I">Info</option>
              <option value="W">Warning</option>
              <option value="E">Error</option>
              <option value="F">Fatal</option>
            </select>
          </div>
        </div>

        {/* Tag and PID */}
        <div className="flex gap-2.5 mb-3">
          <div className="flex-1 flex flex-col">
            <label className="text-xs text-text-secondary mb-1.5">Tag Filter (regex):</label>
            <input 
              type="text" 
              value={filters.tag}
              onChange={(e) => updateFilter('tag', e.target.value)}
              placeholder="e.g., Activity.*" 
              className="bg-dark-input border border-dark-border text-text-primary px-2 py-2 rounded text-sm focus:outline-none focus:border-accent-blue"
            />
          </div>
          <div className="flex-1 flex flex-col">
            <label className="text-xs text-text-secondary mb-1.5">PID:</label>
            <input 
              type="text" 
              value={filters.pid}
              onChange={(e) => updateFilter('pid', e.target.value)}
              placeholder="e.g., 12345" 
              className="bg-dark-input border border-dark-border text-text-primary px-2 py-2 rounded text-sm focus:outline-none focus:border-accent-blue"
            />
          </div>
        </div>

        {/* Apply/Clear Buttons */}
        <div className="flex gap-2.5 mt-4">
          <button 
            onClick={onApplyFilters}
            className="bg-accent-teal text-dark-bg px-5 py-2.5 rounded hover:bg-teal-600 transition font-medium flex-1"
          >
            🔍 Apply Filters
          </button>
          <button 
            onClick={onClearFilters}
            className="bg-transparent text-text-secondary px-4 py-2.5 rounded hover:text-text-primary transition"
          >
            Clear
          </button>
        </div>
        
        {/* Save/Load Buttons */}
        <div className="flex gap-2.5 mt-2.5">
          <button 
            onClick={onSaveFilters}
            className="bg-transparent border border-accent-blue text-accent-blue px-4 py-1.5 rounded hover:bg-accent-blue hover:text-white transition text-sm flex-1"
          >
            💾 Save
          </button>
          <button 
            onClick={onLoadFilters}
            className="bg-transparent border border-accent-blue text-accent-blue px-4 py-1.5 rounded hover:bg-accent-blue hover:text-white transition text-sm flex-1"
          >
            📂 Load
          </button>
        </div>

        {/* Import/Export Buttons (NEW) */}
        <div className="flex gap-2.5 mt-2.5">
          <button 
            onClick={onImportFilters}
            className="bg-transparent border border-accent-purple text-accent-purple px-4 py-1.5 rounded hover:bg-accent-purple hover:text-white transition text-sm flex-1"
          >
            📥 Import
          </button>
          <button 
            onClick={onExportFilters}
            className="bg-transparent border border-accent-purple text-accent-purple px-4 py-1.5 rounded hover:bg-accent-purple hover:text-white transition text-sm flex-1"
          >
            📤 Export
          </button>
        </div>
      </div>

      {/* AI Analysis Section */}
      <div className="mb-6">
        <h3 className="text-accent-teal text-base mb-4 border-b border-dark-border pb-2">AI Analysis</h3>
        <textarea 
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          placeholder="Optional: Enter specific questions or analysis requests for the AI..." 
          rows={2} 
          className="w-full bg-dark-input border border-dark-border text-text-primary px-2.5 py-2.5 rounded text-sm resize-y mb-2.5 focus:outline-none focus:border-accent-blue"
        />
        <button 
          onClick={() => onAnalyzeWithAI(aiPrompt)}
          disabled={!aiConfigured}
          className="bg-accent-purple text-white px-5 py-2.5 rounded hover:bg-purple-700 transition font-medium w-full disabled:opacity-50 disabled:cursor-not-allowed"
        >
          🤖 Analyze with AI
        </button>
        {statusMessage && (
          <div className={`mt-2.5 px-2 py-2 rounded text-xs ${
            statusType === 'info' ? 'bg-blue-900/40 text-blue-300' : 'bg-red-900/40 text-red-300'
          }`}>
            {statusMessage}
          </div>
        )}
      </div>
    </section>
  );
};

export default ControlPanel;
