import { Button, Form, Input, message, Modal } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AIConfig } from '../types';

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onConfigUpdated?: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onClose, onConfigUpdated }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [config, setConfig] = useState<AIConfig>({
    apiEndpoint: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-3.5-turbo',
  });

  // Load settings from both localStorage and backend on mount
  useEffect(() => {
    const loadConfig = async () => {
      // First try to get from backend
      const backendConfig = await window.electronAPI.getAIConfig();
      if (backendConfig) {
        setConfig(backendConfig);
        form.setFieldsValue(backendConfig);
      } else {
        // Fall back to localStorage
        const saved = localStorage.getItem('aiConfig');
        if (saved) {
          try {
            const parsed = JSON.parse(saved);
            setConfig(parsed);
            form.setFieldsValue(parsed);
          } catch (e) {
            console.error('Failed to parse AI config:', e);
          }
        }
      }
    };

    if (visible) {
      loadConfig();
    }
  }, [form, visible]);

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const newConfig: AIConfig = {
        apiEndpoint: values.apiEndpoint || 'https://api.openai.com/v1',
        apiKey: values.apiKey || '',
        model: values.model || 'gpt-3.5-turbo',
      };

      // Save to backend
      const success = await window.electronAPI.updateAIConfig(newConfig);

      if (success) {
        // Also save to localStorage for persistence
        setConfig(newConfig);
        localStorage.setItem('aiConfig', JSON.stringify(newConfig));
        message.success(t('aiSettingsSaved'));

        // Notify parent component to re-check AI configuration
        if (onConfigUpdated) {
          onConfigUpdated();
        }

        onClose();
      } else {
        message.error(t('aiSettingsUpdateFailed'));
      }
    } catch (error) {
      console.error('Failed to save AI config:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={t('aiSettings')}
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t('cancel')}
        </Button>,
        <Button key="save" type="primary" onClick={handleSave} loading={loading}>
          {t('saveSettings')}
        </Button>,
      ]}
      width={600}
    >
      <Form form={form} layout="vertical" initialValues={config}>
        <Form.Item
          label={t('apiEndpoint')}
          name="apiEndpoint"
          rules={[{ required: true, message: t('apiEndpointRequired') }]}
        >
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>

        <Form.Item
          label={t('apiKey')}
          name="apiKey"
          rules={[{ required: true, message: t('apiKeyRequired') }]}
        >
          <Input.Password placeholder="sk-..." />
        </Form.Item>

        <Form.Item
          label={t('model')}
          name="model"
          rules={[{ required: true, message: t('modelRequired') }]}
        >
          <Input placeholder="gpt-3.5-turbo" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SettingsModal;
