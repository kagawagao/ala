import React, { useState, useEffect, useCallback } from 'react'
import {
  Modal,
  Form,
  Input,
  Slider,
  Button,
  App,
  Typography,
  Tag,
  Divider,
  Select,
  InputNumber,
  Space,
  Collapse,
  Popconfirm,
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { getConfig, updateConfig } from '../api/config'
import type { AIConfig, ModelPreset } from '../types'

const { Text } = Typography

const MODELS_STORAGE_KEY = 'ala_models'

const BUILTIN_MODELS: ModelPreset[] = [
  {
    id: 'claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'Anthropic',
    model_id: 'claude-opus-4-20250514',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Most capable',
    builtin: true,
  },
  {
    id: 'claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'Anthropic',
    model_id: 'claude-sonnet-4-20250514',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Balanced',
    builtin: true,
  },
  {
    id: 'claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    provider: 'Anthropic',
    model_id: 'claude-3-5-sonnet-20241022',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Previous generation',
    builtin: true,
  },
  {
    id: 'claude-haiku-3-5',
    name: 'Claude Haiku 3.5',
    provider: 'Anthropic',
    model_id: 'claude-haiku-3-5-20241022',
    api_endpoint: 'https://api.anthropic.com',
    description: 'Fast & efficient',
    builtin: true,
  },
  {
    id: 'gpt-4o',
    name: 'GPT-4o',
    provider: 'OpenAI',
    model_id: 'gpt-4o',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Multimodal flagship',
    builtin: true,
  },
  {
    id: 'gpt-4.1',
    name: 'GPT-4.1',
    provider: 'OpenAI',
    model_id: 'gpt-4.1',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Latest GPT-4.1',
    builtin: true,
  },
  {
    id: 'o4-mini',
    name: 'o4-mini',
    provider: 'OpenAI',
    model_id: 'o4-mini',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Reasoning, efficient',
    builtin: true,
  },
  {
    id: 'gpt-4o-mini',
    name: 'GPT-4o mini',
    provider: 'OpenAI',
    model_id: 'gpt-4o-mini',
    api_endpoint: 'https://api.openai.com/v1',
    description: 'Fast & cheap',
    builtin: true,
  },
]

function loadCustomModels(): ModelPreset[] {
  try {
    return JSON.parse(localStorage.getItem(MODELS_STORAGE_KEY) || '[]') as ModelPreset[]
  } catch {
    return []
  }
}

function saveCustomModels(models: ModelPreset[]): void {
  localStorage.setItem(MODELS_STORAGE_KEY, JSON.stringify(models))
}

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  onConfigSaved: () => void
  backendConnected: boolean
}

interface AddModelForm {
  name: string
  provider: string
  model_id: string
  api_endpoint: string
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  onConfigSaved,
  backendConnected,
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const [form] = Form.useForm<AIConfig>()
  const [addModelForm] = Form.useForm<AddModelForm>()
  const [saving, setSaving] = useState(false)
  const [customModels, setCustomModels] = useState<ModelPreset[]>(loadCustomModels)
  const [addModelOpen, setAddModelOpen] = useState(false)

  useEffect(() => {
    if (open && backendConnected) {
      getConfig()
        .then((cfg) => form.setFieldsValue(cfg))
        .catch(() => {
          const saved = localStorage.getItem('aiConfig')
          if (saved) {
            try {
              form.setFieldsValue(JSON.parse(saved) as AIConfig)
            } catch {
              /* ignore */
            }
          }
        })
    }
  }, [open, backendConnected, form])

