import React, { useState, useEffect, useCallback } from 'react'
import {
  Button,
  Card,
  Checkbox,
  Typography,
  Space,
  Tag,
  Divider,
  Form,
  Input,
  Modal,
  App,
  Popconfirm,
  Tooltip,
  Empty,
  Row,
  Col,
  Slider,
  Select,
  InputNumber,
  Spin,
} from 'antd'
import {
  ArrowLeftOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
  CheckOutlined,
  KeyOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { updateConfig } from '../api/config'
import { listModels, createModel, updateModel, deleteModel } from '../api/models'
import {
  groupByProvider,
  loadModelConfigs,
  saveModelConfig,
  deleteModelConfig,
  getActiveModelIds,
  toggleActiveModel,
  buildAIConfig,
  migrateFromLegacyConfig,
} from '../utils/models'
import type { ModelPreset, ModelConfig } from '../types'

const { Title, Text } = Typography

interface CustomModelForm {
  name: string
  provider: string
  model_id: string
  api_endpoint: string
  anthropic_compatible: 'auto' | 'anthropic' | 'openai'
}

interface ConfigForm {
  api_key: string
  temperature: number
  thinking_mode: 'off' | 'auto' | 'on'
  thinking_budget_tokens: number
}

/** Map the form's three-way select to the ModelPreset's boolean-or-undefined field. */
function formCompatToPreset(val: 'auto' | 'anthropic' | 'openai'): boolean | undefined {
  if (val === 'anthropic') return true
  if (val === 'openai') return false
  return undefined
}

function presetCompatToForm(v: boolean | undefined): 'auto' | 'anthropic' | 'openai' {
  if (v === true) return 'anthropic'
  if (v === false) return 'openai'
  return 'auto'
}

const CopyableText: React.FC<{ value: string }> = ({ value }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    void navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <Space size={4}>
      <Text code style={{ fontSize: 11, wordBreak: 'break-all' }}>
        {value}
      </Text>
      <Tooltip title={copied ? t('copied') : t('copy')}>
        <Button
          type="text"
          size="small"
          icon={
            copied ? (
              <CheckOutlined style={{ color: 'var(--ant-color-success)' }} />
            ) : (
              <CopyOutlined />
            )
          }
          onClick={handleCopy}
          style={{ fontSize: 11, padding: '0 2px' }}
        />
      </Tooltip>
    </Space>
  )
}

