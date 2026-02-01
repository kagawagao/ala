import React from 'react';
import { LogFilters } from '../types';
import { FilterPreset } from './FilterPresetManager';
import DateTimeRangePicker from './DateTimeRangePicker';
import { 
  Drawer, 
  Button, 
  Input, 
  Select, 
  Space, 
  Divider, 
  Alert,
  FloatButton
} from 'antd';
import {
  FolderOpenOutlined,
  SearchOutlined,
  ClearOutlined,
  RobotOutlined,
  LoadingOutlined,
  CheckOutlined
} from '@ant-design/icons';
import { useTranslation } from 'react-i18next';

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
  onAnalyzeWithAI: (prompt?: string) => void;
  currentFiles: string[];
  aiConfigured: boolean;
  statusMessage: string;
  statusType: 'info' | 'error';
  isSearching: boolean;
  drawerOpen: boolean;
  onDrawerClose: () => void;
  onLoadPreset: (preset: FilterPreset) => void;
  onApplyMultiplePresets: (presets: FilterPreset[]) => void;
  onDeleteFile: (filePath: string) => void;
  presets: FilterPreset[];
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
  onAnalyzeWithAI,
  currentFiles,
  aiConfigured,
  statusMessage,
  statusType,
  isSearching,
  drawerOpen,
  onDrawerClose,
  onLoadPreset,
  onApplyMultiplePresets,
  onDeleteFile,
  presets,
}) => {
  const { t } = useTranslation();
  const [aiPrompt, setAiPrompt] = React.useState<string>('');
  const [aiPanelOpen, setAiPanelOpen] = React.useState<boolean>(false);

  const updateFilter = (key: keyof LogFilters, value: string) => {
    setFilters({ ...filters, [key]: value });
  };

  return (
    <>
      <Drawer
        title={t('controlPanel')}
        placement="right"
        onClose={onDrawerClose}
        open={drawerOpen}
        width={400}
        mask={false}
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
              {t('openFiles')}
            </Button>
            {currentFiles.length > 0 && (
              <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {currentFiles.map((file, index) => (
                  <div 
                    key={index} 
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'space-between',
                      fontSize: '12px',
                      wordBreak: 'break-all',
                      padding: '8px',
                      borderRadius: '4px',
                      backgroundColor: 'var(--ant-color-bg-elevated)'
                    }}
                  >
                    <span style={{ flex: 1 }}>📄 {file.split(/[\\/]/).pop()}</span>
                    {currentFiles.length > 1 && (
                      <Button
                        type="text"
                        size="small"
                        danger
                        onClick={() => onDeleteFile(file)}
                        style={{ marginLeft: '8px' }}
                      >
                        ✕
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <Divider style={{ margin: '8px 0' }}>{t('filters')}</Divider>
          
          {/* Time Range with DatePicker */}
          <div>
            <DateTimeRangePicker
              startDate={startDate}
              endDate={endDate}
              onStartChange={setStartDate}
              onEndChange={setEndDate}
            />
          </div>

          {/* Keywords (Filter) */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              {t('keywords')}:
            </label>
            <Input 
              value={filters.keywords}
              onChange={(e) => updateFilter('keywords', e.target.value)}
              placeholder={t('keywordsPlaceholder')} 
            />
          </div>

          {/* Highlights (Visual Only) */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              {t('highlights')}:
            </label>
            <Input 
              value={filters.highlights}
              onChange={(e) => updateFilter('highlights', e.target.value)}
              placeholder={t('highlightsPlaceholder')} 
            />
          </div>

          {/* Log Level */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              {t('logLevel')}:
            </label>
            <Select 
              value={filters.level}
              onChange={(value) => updateFilter('level', value)}
              style={{ width: '100%' }}
              options={[
                { value: 'ALL', label: t('allLevels') },
                { value: 'V', label: t('verbose') },
                { value: 'D', label: t('debug') },
                { value: 'I', label: t('info') },
                { value: 'W', label: t('warning') },
                { value: 'E', label: t('error') },
                { value: 'F', label: t('fatal') },
              ]}
            />
          </div>

          {/* Tag Filter */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              {t('tagFilterRegex')}
            </label>
            <Input 
              value={filters.tag}
              onChange={(e) => updateFilter('tag', e.target.value)}
              placeholder={t('tagPlaceholder')} 
            />
          </div>

          {/* PID */}
          <div>
            <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
              {t('pid')}:
            </label>
            <Input 
              value={filters.pid}
              onChange={(e) => updateFilter('pid', e.target.value)}
              placeholder={t('pidPlaceholder')} 
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
              {isSearching ? t('searching') : t('search')}
            </Button>
            <Button 
              icon={<ClearOutlined />}
              onClick={onClearFilters}
              disabled={isSearching}
            >
              {t('clearFilters')}
            </Button>
          </Space.Compact>
          
          {/* Apply Preset */}
          {presets.length > 0 && (
            <>
              <Divider style={{ margin: '8px 0' }}>{t('applyPreset')}</Divider>
              <div>
                <label style={{ fontSize: '12px', color: 'var(--ant-color-text-secondary)', marginBottom: '4px', display: 'block' }}>
                  {t('selectPreset')}:
                </label>
                <Select
                  style={{ width: '100%' }}
                  placeholder={t('selectPresetToApply')}
                  onChange={(value) => {
                    const preset = presets.find(p => p.id === value);
                    if (preset) {
                      onLoadPreset(preset);
                    }
                  }}
                  options={presets.map(preset => ({
                    value: preset.id,
                    label: preset.name
                  }))}
                  allowClear
                />
              </div>
            </>
          )}

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

      {/* Floating AI Analysis Panel */}
      <FloatButton
        icon={<RobotOutlined />}
        type="primary"
        style={{ 
          right: 24, 
          bottom: 24,
          width: 56,
          height: 56,
          backgroundColor: '#c586c0'
        }}
        onClick={() => setAiPanelOpen(!aiPanelOpen)}
        tooltip={t('aiAnalysisTooltip')}
      />

      {aiPanelOpen && (
        <div
          role="dialog"
          aria-label={t('aiAnalysisPanel')}
          aria-modal="true"
          style={{
            position: 'fixed',
            right: 24,
            bottom: 100,
            width: 400,
            maxHeight: 500,
            backgroundColor: 'var(--ant-color-bg-container)',
            border: '1px solid var(--ant-color-border)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            padding: '16px',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px'
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, color: 'var(--ant-color-primary)' }}>{t('aiAnalysis')}</h3>
            <Button 
              type="text" 
              size="small" 
              onClick={() => setAiPanelOpen(false)}
              aria-label={t('closeAiPanel')}
            >
              ✕
            </Button>
          </div>
          
          <Input.TextArea 
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            placeholder={t('aiPromptOptional')} 
            rows={4} 
            style={{ resize: 'vertical' }}
          />
          
          <Button 
            type="primary"
            icon={<RobotOutlined />}
            onClick={() => {
              onAnalyzeWithAI(aiPrompt);
              setAiPanelOpen(false);
            }}
            disabled={!aiConfigured}
            block
            size="large"
            style={{
              backgroundColor: '#c586c0',
              borderColor: '#c586c0'
            }}
          >
            {t('analyzeWithAI')}
          </Button>

          {!aiConfigured && (
            <Alert 
              message={t('aiRequiresKey')}
              type="warning"
              showIcon
              style={{ fontSize: '12px' }}
            />
          )}
        </div>
      )}
    </>
  );
};

export default ControlPanel;
