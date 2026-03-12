import React, { useState, useEffect } from 'react';
import { ConfigProvider, theme as antdTheme, Layout } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { useTranslation } from 'react-i18next';
import { LogEntry, LogFilters, LogStatistics } from './types';
import Header from './components/Header';
import AppSider from './components/AppSider';
import LogViewer from './components/LogViewer';
import AiPanel from './components/AiPanel';
import FilterPresetManager, { FilterPreset } from './components/FilterPresetManager';
import SettingsModal from './components/SettingsModal';

const { Content, Sider } = Layout;

// Constants
const KEYWORD_SEPARATOR = '|';
const FILTER_CHUNK_SIZE = 10000;

/**
 * Filter logs asynchronously in chunks to avoid blocking the UI thread.
 * Operates on the existing in-memory array — no structured-clone / postMessage
 * serialization, so it works with arbitrarily large datasets.
 */
async function filterLogsAsync(logs: LogEntry[], filters: LogFilters): Promise<LogEntry[]> {
  // Pre-compile regexes once to avoid per-entry cost
  let keywordRegex: RegExp | null = null;
  if (filters.keywords && filters.keywords.trim()) {
    try {
      keywordRegex = new RegExp(filters.keywords, 'i');
    } catch {
      /* fall back to includes below */
    }
  }
  let tagRegex: RegExp | null = null;
  if (filters.tag && filters.tag.trim()) {
    try {
      tagRegex = new RegExp(filters.tag, 'i');
    } catch {
      /* fall back to includes below */
    }
  }

  const filtered: LogEntry[] = [];

  for (let i = 0; i < logs.length; i += FILTER_CHUNK_SIZE) {
    const end = Math.min(i + FILTER_CHUNK_SIZE, logs.length);
    for (let j = i; j < end; j++) {
      const log = logs[j];

      // Exclude entries with no timestamp when time filters are active
      const ts = log.timestamp;
      if ((filters.startTime || filters.endTime) && (ts === null || ts === undefined)) {
        continue;
      }
      if (filters.startTime && ts! < filters.startTime) continue;
      if (filters.endTime && ts! > filters.endTime) continue;

      // Keywords filter
      if (keywordRegex) {
        if (!keywordRegex.test(log.message)) continue;
      } else if (filters.keywords && filters.keywords.trim()) {
        if (!log.message.toLowerCase().includes(filters.keywords.toLowerCase())) continue;
      }

      // Level filter
      if (filters.level && filters.level !== 'ALL' && log.level !== filters.level) continue;

      // Tag filter
      if (tagRegex) {
        if (!tagRegex.test(log.tag)) continue;
      } else if (filters.tag && filters.tag.trim()) {
        if (!log.tag.toLowerCase().includes(filters.tag.toLowerCase())) continue;
      }

      // PID filter
      if (filters.pid && filters.pid.trim() && log.pid !== filters.pid) continue;

      filtered.push(log);
    }

    // Yield to the event loop between chunks to keep the UI responsive
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  return filtered;
}

const App: React.FC = () => {
  const { i18n, t } = useTranslation();
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [filteredLogs, setFilteredLogs] = useState<LogEntry[]>([]);
  const [currentFiles, setCurrentFiles] = useState<string[]>([]);
  const [rawFileContents, setRawFileContents] = useState<{ filePath: string; content: string }[]>(
    []
  );
  const [statistics, setStatistics] = useState<LogStatistics | null>(null);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);
  const [filters, setFilters] = useState<LogFilters>({
    startTime: '',
    endTime: '',
    keywords: '',
    highlights: '',
    coloredHighlights: [],
    level: 'ALL',
    tag: '',
    pid: '',
  });
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [statusType, setStatusType] = useState<'info' | 'error'>('info');
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [aiPanelOpen, setAiPanelOpen] = useState<boolean>(false);
  const [sourceFiles, setSourceFiles] = useState<{ filePath: string; content: string }[]>([]);
  const [presetManagerVisible, setPresetManagerVisible] = useState<boolean>(false);
  const [settingsModalVisible, setSettingsModalVisible] = useState<boolean>(false);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>('dark');
  const [lineBreakMode, setLineBreakMode] = useState<'wrap' | 'nowrap'>('wrap');
  const [activePresetDescriptions, setActivePresetDescriptions] = useState<{
    keywordDescriptions: { keyword: string; description: string }[];
    highlightDescriptions: { keyword: string; description: string }[];
    tagDescription: string;
  }>({ keywordDescriptions: [], highlightDescriptions: [], tagDescription: '' });

  useEffect(() => {
    // Load language preference from localStorage
    const savedLanguage = localStorage.getItem('ala_language');
    if (savedLanguage) {
      i18n.changeLanguage(savedLanguage);
    }

    // Load theme preference from localStorage
    const savedTheme = localStorage.getItem('ala_theme') as 'dark' | 'light' | null;
    if (savedTheme) {
      setThemeMode(savedTheme);
    }

    // Load saved filters from localStorage (excluding time and PID fields)
    const savedFilters = localStorage.getItem('ala_saved_filters');
    if (savedFilters) {
      try {
        const parsed = JSON.parse(savedFilters);
        // Don't restore time and PID fields
        setFilters({
          ...parsed,
          startTime: '',
          endTime: '',
          pid: '',
        });
      } catch (e) {
        console.error('Failed to load saved filters:', e);
      }
    }

    // Load presets from localStorage
    const loadPresets = () => {
      const saved = localStorage.getItem('ala_filter_presets');
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            setPresets(parsed);
          }
        } catch (e) {
          console.error('Failed to load presets:', e);
        }
      }
    };
    loadPresets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Update statistics whenever filteredLogs changes
    if (filteredLogs.length > 0) {
      updateStatistics();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredLogs]);

  const showStatus = (message: string, type: 'info' | 'error' = 'info') => {
    setStatusMessage(message);
    setStatusType(type);
    setTimeout(() => setStatusMessage(''), 5000);
  };

  const handleOpenFiles = async () => {
    const results = await window.electronAPI.openLogFiles();
    if (results && results.length > 0) {
      const fileNames = results.map((r) => r.filePath);
      setCurrentFiles(fileNames);
      setRawFileContents(results);

      // Clear existing logs
      setAllLogs([]);
      setFilteredLogs([]);

      showStatus(t('filesLoaded', { count: results.length }), 'info');
    }
  };

  const handleSearch = async () => {
    if (rawFileContents.length === 0 && allLogs.length === 0) {
      showStatus(t('noLogFileLoaded'), 'error');
      return;
    }

    setIsSearching(true);

    // Parse files on first search if not already parsed
    if (rawFileContents.length > 0 && allLogs.length === 0) {
      showStatus(`Parsing ${rawFileContents.length} log file(s)...`, 'info');

      let allParsedLogs: LogEntry[] = [];

      for (const result of rawFileContents) {
        const parseResult = await window.electronAPI.parseLog(result.content);
        const logs = parseResult.logs;

        // Add file source to each log entry
        logs.forEach((log) => {
          log.sourceFile = result.filePath.split(/[\\/]/).pop();
        });
        allParsedLogs = allParsedLogs.concat(logs);
      }

      setAllLogs(allParsedLogs);
      // Clear raw contents after parsing
      setRawFileContents([]);

      showStatus(t('logLinesParsed', { count: allParsedLogs.length }), 'info');

      // Now filter the parsed logs
      const filterData = {
        ...filters,
        startTime: startDate ? formatDateToTimestamp(startDate) : '',
        endTime: endDate ? formatDateToTimestamp(endDate) : '',
      };

      // Filter the parsed logs asynchronously (no postMessage / clone)
      try {
        const filtered = await filterLogsAsync(allParsedLogs, filterData);
        setFilteredLogs(filtered);
        setIsSearching(false);
        showStatus(t('filteredLogLines', { count: filtered.length }), 'info');
      } catch (err) {
        setIsSearching(false);
        showStatus(`Filter error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    } else {
      showStatus('Searching...', 'info');

      // Convert dates to timestamp strings for filtering
      const filterData = {
        ...filters,
        startTime: startDate ? formatDateToTimestamp(startDate) : '',
        endTime: endDate ? formatDateToTimestamp(endDate) : '',
      };

      // Filter logs asynchronously (no postMessage / clone)
      try {
        const filtered = await filterLogsAsync(allLogs, filterData);
        setFilteredLogs(filtered);
        setIsSearching(false);
        showStatus(t('filteredLogLines', { count: filtered.length }), 'info');
      } catch (err) {
        setIsSearching(false);
        showStatus(`Filter error: ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    }
  };

  const formatDateToTimestamp = (date: Date): string => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const ms = String(date.getMilliseconds()).padStart(3, '0');
    return `${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
  };

  const handleClearFilters = () => {
    const clearedFilters: LogFilters = {
      startTime: '',
      endTime: '',
      keywords: '',
      highlights: '',
      level: 'ALL',
      tag: '',
      pid: '',
      coloredHighlights: [],
    };
    setFilters(clearedFilters);
    setStartDate(null);
    setEndDate(null);
    setFilteredLogs([]);
    showStatus(t('filtersCleared'), 'info');
  };

  const handleAddHighlight = (text: string, color?: string) => {
    // Escape special regex characters for safe pattern matching
    const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    if (color) {
      // Use new colored highlights format
      const newColoredHighlights = [...(filters.coloredHighlights || [])];

      // Check if this pattern already exists
      const existingIndex = newColoredHighlights.findIndex((h) => h.pattern === escapedText);

      if (existingIndex >= 0) {
        // Update existing highlight's color
        newColoredHighlights[existingIndex] = {
          ...newColoredHighlights[existingIndex],
          color,
        };
      } else {
        // Add new colored highlight
        newColoredHighlights.push({
          pattern: escapedText,
          color: color,
        });
      }

      setFilters({
        ...filters,
        coloredHighlights: newColoredHighlights,
      });
    } else {
      // Fallback to legacy highlights format (for backward compatibility)
      const currentHighlights = filters.highlights.trim();
      const newHighlights = currentHighlights ? `${currentHighlights}|${escapedText}` : escapedText;

      setFilters({
        ...filters,
        highlights: newHighlights,
      });
    }
  };

  const handleRemoveColoredHighlight = (pattern: string) => {
    const newColoredHighlights = (filters.coloredHighlights || []).filter(
      (h) => h.pattern !== pattern
    );
    setFilters({
      ...filters,
      coloredHighlights: newColoredHighlights,
    });
  };

  const handleImportPresetsToManager = async () => {
    const imported = await window.electronAPI.importFilters();
    if (imported) {
      // Import as a new preset - we can create a preset from the imported filters
      // For now, just show status
      showStatus(t('importPresetsThroughManager'), 'info');
    } else {
      showStatus('Failed to import', 'error');
    }
  };

  const handleExportPresetsFromManager = async () => {
    // Export all presets
    const success = await window.electronAPI.exportFilters(presets);
    if (success) {
      showStatus('Presets exported successfully!', 'info');
    } else {
      showStatus('Failed to export presets', 'error');
    }
  };

  const handleOpenSourceFiles = async () => {
    const files = await window.electronAPI.openSourceFiles();
    if (files && files.length > 0) {
      // Merge newly selected files into existing list (avoid duplicates)
      const existingPaths = new Set(sourceFiles.map((f) => f.filePath));
      const newFiles = files.filter((f) => !existingPaths.has(f.filePath));

      if (newFiles.length > 0) {
        const mergedFiles = [...sourceFiles, ...newFiles];
        setSourceFiles(mergedFiles);
        const fileNames = newFiles.map((f) => f.filePath.split(/[\\/]/).pop()).join(', ');
        showStatus(t('sourceFilesAdded', { count: newFiles.length, names: fileNames }), 'info');
      } else {
        showStatus(t('noNewSourceFiles'), 'info');
      }
    }
  };

  const handleRemoveSourceFile = (filePath: string) => {
    setSourceFiles((prev) => prev.filter((f) => f.filePath !== filePath));
    const fileName = filePath.split(/[\\/]/).pop();
    showStatus(t('removeSourceFile', { name: fileName }), 'info');
  };

  const updateStatistics = async () => {
    if (filteredLogs.length > 0) {
      const stats = await window.electronAPI.getStatistics(filteredLogs);
      setStatistics(stats);
    }
  };

  const handleLoadPreset = (preset: FilterPreset) => {
    // Extract keywords, highlights, and tag from config
    const keywordTexts = preset.config.keywords.map((k) => k.text).join(KEYWORD_SEPARATOR);
    const highlightTexts = preset.config.highlights.map((h) => h.text).join(KEYWORD_SEPARATOR);
    const tagText = preset.config.tag?.text || '';

    setFilters({
      ...filters,
      keywords: keywordTexts,
      highlights: highlightTexts,
      tag: tagText,
    });

    // Set descriptions from the preset
    setActivePresetDescriptions({
      keywordDescriptions: preset.config.keywords.map((k) => ({
        keyword: k.text,
        description: k.description,
      })),
      highlightDescriptions: preset.config.highlights.map((h) => ({
        keyword: h.text,
        description: h.description,
      })),
      tagDescription: preset.config.tag?.description || '',
    });
    showStatus('Preset loaded successfully!', 'info');
  };

  const handleApplyMultiplePresets = (presets: FilterPreset[]) => {
    if (presets.length === 0) return;

    // Merge multiple presets - combine keywords, highlights, and tags with OR operator (|)
    // Note: Log level is not merged from presets - it remains at ALL or user's manual selection
    const mergedFilters: LogFilters = {
      startTime: '',
      endTime: '',
      keywords: '',
      highlights: '',
      level: 'ALL',
      tag: '',
      pid: '',
    };

    // Merge keyword descriptions
    const allKeywordDescriptions: { keyword: string; description: string }[] = [];
    presets.forEach((p) => {
      p.config.keywords.forEach((k) => {
        allKeywordDescriptions.push({ keyword: k.text, description: k.description });
      });
    });

    // Merge highlight descriptions
    const allHighlightDescriptions: { keyword: string; description: string }[] = [];
    presets.forEach((p) => {
      p.config.highlights.forEach((h) => {
        allHighlightDescriptions.push({ keyword: h.text, description: h.description });
      });
    });

    // Merge tag descriptions (join with semicolon if multiple)
    const allTagDescriptions = presets
      .map((p) => p.config.tag?.description)
      .filter((d) => d && d.trim())
      .join('; ');

    // Combine keywords with OR operator
    const allKeywords = presets
      .flatMap((p) => p.config.keywords.map((k) => k.text))
      .filter((k) => k && k.trim())
      .join(KEYWORD_SEPARATOR);

    if (allKeywords) {
      mergedFilters.keywords = allKeywords;
    }

    // Combine highlights with OR operator
    const allHighlights = presets
      .flatMap((p) => p.config.highlights.map((h) => h.text))
      .filter((h) => h && h.trim())
      .join(KEYWORD_SEPARATOR);

    if (allHighlights) {
      mergedFilters.highlights = allHighlights;
    }

    // Combine tags with OR operator
    const allTags = presets
      .map((p) => p.config.tag?.text)
      .filter((t) => t && t.trim())
      .join(KEYWORD_SEPARATOR);

    if (allTags) {
      mergedFilters.tag = allTags;
    }

    setFilters(mergedFilters);
    setActivePresetDescriptions({
      keywordDescriptions: allKeywordDescriptions,
      highlightDescriptions: allHighlightDescriptions,
      tagDescription: allTagDescriptions,
    });
    showStatus(
      `Applied ${presets.length} presets. Keywords, highlights, and tags combined with OR.`,
      'info'
    );
  };

  const handleToggleTheme = () => {
    const newTheme = themeMode === 'dark' ? 'light' : 'dark';
    setThemeMode(newTheme);
    localStorage.setItem('ala_theme', newTheme);
  };

  const handleConfigUpdated = () => {
    // Config is now managed entirely in localStorage by the renderer AI service
    showStatus(t('aiConfigUpdated'), 'info');
  };

  const handleDeleteFile = async (filePath: string) => {
    // Remove from currentFiles
    const updatedFiles = currentFiles.filter((f) => f !== filePath);
    setCurrentFiles(updatedFiles);

    // Remove from raw file contents if not yet parsed
    const updatedRawContents = rawFileContents.filter((f) => f.filePath !== filePath);
    setRawFileContents(updatedRawContents);

    // Remove logs from this file
    const fileName = filePath.split(/[\\/]/).pop();
    const updatedAllLogs = allLogs.filter((log) => log.sourceFile !== fileName);
    const updatedFilteredLogs = filteredLogs.filter((log) => log.sourceFile !== fileName);

    setAllLogs(updatedAllLogs);
    setFilteredLogs(updatedFilteredLogs);

    // Call IPC to confirm deletion (just returns success)
    await window.electronAPI.deleteLogFile(filePath);

    showStatus(`Removed ${fileName} from view`, 'info');
  };

  // Get antd locale based on current language
  const antdLocale = i18n.language === 'zh' ? zhCN : enUS;

  return (
    <ConfigProvider
      locale={antdLocale}
      theme={{
        algorithm: themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: themeMode === 'dark' ? '#4ec9b0' : '#1890ff',
          colorBgContainer: themeMode === 'dark' ? '#252526' : '#ffffff',
          colorBgElevated: themeMode === 'dark' ? '#2d2d2d' : '#f5f5f5',
          colorText: themeMode === 'dark' ? '#d4d4d4' : '#000000',
          colorBorder: themeMode === 'dark' ? '#3e3e42' : '#d9d9d9',
        },
      }}
    >
      <Layout style={{ height: '100vh' }}>
        <Header
          theme={themeMode}
          onToggleTheme={handleToggleTheme}
          aiPanelOpen={aiPanelOpen}
          onToggleAiPanel={() => setAiPanelOpen((prev) => !prev)}
        />

        <Layout style={{ flex: 1, overflow: 'hidden' }}>
          <AppSider
            filters={filters}
            setFilters={setFilters}
            startDate={startDate}
            endDate={endDate}
            setStartDate={setStartDate}
            setEndDate={setEndDate}
            onOpenFiles={handleOpenFiles}
            onSearch={handleSearch}
            onClearFilters={handleClearFilters}
            currentFiles={currentFiles}
            statusMessage={statusMessage}
            statusType={statusType}
            isSearching={isSearching}
            onLoadPreset={handleLoadPreset}
            onApplyMultiplePresets={handleApplyMultiplePresets}
            onDeleteFile={handleDeleteFile}
            presets={presets}
            onManagePresets={() => setPresetManagerVisible(true)}
            onOpenSettings={() => setSettingsModalVisible(true)}
            themeMode={themeMode}
            onRemoveColoredHighlight={handleRemoveColoredHighlight}
          />

          <Content style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <LogViewer
              logs={filteredLogs}
              allLogsCount={allLogs.length}
              statistics={statistics}
              currentFiles={currentFiles}
              highlights={filters.highlights}
              coloredHighlights={filters.coloredHighlights || []}
              isSearching={isSearching}
              lineBreakMode={lineBreakMode}
              onLineBreakModeChange={setLineBreakMode}
              themeMode={themeMode}
              highlightDescriptions={activePresetDescriptions.highlightDescriptions}
              tagDescription={activePresetDescriptions.tagDescription}
              currentTag={filters.tag}
              onAddHighlight={handleAddHighlight}
            />
          </Content>

          {/* AI Analysis Panel - collapsible right sider */}
          {aiPanelOpen && (
            <Sider
              width={420}
              style={{
                backgroundColor: 'var(--ant-color-bg-container)',
                borderLeft: '1px solid var(--ant-color-border)',
                overflow: 'hidden',
              }}
            >
              <AiPanel
                filteredLogs={filteredLogs}
                sourceFiles={sourceFiles}
                onOpenSourceFiles={handleOpenSourceFiles}
                onRemoveSourceFile={handleRemoveSourceFile}
                onOpenSettings={() => setSettingsModalVisible(true)}
                language={i18n.language}
              />
            </Sider>
          )}
        </Layout>

        <FilterPresetManager
          visible={presetManagerVisible}
          onClose={() => {
            setPresetManagerVisible(false);
            // Reload presets when closing to reflect any changes
            const saved = localStorage.getItem('ala_filter_presets');
            if (saved) {
              try {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) {
                  setPresets(parsed);
                }
              } catch (e) {
                console.error('Failed to reload presets:', e);
              }
            }
          }}
          onLoadPreset={handleLoadPreset}
          onApplyMultiplePresets={handleApplyMultiplePresets}
          onImport={handleImportPresetsToManager}
          onExport={handleExportPresetsFromManager}
        />

        <SettingsModal
          visible={settingsModalVisible}
          onClose={() => setSettingsModalVisible(false)}
          onConfigUpdated={handleConfigUpdated}
        />
      </Layout>
    </ConfigProvider>
  );
};

export default App;
