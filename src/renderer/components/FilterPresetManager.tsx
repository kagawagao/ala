import React, { useState, useEffect } from 'react';
import { Modal, List, Button, Input, Space, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined, CheckOutlined } from '@ant-design/icons';
import { LogFilters } from '../types';

interface FilterPreset {
  id: string;
  name: string;
  description: string;
  filters: LogFilters;
  createdAt: string;
}

interface FilterPresetManagerProps {
  visible: boolean;
  onClose: () => void;
  currentFilters: LogFilters;
  onLoadPreset: (filters: LogFilters) => void;
}

const FilterPresetManager: React.FC<FilterPresetManagerProps> = ({
  visible,
  onClose,
  currentFilters,
  onLoadPreset,
}) => {
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState<string>('');
  const [newDescription, setNewDescription] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState<boolean>(false);

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
      message.warning('Please enter a preset name');
      return;
    }

    const newPreset: FilterPreset = {
      id: `preset_${Date.now()}`,
      name: newName.trim(),
      description: newDescription.trim(),
      filters: currentFilters,
      createdAt: new Date().toISOString(),
    };

    savePresets([...presets, newPreset]);
    setNewName('');
    setNewDescription('');
    setShowAddForm(false);
    message.success('Preset saved successfully');
  };

  const handleDelete = (id: string) => {
    const updated = presets.filter((p) => p.id !== id);
    savePresets(updated);
    message.success('Preset deleted');
  };

  const handleLoad = (preset: FilterPreset) => {
    onLoadPreset(preset.filters);
    message.success(`Loaded preset: ${preset.name}`);
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
      title="Filter Preset Manager"
      open={visible}
      onCancel={onClose}
      footer={null}
      width={700}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="large">
        {/* Add New Preset */}
        {showAddForm ? (
          <div className="bg-dark-panel p-4 rounded border border-dark-border">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Input
                placeholder="Preset Name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onPressEnter={handleSaveNew}
              />
              <Input.TextArea
                placeholder="Description (optional)"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                rows={2}
              />
              <Space>
                <Button type="primary" icon={<CheckOutlined />} onClick={handleSaveNew}>
                  Save
                </Button>
                <Button onClick={() => {
                  setShowAddForm(false);
                  setNewName('');
                  setNewDescription('');
                }}>
                  Cancel
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
            Save Current Filters as New Preset
          </Button>
        )}

        {/* Preset List */}
        <List
          dataSource={presets}
          locale={{ emptyText: 'No saved presets. Create one by clicking the button above.' }}
          renderItem={(preset) => (
            <List.Item
              actions={[
                <Button
                  type="link"
                  size="small"
                  onClick={() => handleLoad(preset)}
                >
                  Load
                </Button>,
                <Popconfirm
                  title="Delete this preset?"
                  onConfirm={() => handleDelete(preset.id)}
                  okText="Yes"
                  cancelText="No"
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
              <List.Item.Meta
                title={preset.name}
                description={
                  <Space direction="vertical" size="small">
                    {preset.description && <div className="text-gray-600">{preset.description}</div>}
                    <div>
                      {getFilterSummary(preset.filters).map((item, idx) => (
                        <Tag key={idx} color="blue" style={{ marginBottom: 4 }}>
                          {item}
                        </Tag>
                      ))}
                    </div>
                    <div className="text-xs text-gray-400">
                      Created: {new Date(preset.createdAt).toLocaleString()}
                    </div>
                  </Space>
                }
              />
            </List.Item>
          )}
        />
      </Space>
    </Modal>
  );
};

export default FilterPresetManager;
