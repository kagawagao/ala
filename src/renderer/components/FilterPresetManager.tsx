import React, { useState, useEffect } from 'react';
import { Modal, List, Button, Input, Space, Popconfirm, Tag, message, Checkbox, Tooltip } from 'antd';
import { PlusOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons';
import { LogFilters } from '../types';
import { useTranslation } from 'react-i18next';

export interface FilterPreset {
  id: string;
  name: string;
  description: string;
  filters: LogFilters;
  keywordDescriptions?: { keyword: string; description: string }[]; // Multiple keywords with descriptions
  tagDescription?: string; // Single tag description
  createdAt: string;
}

interface FilterPresetManagerProps {
  visible: boolean;
  onClose: () => void;
  currentFilters: LogFilters;
  onLoadPreset: (preset: FilterPreset) => void;
  onApplyMultiplePresets: (presets: FilterPreset[]) => void;
}

const FilterPresetManager: React.FC<FilterPresetManagerProps> = ({
  visible,
  onClose,
  currentFilters,
  onLoadPreset,
  onApplyMultiplePresets,
}) => {
  const { t } = useTranslation();
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [newName, setNewName] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState<boolean>(false);
  const [selectedPresetIds, setSelectedPresetIds] = useState<string[]>([]);
  const [keywordDescriptions, setKeywordDescriptions] = useState<{ keyword: string; description: string }[]>([]);
  const [tagDescription, setTagDescription] = useState<string>('');

  useEffect(() => {
    loadPresets();
  }, []);

  const loadPresets = () => {
    const saved = localStorage.getItem('ala_filter_presets');
    if (saved) {
      try {
        setPresets(JSON.parse(saved));
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

    const newPreset: FilterPreset = {
      id: `preset_${Date.now()}`,
      name: newName.trim(),
      description: newDescription.trim(),
      filters: currentFilters,
      keywordDescriptions: keywordDescriptions.length > 0 ? keywordDescriptions : undefined,
      tagDescription: tagDescription.trim() || undefined,
      createdAt: new Date().toISOString(),
    };

    savePresets([...presets, newPreset]);
    setNewName('');
    setNewDescription('');
    setKeywordDescriptions([]);
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

  const getFilterSummary = (filters: LogFilters): string[] => {
    const summary: string[] = [];
    if (filters.keywords) summary.push(`Keywords: ${filters.keywords}`);
    if (filters.level && filters.level !== 'ALL') summary.push(`Level: ${filters.level}`);
    if (filters.tag) summary.push(`Tag: ${filters.tag}`);
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
                onPressEnter={handleSaveNew}
              />
              <Input.TextArea
                placeholder={t('presetDescription')}
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
              />
              {/* Keyword descriptions */}
              {currentFilters.keywords && (
                <div>
                  <div style={{ marginBottom: '8px', fontWeight: 500 }}>{t('keywordDescriptions')}</div>
                  {currentFilters.keywords.split('|').map((keyword, idx) => {
                    const kw = keyword.trim();
                    if (!kw) return null;
                    const existingDesc = keywordDescriptions.find(kd => kd.keyword === kw);
                    return (
                      <Input
                        key={idx}
                        placeholder={`${t('descriptionFor')} "${kw}"`}
                        value={existingDesc?.description || ''}
                        onChange={(e) => {
                          const newDescs = keywordDescriptions.filter(kd => kd.keyword !== kw);
                          if (e.target.value.trim()) {
                            newDescs.push({ keyword: kw, description: e.target.value });
                          }
                          setKeywordDescriptions(newDescs);
                        }}
                        style={{ marginBottom: '4px' }}
                      />
                    );
                  })}
                </div>
              )}
              {/* Tag description */}
              {currentFilters.tag && (
                <div>
                  <div style={{ marginBottom: '8px', fontWeight: 500 }}>{t('tagDescription')}</div>
                  <Input
                    placeholder={`${t('descriptionFor')} tag "${currentFilters.tag}"`}
                    value={tagDescription}
                    onChange={(e) => setTagDescription(e.target.value)}
                  />
                </div>
              )}
              <Space>
                <Button type="primary" onClick={handleSaveNew}>
                  {t('save')}
                </Button>
                <Button onClick={() => {
                  setShowAddForm(false);
                  setNewName('');
                  setNewDescription('');
                  setKeywordDescriptions([]);
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
            {t('saveCurrentAsPreset')}
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
                        {getFilterSummary(preset.filters).map((item, idx) => (
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