const ModelManager: React.FC<{ onModelsChange?: (models: ModelPreset[]) => void }> = ({
  onModelsChange,
}) => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const navigate = useNavigate()

  const [models, setModels] = useState<ModelPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [modelConfigs, setModelConfigs] =
    useState<Record<string, Partial<ModelConfig>>>(loadModelConfigs)
  const [activeModelIds, setActiveModelIds] = useState<string[]>(getActiveModelIds)

  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ModelPreset | null>(null)
  const [configTarget, setConfigTarget] = useState<ModelPreset | null>(null)
  const [addForm] = Form.useForm<CustomModelForm>()
  const [editForm] = Form.useForm<CustomModelForm>()
  const [configForm] = Form.useForm<ConfigForm>()

  const fetchModels = useCallback(async () => {
    try {
      setLoading(true)
      const fetched = await listModels()
      setModels(fetched)
      // Migrate legacy global aiConfig → per-model configs
      migrateFromLegacyConfig(fetched)
      // Refresh modelConfigs state so the UI reflects any migrated API keys
      setModelConfigs(loadModelConfigs())
      setActiveModelIds(getActiveModelIds())
    } catch {
      void message.error(t('failedToLoadModels'))
    } finally {
      setLoading(false)
    }
  }, [message, t])

  useEffect(() => {
    void fetchModels()
  }, [fetchModels])

  // Propagate model list changes (add, edit, delete, copy) to the parent component
  // so App.tsx keeps its allModels state in sync without requiring navigation.
  useEffect(() => {
    if (models.length > 0) {
      onModelsChange?.(models)
    }
  }, [models, onModelsChange])

  const handleToggleActive = (preset: ModelPreset) => {
    const updated = toggleActiveModel(preset.id)
    setActiveModelIds(updated)
    const cfg = modelConfigs[preset.id]
    if (cfg?.api_key) {
      const aiCfg = buildAIConfig(preset, cfg)
      updateConfig(aiCfg).catch(() => {
        /* backend may not be running */
      })
      localStorage.setItem('aiConfig', JSON.stringify(aiCfg))
    }
    if (updated.includes(preset.id)) {
      void message.success(t('modelActivated'))
    }
  }

  const openConfigure = (preset: ModelPreset) => {
    setConfigTarget(preset)
    const cfg = modelConfigs[preset.id] ?? {}
    configForm.setFieldsValue({
      api_key: cfg.api_key ?? '',
      temperature: cfg.temperature ?? 0.7,
      thinking_mode: cfg.thinking_mode ?? 'off',
      thinking_budget_tokens: cfg.thinking_budget_tokens ?? 8000,
    })
  }

  const handleSaveConfig = () => {
    if (!configTarget) return
    configForm
      .validateFields()
      .then((values) => {
        const cfg: Partial<ModelConfig> = {
          api_key: values.api_key.trim(),
          temperature: values.temperature,
          thinking_mode: values.thinking_mode,
          thinking_budget_tokens: values.thinking_budget_tokens,
        }
        saveModelConfig(configTarget.id, cfg)
        const updated = loadModelConfigs()
        setModelConfigs(updated)
        if (activeModelIds.includes(configTarget.id) && cfg.api_key) {
          const aiCfg = buildAIConfig(configTarget, cfg)
          updateConfig(aiCfg).catch(() => {
            /* backend may not be running */
          })
          localStorage.setItem('aiConfig', JSON.stringify(aiCfg))
        }
        setConfigTarget(null)
        void message.success(t('modelConfigSaved'))
      })
      .catch(() => {
        /* validation error */
      })
  }

  const handleAdd = () => {
    addForm
      .validateFields()
      .then(async (values) => {
        try {
          const preset = await createModel({
            name: values.name.trim(),
            provider: values.provider?.trim() || 'Custom',
            model_id: values.model_id.trim(),
            api_endpoint: values.api_endpoint.trim(),
            anthropic_compatible: formCompatToPreset(values.anthropic_compatible) ?? null,
          })
          setModels((prev) => [...prev, preset])
          addForm.resetFields()
          setAddOpen(false)
          void message.success(t('customModelAdded'))
        } catch {
          void message.error(t('failedToSaveModel'))
        }
      })
      .catch(() => {
        /* validation error */
      })
  }

  const handleEdit = () => {
    if (!editTarget) return
    editForm
      .validateFields()
      .then(async (values) => {
        try {
          const updated = await updateModel(editTarget.id, {
            name: values.name.trim(),
            provider: values.provider?.trim() || 'Custom',
            model_id: values.model_id.trim(),
            api_endpoint: values.api_endpoint.trim(),
            anthropic_compatible: formCompatToPreset(values.anthropic_compatible),
          })
          setModels((prev) => prev.map((m) => (m.id === editTarget.id ? updated : m)))
          setEditTarget(null)
          void message.success(t('modelUpdated'))
        } catch {
          void message.error(t('failedToSaveModel'))
        }
      })
      .catch(() => {
        /* validation error */
      })
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteModel(id)
      setModels((prev) => prev.filter((m) => m.id !== id))
      deleteModelConfig(id)
      setModelConfigs(loadModelConfigs())
      if (activeModelIds.includes(id)) {
        const ids = toggleActiveModel(id)
        setActiveModelIds(ids)
      }
      void message.success(t('customModelDeleted'))
    } catch {
      void message.error(t('failedToDeleteModel'))
    }
  }

  const handleCopy = async (model: ModelPreset) => {
    const sourceConfig = modelConfigs[model.id] ?? {}
    try {
      const newPreset = await createModel({
        name: `${model.name} (Copy)`,
        provider: model.provider,
        model_id: model.model_id,
        api_endpoint: model.api_endpoint,
        description: model.description,
        anthropic_compatible: model.anthropic_compatible ?? null,
        supports_thinking: model.supports_thinking,
      })
      setModels((prev) => [...prev, newPreset])
      if (sourceConfig.api_key) {
        saveModelConfig(newPreset.id, sourceConfig)
        setModelConfigs(loadModelConfigs())
      }
      void message.success(t('modelCopied'))
    } catch {
      void message.error(t('failedToSaveModel'))
    }
  }

  const openEdit = (model: ModelPreset) => {
    setEditTarget(model)
    editForm.setFieldsValue({
      name: model.name,
      provider: model.provider,
      model_id: model.model_id,
      api_endpoint: model.api_endpoint,
      anthropic_compatible: presetCompatToForm(model.anthropic_compatible),
    })
  }

  const watchThinkingMode = Form.useWatch('thinking_mode', configForm)
  const showBudget = watchThinkingMode && watchThinkingMode !== 'off'

  const builtinModels = models.filter((m) => m.builtin)
  const customModels = models.filter((m) => !m.builtin)

  const renderCard = (m: ModelPreset, isCustom: boolean) => {
    const cfg = modelConfigs[m.id] ?? {}
    const isActive = activeModelIds.includes(m.id)
    const hasKey = !!cfg.api_key?.trim()
    return (
      <Col key={m.id} xs={24} sm={12} md={8}>
        <Card
          size="small"
          styles={{ body: { padding: '10px 12px' } }}
          style={{
            height: '100%',
            borderColor: isActive ? 'var(--ant-color-primary)' : undefined,
          }}
          extra={
            <Space size={4}>
              <Tooltip
                title={
                  isActive ? t('clickToDeactivate') || 'Click to deactivate' : t('setAsActive')
                }
              >
                <Checkbox checked={isActive} onChange={() => handleToggleActive(m)} />
              </Tooltip>
              <Tooltip title={t('configureModel')}>
                <Button
                  type="text"
                  size="small"
                  icon={<KeyOutlined />}
                  onClick={() => openConfigure(m)}
                />
              </Tooltip>
              <Tooltip title={t('copyModel')}>
                <Button
                  type="text"
                  size="small"
                  icon={<CopyOutlined />}
                  onClick={() => void handleCopy(m)}
                />
              </Tooltip>
              {isCustom && (
                <>
                  <Tooltip title={t('editCustomModel')}>
                    <Button
                      type="text"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => openEdit(m)}
                    />
                  </Tooltip>
                  <Popconfirm
                    title={t('deleteConfirm')}
                    onConfirm={() => void handleDelete(m.id)}
                    okType="danger"
                  >
                    <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </>
              )}
            </Space>
          }
        >
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Space size={4} wrap>
              <Text strong style={{ fontSize: 13 }}>
                {m.name}
              </Text>
              {m.anthropic_compatible === true && (
                <Tag color="blue" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                  Anthropic
                </Tag>
              )}
              {m.anthropic_compatible === false && (
                <Tag color="green" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                  OpenAI
                </Tag>
              )}
              {m.anthropic_compatible === undefined && isCustom && (
                <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                  {t('compatibilityAutoDetect')}
                </Tag>
              )}
              {m.provider && isCustom && (
                <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>{m.provider}</Tag>
              )}
              {m.supports_thinking && (
                <Tag color="purple" style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                  {t('supportsThinking')}
                </Tag>
              )}
            </Space>
            {m.description && (
              <Text type="secondary" style={{ fontSize: 11 }}>
                {m.description}
              </Text>
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 10 }}>
                Model ID
              </Text>
              <div>
                <CopyableText value={m.model_id} />
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {t('apiEndpoint')}
              </Text>
              <div>
                <CopyableText value={m.api_endpoint} />
              </div>
            </div>
            <div style={{ marginTop: 2 }}>
              <Tag
                color={hasKey ? 'success' : 'default'}
                style={{ fontSize: 10, lineHeight: '16px' }}
              >
                {hasKey ? t('apiKeyConfigured') : t('apiKeyNotConfigured')}
              </Tag>
            </div>
          </Space>
        </Card>
      </Col>
    )
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 24px 40px' }}>
      {/* Page header */}
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
          {t('backToAnalysis')}
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void fetchModels()}
          loading={loading}
          size="small"
        >
          {t('refresh')}
        </Button>
      </Space>

      <Title level={4} style={{ marginBottom: 4 }}>
        {t('modelManagement')}
      </Title>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 24 }}>
        {t('modelManagementDescription')}
      </Text>

      <Spin spinning={loading}>
        {/* ── Built-in models ─────────────────────────────────────── */}
        <Divider
          titlePlacement="left"
          orientationMargin={0}
          style={{ fontSize: 14, marginBottom: 16 }}
        >
          {t('builtinModels')}
        </Divider>

        {groupByProvider(builtinModels).map(([provider, providerModels]) => (
          <div key={provider} style={{ marginBottom: 20 }}>
            <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
              {provider}
            </Text>
            <Row gutter={[12, 12]}>{providerModels.map((m) => renderCard(m, false))}</Row>
          </div>
        ))}

        {/* ── Custom models ────────────────────────────────────────── */}
        <Divider
          titlePlacement="left"
          orientationMargin={0}
          style={{ fontSize: 14, margin: '24px 0 16px' }}
        >
          <Space>
            {t('customModels')}
            <Button
              size="small"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddOpen(true)}
            >
              {t('addCustomModel')}
            </Button>
          </Space>
        </Divider>

        {customModels.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <Text type="secondary" style={{ fontSize: 13 }}>
                {t('noCustomModels')}
              </Text>
            }
            style={{ margin: '16px 0' }}
          >
            <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              {t('addCustomModel')}
            </Button>
          </Empty>
        ) : (
          <Row gutter={[12, 12]}>{customModels.map((m) => renderCard(m, true))}</Row>
        )}
      </Spin>

      {/* ── Configure model modal (API key stored in localStorage) ── */}
      <Modal
        title={
          <Space>
            <KeyOutlined />
            {t('modelConfigTitle')}
            {configTarget ? `: ${configTarget.name}` : ''}
          </Space>
        }
        open={!!configTarget}
        onCancel={() => {
          configForm.resetFields()
          setConfigTarget(null)
        }}
        onOk={handleSaveConfig}
        okText={t('save')}
        cancelText={t('cancel')}
        width={460}
      >
        <Form form={configForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
          <Form.Item
            label={t('apiKey')}
            name="api_key"
            rules={[{ required: true, message: t('apiKeyRequired') }]}
            extra={
              <Text type="secondary" style={{ fontSize: 11 }}>
                {t('apiKeyStoredLocally')}
              </Text>
            }
          >
            <Input.Password placeholder="sk-ant-... / sk-... / your-api-key" />
          </Form.Item>
          <Form.Item label={t('temperature')} name="temperature" initialValue={0.7}>
            <Slider min={0} max={2} step={0.1} marks={{ 0: '0', 1: '1', 2: '2' }} />
          </Form.Item>
          {(configTarget?.supports_thinking || showBudget) && (
            <>
              <Form.Item label={t('thinkingMode')} name="thinking_mode" initialValue="off">
                <Select
                  options={[
                    { value: 'off', label: t('thinkingOff') },
                    { value: 'auto', label: t('thinkingAuto') },
                    { value: 'on', label: t('thinkingOn') },
                  ]}
                />
              </Form.Item>
              {showBudget && (
                <Form.Item
                  label={t('thinkingBudget')}
                  name="thinking_budget_tokens"
                  initialValue={8000}
                >
                  <InputNumber min={1024} max={32000} step={1024} style={{ width: '100%' }} />
                </Form.Item>
              )}
            </>
          )}
        </Form>
      </Modal>

      {/* ── Add custom model modal ───────────────────────────────── */}
      <Modal
        title={t('addCustomModel')}
        open={addOpen}
        onCancel={() => {
          addForm.resetFields()
          setAddOpen(false)
        }}
        onOk={() => void handleAdd()}
        okText={t('save')}
        cancelText={t('cancel')}
        width={440}
      >
        <Form form={addForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
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
          <Form.Item label={t('apiCompatibility')} name="anthropic_compatible" initialValue="auto">
            <Select
              options={[
                { value: 'auto', label: t('compatibilityAutoDetect') },
                { value: 'anthropic', label: t('compatibilityAnthropic') },
                { value: 'openai', label: t('compatibilityOpenAI') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Edit custom model modal ──────────────────────────────── */}
      <Modal
        title={t('editCustomModel')}
        open={!!editTarget}
        onCancel={() => {
          editForm.resetFields()
          setEditTarget(null)
        }}
        onOk={() => void handleEdit()}
        okText={t('save')}
        cancelText={t('cancel')}
        width={440}
      >
        <Form form={editForm} layout="vertical" size="middle" style={{ marginTop: 16 }}>
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
          >
            <Input placeholder="https://api.example.com" />
          </Form.Item>
          <Form.Item label={t('apiCompatibility')} name="anthropic_compatible" initialValue="auto">
            <Select
              options={[
                { value: 'auto', label: t('compatibilityAutoDetect') },
                { value: 'anthropic', label: t('compatibilityAnthropic') },
                { value: 'openai', label: t('compatibilityOpenAI') },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ModelManager
