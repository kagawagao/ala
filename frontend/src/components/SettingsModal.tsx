import React, { useState, useEffect } from 'react'
import {
  Modal,
  Form,
  Input,
  Slider,
  Button,
  message,
  Typography,
  Tag,
  Divider,
  Space,
  List,
  Popconfirm,
} from 'antd'
import { DeleteOutlined, PlusOutlined, FolderOpenOutlined, CodeOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { getConfig, updateConfig } from '../api/config'
import { listProjects, createProject, deleteProject } from '../api/projects'
import type { AIConfig, Project } from '../types'

const { Text } = Typography

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  onConfigSaved: () => void
  backendConnected: boolean
}

const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  onClose,
  onConfigSaved,
  backendConnected,
}) => {
  const { t } = useTranslation()
  const [form] = Form.useForm<AIConfig>()
  const [projectForm] = Form.useForm<{ name: string; path: string }>()
  const [saving, setSaving] = useState(false)
  const [projects, setProjects] = useState<Project[]>([])
  const [addingProject, setAddingProject] = useState(false)

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
      listProjects()
        .then(setProjects)
        .catch(() => {
          /* ignore */
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

  const handleAddProject = async () => {
    try {
      const values = await projectForm.validateFields()
      const project = await createProject(values)
      setProjects((prev) => [...prev, project])
      projectForm.resetFields()
      setAddingProject(false)
      void message.success(t('projectAdded'))
    } catch (err: unknown) {
      if (err instanceof Error) {
        void message.error(err.message)
      }
    }
  }

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
    } catch (err: unknown) {
      if (err instanceof Error) {
        void message.error(err.message)
      }
    }
  }

  return (
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
      width={520}
    >
      <div style={{ marginBottom: 12 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Backend:{' '}
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
          rules={[{ required: true, message: 'Please enter API endpoint' }]}
          initialValue="https://api.openai.com/v1"
        >
          <Input placeholder="https://api.openai.com/v1" />
        </Form.Item>
        <Form.Item
          label={t('apiKey')}
          name="api_key"
          rules={[{ required: true, message: 'Please enter API key' }]}
        >
          <Input.Password placeholder="sk-..." />
        </Form.Item>
        <Form.Item
          label={t('model')}
          name="model"
          rules={[{ required: true, message: 'Please enter model name' }]}
          initialValue="gpt-4o-mini"
        >
          <Input placeholder="gpt-4o-mini" />
        </Form.Item>
        <Form.Item label={t('temperature')} name="temperature" initialValue={0.7}>
          <Slider min={0} max={2} step={0.1} marks={{ 0: '0', 1: '1', 2: '2' }} />
        </Form.Item>
      </Form>

      <Divider titlePlacement="left" style={{ fontSize: 13 }}>
        <Space>
          <CodeOutlined />
          {t('projectSettings')}
        </Space>
      </Divider>

      <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 8 }}>
        {t('projectSettingsDescription')}
      </Text>

      <List
        size="small"
        dataSource={projects}
        locale={{ emptyText: t('noProjects') }}
        renderItem={(project) => (
          <List.Item
            actions={[
              <Popconfirm
                key="delete"
                title={t('deleteConfirm')}
                onConfirm={() => {
                  void handleDeleteProject(project.id)
                }}
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>,
            ]}
          >
            <List.Item.Meta
              avatar={<FolderOpenOutlined style={{ fontSize: 16, color: '#1677ff' }} />}
              title={<Text style={{ fontSize: 12 }}>{project.name}</Text>}
              description={
                <Text type="secondary" style={{ fontSize: 11 }}>
                  {project.path}
                </Text>
              }
            />
          </List.Item>
        )}
      />

      {addingProject ? (
        <Form form={projectForm} layout="vertical" size="small" style={{ marginTop: 8 }}>
          <Form.Item
            label={t('projectName')}
            name="name"
            rules={[{ required: true, message: t('projectNameRequired') }]}
          >
            <Input placeholder={t('projectNamePlaceholder')} />
          </Form.Item>
          <Form.Item
            label={t('projectPath')}
            name="path"
            rules={[{ required: true, message: t('projectPathRequired') }]}
          >
            <Input placeholder={t('projectPathPlaceholder')} prefix={<FolderOpenOutlined />} />
          </Form.Item>
          <Space>
            <Button size="small" type="primary" onClick={() => void handleAddProject()}>
              {t('addProject')}
            </Button>
            <Button size="small" onClick={() => setAddingProject(false)}>
              {t('cancel')}
            </Button>
          </Space>
        </Form>
      ) : (
        <Button
          size="small"
          icon={<PlusOutlined />}
          onClick={() => setAddingProject(true)}
          style={{ marginTop: 8 }}
          disabled={!backendConnected}
        >
          {t('addProject')}
        </Button>
      )}
    </Modal>
  )
}

export default SettingsModal
