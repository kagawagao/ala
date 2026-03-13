import { Button, Form, Input, message, Modal } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AIConfig } from '../types';
import { getAIConfig, saveAIConfig } from '../services/ai-service';

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

  // Load settings from localStorage on mount
  useEffect(() => {
    if (visible) {
      const savedConfig = getAIConfig();
      if (savedConfig) {
        setConfig(savedConfig);
        form.setFieldsValue(savedConfig);
      }
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

      // Save to localStorage
      setConfig(newConfig);
      saveAIConfig(newConfig);
      message.success(t('aiSettingsSaved'));

      // Notify parent component
      if (onConfigUpdated) {
        onConfigUpdated();
      }

      onClose();
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