  const handleSave = async () => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      localStorage.setItem('aiConfig', JSON.stringify(values))
      if (backendConnected) {
        await updateConfig(values)
      }
      void message.success(t('aiSettingsSaved'))
      onConfigSaved()
      onClose()
    } catch (err: unknown) {
      if (err instanceof Error) {
        void message.error(err.message)
      }
    } finally {
      setSaving(false)
    }
  }

  const applyModelPreset = useCallback(
    (preset: ModelPreset) => {
      form.setFieldsValue({
        model: preset.model_id,
        api_endpoint: preset.api_endpoint,
      })
    },
    [form],
  )

  const handleAddModel = () => {
    addModelForm
      .validateFields()
      .then((values) => {
        const preset: ModelPreset = {
          id: `custom-${Date.now()}`,
          name: values.name.trim(),
          provider: values.provider?.trim() || 'Custom',
          model_id: values.model_id.trim(),
          api_endpoint: values.api_endpoint.trim(),
        }
        const updated = [...customModels, preset]
        setCustomModels(updated)
        saveCustomModels(updated)
        addModelForm.resetFields()
        setAddModelOpen(false)
        void message.success(t('customModelAdded'))
      })
      .catch(() => {
        /* validation error */
      })
  }

  const handleDeleteCustomModel = (id: string) => {
    const updated = customModels.filter((m) => m.id !== id)
    setCustomModels(updated)
    saveCustomModels(updated)
    void message.success(t('customModelDeleted'))
  }

  const modelLibraryItems = [
    {
      key: 'modelLibrary',
      label: (
        <Text strong style={{ fontSize: 12 }}>
          {t('modelLibrary')}
        </Text>
      ),
      children: (
        <div>
          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
            {t('modelLibraryHint')}
          </Text>

          <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 4 }}>
            {t('builtinModels')}
          </Text>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {BUILTIN_MODELS.map((m) => (
              <Button
                key={m.id}
                size="small"
                onClick={() => applyModelPreset(m)}
                style={{ fontSize: 11 }}
              >
                <span style={{ fontWeight: 500 }}>{m.name}</span>
                {m.description && (
                  <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>
                    · {m.description}
                  </Text>
                )}
              </Button>
            ))}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            <Text type="secondary" style={{ fontSize: 11 }}>
              {t('customModels')}
            </Text>
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setAddModelOpen(true)}
              style={{ fontSize: 11 }}
            >
              {t('addCustomModel')}
            </Button>
          </div>
          {customModels.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 11 }}>
              —
            </Text>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {customModels.map((m) => (
                <Space key={m.id} size={2}>
                  <Button size="small" onClick={() => applyModelPreset(m)} style={{ fontSize: 11 }}>
                    <span style={{ fontWeight: 500 }}>{m.name}</span>
                    {m.provider && (
                      <Text type="secondary" style={{ fontSize: 10, marginLeft: 4 }}>
                        · {m.provider}
                      </Text>
                    )}
                  </Button>
                  <Popconfirm
                    title={t('deleteConfirm')}
                    onConfirm={() => handleDeleteCustomModel(m.id)}
                    okType="danger"
                  >
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      style={{ fontSize: 11, padding: '0 4px' }}
                    />
                  </Popconfirm>
                </Space>
              ))}
            </div>
          )}
        </div>
      ),
    },
  ]

  return (
    <>
      <Modal
        title={t('settings')}
        open={open}
        onCancel={onClose}
        footer={[
          <Button key="cancel" onClick={onClose}>
            {t('cancel')}
          </Button>,
          <Button
            key="save"
            type="primary"
            loading={saving}
            onClick={() => {
              void handleSave()
            }}
          >
            {t('save')}
          </Button>,
        ]}
        width={560}
        styles={{ body: { maxHeight: '75vh', overflowY: 'auto' } }}
      >
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {t('backend')}:{' '}
          </Text>
          <Tag color={backendConnected ? 'success' : 'error'}>
            {backendConnected ? t('connected') : t('disconnected')}
          </Tag>
          {!backendConnected && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 4 }}>
              {t('backendNotConnected')}
            </Text>
          )}
        </div>

        <Divider titlePlacement="left" style={{ fontSize: 13 }}>
          {t('aiSettings')}
        </Divider>

        <Form form={form} layout="vertical" size="middle">
          <Form.Item
            label={t('apiEndpoint')}
            name="api_endpoint"
            rules={[{ required: true, message: t('apiEndpointRequired') }]}
            initialValue="https://api.anthropic.com"
          >
            <Input placeholder="https://api.anthropic.com" />
          </Form.Item>
          <Form.Item
            label={t('apiKey')}
            name="api_key"
            rules={[{ required: true, message: t('apiKeyRequired') }]}
          >
            <Input.Password placeholder="sk-ant-..." />
          </Form.Item>
          <Form.Item
            label={t('model')}
            name="model"
            rules={[{ required: true, message: t('modelRequired') }]}
            initialValue="claude-sonnet-4-20250514"
          >
            <Input placeholder="claude-sonnet-4-20250514" />
          </Form.Item>
          <Form.Item label={t('temperature')} name="temperature" initialValue={0.7}>
            <Slider min={0} max={2} step={0.1} marks={{ 0: '0', 1: '1', 2: '2' }} />
          </Form.Item>

          <Divider titlePlacement="left" style={{ fontSize: 12, margin: '12px 0' }}>
            {t('thinkingMode')}
          </Divider>

          <Form.Item label={t('thinkingMode')} name="thinking_mode" initialValue="off">
            <Select
              options={[
                { value: 'off', label: t('thinkingOff') },
                { value: 'auto', label: t('thinkingAuto') },
                { value: 'on', label: t('thinkingOn') },
              ]}
            />
          </Form.Item>
          <Form.Item label={t('thinkingBudget')} name="thinking_budget_tokens" initialValue={8000}>
            <InputNumber min={1024} max={32000} step={1024} style={{ width: '100%' }} />
          </Form.Item>
        </Form>

        <Collapse
          ghost
          size="small"
          items={modelLibraryItems}
          style={{ marginTop: 4 }}
        />
      </Modal>

      <Modal
        title={t('addCustomModel')}
        open={addModelOpen}
        onCancel={() => {
          addModelForm.resetFields()
          setAddModelOpen(false)
        }}
        onOk={handleAddModel}
        okText={t('save')}
        cancelText={t('cancel')}
        width={440}
      >
        <Form form={addModelForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <Form.Item
            label={t('modelDisplayName')}
            name="name"
            rules={[{ required: true, message: t('modelDisplayNameRequired') }]}
          >
            <Input placeholder="My Custom Model" />
          </Form.Item>
          <Form.Item label={t('modelProvider')} name="provider">
            <Input placeholder="Custom" />
          </Form.Item>
          <Form.Item
            label={t('model')}
            name="model_id"
            rules={[{ required: true, message: t('modelIdRequired') }]}
          >
            <Input placeholder="model-name-version" />
          </Form.Item>
          <Form.Item
            label={t('apiEndpoint')}
            name="api_endpoint"
            rules={[{ required: true, message: t('modelEndpointRequired') }]}
            initialValue="https://api.anthropic.com"
          >
            <Input placeholder="https://api.example.com" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  )
}

export default SettingsModal
