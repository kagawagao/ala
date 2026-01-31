import React, { useState, useEffect } from 'react';
import { Modal, List, Button, Input, Space, Popconfirm, Tag, message, Checkbox, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons';
import { LogFilters } from '../types';
import { useTranslation } from 'react-i18next';

// Constants
const KEYWORD_SEPARATOR = '|';

// Old preset structure for migration
interface OldFilterPreset {
  id: string;
  name: string;
  description: string;
  filters: LogFilters;
  keywordDescriptions?: { keyword: string; description: string }[];
  tagDescription?: string;
  createdAt: string;
}

// New preset structure
export interface FilterPreset {
  id: string;
  name: string;
  description: string;
  config: {
    tag?: {
      text: string;
      description: string;
    };
    keywords: Array<{
      text: string;
      description: string;
    }>;
  };
  createdAt: string;
}

interface FilterPresetManagerProps {
  visible: boolean;
  onClose: () => void;
  onLoadPreset: (preset: FilterPreset) => void;
  onApplyMultiplePresets: (presets: FilterPreset[]) => void;
}

const FilterPresetManager: React.FC<FilterPresetManagerProps> = ({
  visible,
  onClose,
  onLoadPreset,
  onApplyMultiplePresets,
}) => {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [newName, setNewName] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const [tagText, setTagText] = useState<string>('');
  const [tagDescription, setTagDescription] = useState<string>('');
  const [keywords, setKeywords] = useState<Array<{ text: string; description: string }>>([]);

  useEffect(() => {
    loadPresets();
  }, []);

  // Migration function to convert old presets to new format
  const migrateOldPreset = (oldPreset: OldFilterPreset): FilterPreset => {
    const keywords: Array<{ text: string; description: string }> = [];
    
    // Extract keywords from filters.keywords
    if (oldPreset.filters.keywords) {
      const keywordTexts = oldPreset.filters.keywords.split(KEYWORD_SEPARATOR).filter(k => k.trim());
      keywordTexts.forEach(kw => {
        const trimmedKw = kw.trim();
        const desc = oldPreset.keywordDescriptions?.find(kd => kd.keyword === trimmedKw);
        keywords.push({
          text: trimmedKw,
          description: desc?.description || ''
        });
      });
    }

    const newPreset: FilterPreset = {
      id: oldPreset.id,
      name: oldPreset.name,
      description: oldPreset.description,
      config: {
        keywords: keywords,
        ...(oldPreset.filters.tag ? {
          tag: {
            text: oldPreset.filters.tag,
            description: oldPreset.tagDescription || ''
          }
        } : {})
      },
      createdAt: oldPreset.createdAt
    };

    return newPreset;
  };

  const loadPresets = () => {
    const saved = localStorage.getItem('ala_filter_presets');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Check if presets need migration
        if (Array.isArray(parsed) && parsed.length > 0 && 'filters' in parsed[0]) {
          // Old format detected, migrate
          const migratedPresets = parsed.map((p: OldFilterPreset) => migrateOldPreset(p));
          setPresets(migratedPresets);
          // Save migrated presets
          localStorage.setItem('ala_filter_presets', JSON.stringify(migratedPresets));
          message.info(t('presetsMigrated'));
        } else if (Array.isArray(parsed)) {
          setPresets(parsed);
        } else {
          // Invalid format, reset
          setPresets([]);
          localStorage.removeItem('ala_filter_presets');
        }
      } catch (e) {
        console.error('Failed to load presets:', e);
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        message.error(`Failed to load presets: ${errorMsg}`);
      }
    }
  };

  const savePresets = (updatedPresets: FilterPreset[]) => {
    localStorage.setItem('ala_filter_presets', JSON.stringify(updatedPresets));
    setPresets(updatedPresets);
  };

  const handleSaveNew = () => {
    if (!newName.trim()) {
      message.warning(t('presetName'));
      return;
    }

    if (keywords.length === 0 && !tagText.trim()) {
      message.warning(t('atLeastOneKeywordOrTag'));
      return;
    }

    const newPreset: FilterPreset = {
      id: `preset_${Date.now()}`,
      name: newName.trim(),
      description: newDescription.trim(),
      config: {
        keywords: keywords.filter(k => k.text.trim()),
        ...(tagText.trim() ? {
          tag: {
            text: tagText.trim(),
            description: tagDescription.trim()
          }
        } : {})
      },
      createdAt: new Date().toISOString(),
    };

    savePresets([...presets, newPreset]);
    setNewName('');
    setNewDescription('');
    setKeywords([]);
    setTagText('');
    setTagDescription('');
    setShowAddForm(false);
    message.success(t('savePreset'));
  };

  const handleDelete = (id: string) => {
    const updated = presets.filter((p) => p.id !== id);
    savePresets(updated);
    message.success(t('delete'));
  };

  const handleLoad = (preset: FilterPreset) => {
    onLoadPreset(preset);
    message.success(`Loaded preset: ${preset.name}`);
    onClose();
  };

  const handleToggleSelection = (presetId: string) => {
    setSelectedPresetIds(prev => 
      prev.includes(presetId) 
        ? prev.filter(id => id !== presetId)
        : [...prev, presetId]
    );
  };

  const handleApplyMultiple = () => {
    if (selectedPresetIds.length === 0) {
      message.warning(t('noPresets'));
      return;
    }

    const selectedPresets = presets.filter(p => selectedPresetIds.includes(p.id));
    
    onApplyMultiplePresets(selectedPresets);
    message.success(t('applyPresets').replace('{count}', selectedPresetIds.length.toString()));
    setSelectedPresetIds([]);
    onClose();
  };

  const getFilterSummary = (preset: FilterPreset): string[] => {
    const summary: string[] = [];
    if (preset.config.keywords.length > 0) {
      const keywordTexts = preset.config.keywords.map(k => k.text).join(KEYWORD_SEPARATOR);
      summary.push(`Keywords: ${keywordTexts}`);
    }
    if (preset.config.tag) {
      summary.push(`Tag: ${preset.config.tag.text}`);
    }
    return summary;
  };

  return (
    <Modal
      title={t('filterPresetManager')}
      open={visible}
      onCancel={onClose}
      footer={
        selectedPresetIds.length > 0 ? (
          <Space>
            <Button onClick={() => setSelectedPresetIds([])}>
              {t('clearSelection')}
            </Button>
            <Button type="primary" icon={<CheckOutlined />} onClick={handleApplyMultiple}>
              {t('applyPresets').replace('{count}', selectedPresetIds.length.toString())}
            </Button>
          </Space>
        ) : null
      }
      width={700}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Add New Preset */}
        {showAddForm ? (
          <div style={{
            backgroundColor: 'var(--ant-color-bg-elevated)',
            padding: '16px',
            borderRadius: '4px',
            border: '1px solid var(--ant-color-border)'
          }}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                placeholder={t('presetName')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <Input.TextArea
                placeholder={t('presetDescription')}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
              />
              
              {/* Tag configuration */}
              <div>
                <div style={{ marginBottom: '8px', fontWeight: 500 }}>
                  {t('tagText')} {t('optional')}
                </div>
                <Input
                  placeholder={t('tagPlaceholder')}
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value)}
                  style={{ marginBottom: '4px' }}
                />
                {tagText && (
                  <Input
                    placeholder={t('tagDescription')}
                    value={tagDescription}
                    onChange={(e) => setTagDescription(e.target.value)}
                  />
                )}
              </div>

              {/* Keywords configuration */}
              <div>
                <div style={{ marginBottom: '8px', fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{t('keywordDescriptions')}</span>
                  <Button
                    type="dashed"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => setKeywords([...keywords, { text: '', description: '' }])}
                  >
                    {t('addKeyword')}
                  </Button>
                </div>
                {keywords.map((kw, idx) => (
                  <div key={idx} style={{ marginBottom: '8px', display: 'flex', gap: '4px', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <Input
                        placeholder={t('keywordText')}
                        value={kw.text}
                        onChange={(e) => {
                          const newKeywords = [...keywords];
                          newKeywords[idx].text = e.target.value;
                          setKeywords(newKeywords);
                        }}
                        style={{ flex: 1 }}
                      />
                      <Button
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={() => setKeywords(keywords.filter((_, i) => i !== idx))}
                        title={t('removeKeyword')}
                      />
                    </div>
                    <Input
                      placeholder={`${t('descriptionFor')} "${kw.text || t('keyword')}"`}
                      value={kw.description}
                      onChange={(e) => {
                        const newKeywords = [...keywords];
                        newKeywords[idx].description = e.target.value;
                        setKeywords(newKeywords);
                      }}
                    />
                  </div>
                ))}
              </div>

              <Space>
                <Button type="primary" onClick={handleSaveNew}>
                  {t('save')}
                </Button>
                <Button onClick={() => {
                  setShowAddForm(false);
                  setNewName('');
                  setNewDescription('');
                  setKeywords([]);
                  setTagText('');
                  setTagDescription('');
                }}>
                  {t('cancel')}
                </Button>
              </Space>
            </Space>
          </div>
        ) : (
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            onClick={() => setShowAddForm(true)}
            block
          >
            {t('createNewPreset')}
          </Button>
        )}

        {/* Preset List */}
        <List
          dataSource={presets}
          locale={{ emptyText: t('noPresetsAvailable') }}
          renderItem={(preset) => (
            <List.Item
              key={preset.id}
              actions={[
                <Button
                  key="load"
                  type="link"
                  size="small"
                  onClick={() => handleLoad(preset)}
                >
                  {t('load')}
                </Button>,
                <Popconfirm
                  key="delete"
                  title={t('deleteConfirm')}
                  onConfirm={() => handleDelete(preset.id)}
                  okText={t('yes')}
                  cancelText={t('no')}
                >
                  <Button
                    type="link"
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                  />
                </Popconfirm>,
              ]}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', width: '100%', gap: '12px' }}>
                <Checkbox
                  checked={selectedPresetIds.includes(preset.id)}
                  onChange={() => handleToggleSelection(preset.id)}
                  style={{ marginTop: '4px' }}
                />
                <List.Item.Meta
                  title={preset.name}
                  description={
                    <Space direction="vertical" size="small">
                      {preset.description && (
                        <div style={{ color: '#6b7280' }}>{preset.description}</div>
                      )}
                      <div>
                        {getFilterSummary(preset).map((item, idx) => (
                          <Tag key={idx} color="blue" style={{ marginBottom: 4 }}>
                            {item}
                          </Tag>
                        ))}
                      </div>
                      <div style={{ fontSize: '12px', color: '#9ca3af' }}>
                        Created: {new Date(preset.createdAt).toLocaleString()}
                      </div>
                    </Space>
                  }
                />
              </div>
            </List.Item>
          )}
        />
      </Space>
    </Modal>
  );
};

export default FilterPresetManager;
