import React, { useState } from 'react'
import {
  Button,
  Card,
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
} from 'antd'
import {
  ArrowLeftOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
  CheckOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import {
  BUILTIN_MODELS,
  groupByProvider,
  loadCustomModels,
  saveCustomModels,
} from '../utils/models'
import type { ModelPreset } from '../types'

const { Title, Text } = Typography

interface CustomModelForm {
  name: string
  provider: string
  model_id: string
  api_endpoint: string
}

const CopyableText: React.FC<{ value: string }> = ({ value }) => {
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
      <Tooltip title={copied ? '✓' : 'Copy'}>
        <Button
          type="text"
          size="small"
          icon={copied ? <CheckOutlined style={{ color: 'var(--ant-color-success)' }} /> : <CopyOutlined />}
          onClick={handleCopy}
          style={{ fontSize: 11, padding: '0 2px' }}
        />
      </Tooltip>
    </Space>
  )
}

const ModelManager: React.FC = () => {
  const { t } = useTranslation()
  const { message } = App.useApp()
  const navigate = useNavigate()

  const [customModels, setCustomModels] = useState<ModelPreset[]>(loadCustomModels)
  const [addOpen, setAddOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<ModelPreset | null>(null)
  const [addForm] = Form.useForm<CustomModelForm>()
  const [editForm] = Form.useForm<CustomModelForm>()

  const handleAdd = () => {
    addForm
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
        addForm.resetFields()
        setAddOpen(false)
        void message.success(t('customModelAdded'))
      })
      .catch(() => {
        /* validation error */
      })
  }

  const handleEdit = () => {
    if (!editTarget) return
    editForm
      .validateFields()
      .then((values) => {
        const updated = customModels.map((m) =>
          m.id === editTarget.id
            ? {
                ...m,
                name: values.name.trim(),
                provider: values.provider?.trim() || 'Custom',
                model_id: values.model_id.trim(),
                api_endpoint: values.api_endpoint.trim(),
              }
            : m,
        )
        setCustomModels(updated)
        saveCustomModels(updated)
        setEditTarget(null)
        void message.success(t('modelUpdated'))
      })
      .catch(() => {
        /* validation error */
      })
  }

  const handleDelete = (id: string) => {
    const updated = customModels.filter((m) => m.id !== id)
    setCustomModels(updated)
    saveCustomModels(updated)
    void message.success(t('customModelDeleted'))
  }

  const openEdit = (model: ModelPreset) => {
    setEditTarget(model)
    editForm.setFieldsValue({
      name: model.name,
      provider: model.provider,
      model_id: model.model_id,
      api_endpoint: model.api_endpoint,
    })
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 24px 40px' }}>
      {/* Page header */}
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
          {t('backToAnalysis')}
        </Button>
      </Space>

      <Title level={4} style={{ marginBottom: 4 }}>
        {t('modelManagement')}
      </Title>
      <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 24 }}>
        {t('modelManagementDescription')}
      </Text>

      {/* ── Built-in models ─────────────────────────────────────── */}
      <Divider orientation="left" orientationMargin={0} style={{ fontSize: 14, marginBottom: 16 }}>
        {t('builtinModels')}
      </Divider>

      {groupByProvider(BUILTIN_MODELS).map(([provider, models]) => (
        <div key={provider} style={{ marginBottom: 20 }}>
          <Text strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>
            {provider}
          </Text>
          <Row gutter={[12, 12]}>
            {models.map((m) => (
              <Col key={m.id} xs={24} sm={12} md={8}>
                <Card
                  size="small"
                  styles={{ body: { padding: '10px 12px' } }}
                  style={{ height: '100%' }}
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
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      ))}

      {/* ── Custom models ────────────────────────────────────────── */}
      <Divider orientation="left" orientationMargin={0} style={{ fontSize: 14, margin: '24px 0 16px' }}>
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
        <Row gutter={[12, 12]}>
          {customModels.map((m) => (
            <Col key={m.id} xs={24} sm={12} md={8}>
              <Card
                size="small"
                styles={{ body: { padding: '10px 12px' } }}
                style={{ height: '100%' }}
                extra={
                  <Space size={4}>
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
                      onConfirm={() => handleDelete(m.id)}
                      okType="danger"
                    >
                      <Button type="text" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                }
              >
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space size={4} wrap>
                    <Text strong style={{ fontSize: 13 }}>
                      {m.name}
                    </Text>
                    {m.provider && (
                      <Tag style={{ margin: 0, fontSize: 10, lineHeight: '16px' }}>
                        {m.provider}
                      </Tag>
                    )}
                  </Space>
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
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* ── Add custom model modal ───────────────────────────────── */}
      <Modal
        title={t('addCustomModel')}
        open={addOpen}
        onCancel={() => {
          addForm.resetFields()
          setAddOpen(false)
        }}
        onOk={handleAdd}
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
        onOk={handleEdit}
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
        </Form>
      </Modal>
    </div>
  )
}

export default ModelManager
