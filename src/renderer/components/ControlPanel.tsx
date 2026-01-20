import React from 'react';
import { LogFilters } from '../types';
import DateTimeRangePicker from './DateTimeRangePicker';
import { 
  Drawer, 
  Button, 
  Input, 
  Select, 
  Space, 
  Divider, 
  Alert,
  Radio,
  Collapse,
  Tag
} from 'antd';
import {
  FolderOpenOutlined,
  SearchOutlined,
  ClearOutlined,
  SaveOutlined,
  FolderOutlined,
  ImportOutlined,
  ExportOutlined,
  RobotOutlined,
  SettingOutlined,
  LoadingOutlined,
  CheckOutlined
} from '@ant-design/icons';

interface ControlPanelProps {
  filters: LogFilters;
  setFilters: (filters: LogFilters) => void;
  startDate: Date | null;
  endDate: Date | null;
  setStartDate: (date: Date | null) => void;
  setEndDate: (date: Date | null) => void;
  onOpenFiles: () => void;
  onSearch: () => void;
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
  isSearching: boolean;
  drawerOpen: boolean;
  onDrawerClose: () => void;
  onManagePresets: () => void;
  lineBreakMode: 'wrap' | 'nowrap';
  onLineBreakModeChange: (mode: 'wrap' | 'nowrap') => void;
  onLoadPreset: (filters: LogFilters) => void;
  onDeleteFile: (filePath: string) => void;
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  filters,
  setFilters,
  startDate,
  endDate,
  setStartDate,
  setEndDate,
  onOpenFiles,
  onSearch,
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
  isSearching,
  drawerOpen,
  onDrawerClose,
  onManagePresets,
  lineBreakMode,
  onLineBreakModeChange,
  onLoadPreset,
  onDeleteFile,
}) => {
  const [aiPrompt, setAiPrompt] = React.useState<string>('');
  const [savedPresets, setSavedPresets] = React.useState<any[]>([]);

  React.useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = () => {
    const saved = localStorage.getItem('ala_filter_presets');
    if (saved) {
      try {
        setSavedPresets(JSON.parse(saved));
      } catch (e) {
        console.error('Failed to load presets:', e);
      }
    }
  };

  const handleApplyPreset = (preset: any) => {
    onLoadPreset(preset.filters);
  };

  const updateFilter = (key: keyof LogFilters, value: string) => {
    setFilters({ ...filters, [key]: value });
  };

  return (
    <Drawer
      title="Control Panel"
      placement="right"
      onClose={onDrawerClose}
      open={drawerOpen}
      width={400}
      className="control-panel-drawer"
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {/* File Controls */}
        <div>
          <Button 
            type="primary"
            icon={<FolderOpenOutlined />}
            onClick={onOpenFiles}
            block
            size="large"
          >
            Open Log File(s)
          </Button>
          {currentFiles.length > 0 && (
            <div className="mt-2 space-y-1">
              {currentFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between text-accent-teal text-xs break-all bg-dark-panel p-2 rounded">
                  <span className="flex-1">📄 {file.split(/[\\/]/).pop()}</span>
                  {currentFiles.length > 1 && (
                    <Button
                      type="text"
                      size="small"
                      danger
                      onClick={() => onDeleteFile(file)}
                      className="ml-2"
                    >
                      ✕
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Line Break Mode */}
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Line Break Mode:</label>
          <Radio.Group 
            value={lineBreakMode}
            onChange={(e) => onLineBreakModeChange(e.target.value)}
            buttonStyle="solid"
            style={{ width: '100%' }}
          >
            <Radio.Button value="wrap" style={{ width: '50%', textAlign: 'center' }}>Word Wrap</Radio.Button>
            <Radio.Button value="nowrap" style={{ width: '50%', textAlign: 'center' }}>No Wrap</Radio.Button>
          </Radio.Group>
        </div>

        <Divider style={{ margin: '8px 0', borderColor: 'var(--ant-color-border)' }}>Filters</Divider>
        
        {/* Time Range with DatePicker */}
        <div>
          <DateTimeRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />
        </div>

        {/* Keywords */}
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Keywords (regex supported):</label>
          <Input 
            value={filters.keywords}
            onChange={(e) => updateFilter('keywords', e.target.value)}
            placeholder="e.g., error|crash|exception" 
          />
        </div>

        {/* Log Level */}
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Log Level:</label>
          <Select 
            value={filters.level}
            onChange={(value) => updateFilter('level', value)}
            style={{ width: '100%' }}
            options={[
              { value: 'ALL', label: 'All' },
              { value: 'V', label: 'Verbose' },
              { value: 'D', label: 'Debug' },
              { value: 'I', label: 'Info' },
              { value: 'W', label: 'Warning' },
              { value: 'E', label: 'Error' },
              { value: 'F', label: 'Fatal' },
            ]}
          />
        </div>

        {/* Tag Filter */}
        <div>
          <label className="text-xs text-text-secondary mb-1 block">Tag Filter (regex):</label>
          <Input 
            value={filters.tag}
            onChange={(e) => updateFilter('tag', e.target.value)}
            placeholder="e.g., Activity.*" 
          />
        </div>

        {/* PID */}
        <div>
          <label className="text-xs text-text-secondary mb-1 block">PID:</label>
          <Input 
            value={filters.pid}
            onChange={(e) => updateFilter('pid', e.target.value)}
            placeholder="e.g., 12345" 
          />
        </div>

        {/* Search/Clear Buttons */}
        <Space.Compact block>
          <Button 
            type="primary"
            icon={isSearching ? <LoadingOutlined /> : <SearchOutlined />}
            onClick={onSearch}
            disabled={isSearching}
            style={{ flex: 1 }}
          >
            {isSearching ? 'Searching...' : 'Search'}
          </Button>
          <Button 
            icon={<ClearOutlined />}
            onClick={onClearFilters}
            disabled={isSearching}
          >
            Clear
          </Button>
        </Space.Compact>
        
        {/* Save/Load Buttons */}
        <Space.Compact block>
          <Button 
            icon={<SaveOutlined />}
            onClick={onSaveFilters}
            style={{ flex: 1 }}
          >
            Save
          </Button>
          <Button 
            icon={<FolderOutlined />}
            onClick={onLoadFilters}
            style={{ flex: 1 }}
          >
            Load
          </Button>
        </Space.Compact>

        {/* Import/Export Buttons */}
        <Space.Compact block>
          <Button 
            icon={<ImportOutlined />}
            onClick={onImportFilters}
            style={{ flex: 1 }}
          >
            Import
          </Button>
          <Button 
            icon={<ExportOutlined />}
            onClick={onExportFilters}
            style={{ flex: 1 }}
          >
            Export
          </Button>
        </Space.Compact>

        {/* Manage Presets Button */}
        <Button 
          icon={<SettingOutlined />}
          onClick={onManagePresets}
          block
        >
          Manage Presets
        </Button>

        {/* Filter Presets Collapse */}
        {savedPresets.length > 0 && (
          <Collapse
            size="small"
            items={savedPresets.map((preset) => ({
              key: preset.id,
              label: preset.name,
              children: (
                <div className="space-y-2">
                  {preset.description && (
                    <p className="text-xs text-text-secondary">{preset.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1">
                    {preset.filters.keywords && (
                      <Tag color="blue" className="text-xs">Keywords: {preset.filters.keywords}</Tag>
                    )}
                    {preset.filters.level && preset.filters.level !== 'ALL' && (
                      <Tag color="green" className="text-xs">Level: {preset.filters.level}</Tag>
                    )}
                    {preset.filters.tag && (
                      <Tag color="purple" className="text-xs">Tag: {preset.filters.tag}</Tag>
                    )}
                  </div>
                  <Button 
                    type="primary" 
                    size="small" 
                    icon={<CheckOutlined />}
                    onClick={() => handleApplyPreset(preset)}
                    block
                  >
                    Apply Preset
                  </Button>
                </div>
              ),
            }))}
          />
        )}

        <Divider style={{ margin: '8px 0', borderColor: 'var(--ant-color-border)' }}>AI Analysis</Divider>
        
        {/* AI Prompt */}
        <div>
          <Input.TextArea 
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder="Optional: Enter specific questions or analysis requests for the AI..." 
            rows={3} 
            style={{ resize: 'vertical' }}
          />
        </div>
        
        <Button 
          type="primary"
          icon={<RobotOutlined />}
          onClick={() => onAnalyzeWithAI(aiPrompt)}
          disabled={!aiConfigured}
          block
          size="large"
          className="ai-analyze-button"
        >
          Analyze with AI
        </Button>

        {/* Status Message */}
        {statusMessage && (
          <Alert 
            message={statusMessage}
            type={statusType === 'info' ? 'info' : 'error'}
            showIcon
            closable
          />
        )}
      </Space>
    </Drawer>
  );
};

export default ControlPanel;
