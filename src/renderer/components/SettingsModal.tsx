import { Button, Form, Input, message, Modal } from 'antd';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface AIConfig {
  apiEndpoint: string;
  apiKey: string;
  model: string;
}

interface SettingsModalProps {
  visible: boolean;
  onClose: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ visible, onClose }) => {
  const { t } = useTranslation();
  const [form] = Form.useForm();
  const [config, setConfig] = useState<AIConfig>({
    apiEndpoint: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-3.5-turbo'
  });

  // Load settings from localStorage on mount
  useEffect(() => {
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
  }, [form]);

  const handleSave = () => {
    form.validateFields().then((values) => {
      const newConfig: AIConfig = {
        apiEndpoint: values.apiEndpoint || 'https://api.openai.com/v1',
        apiKey: values.apiKey || '',
        model: values.model || 'gpt-3.5-turbo'
      };
      
      setConfig(newConfig);
      localStorage.setItem('aiConfig', JSON.stringify(newConfig));
      message.success(t('aiSettingsSaved'));
      onClose();
    });
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
        <Button key="save" type="primary" onClick={handleSave}>
          {t('saveSettings')}
        </Button>
      ]}
      width={600}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={config}
      >
        <Form.Item
          label={t('apiEndpoint')}
          name="apiEndpoint"
          rules={[{ required: true, message: 'Please enter API endpoint' }]}
        >
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>

        <Form.Item
          label={t('apiKey')}
          name="apiKey"
          rules={[{ required: true, message: 'Please enter API key' }]}
        >
          <Input.Password placeholder="sk-..." />
        </Form.Item>

        <Form.Item
          label={t('model')}
          name="model"
          rules={[{ required: true, message: 'Please enter model name' }]}
        >
          <Input placeholder="gpt-3.5-turbo" />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default SettingsModal;
