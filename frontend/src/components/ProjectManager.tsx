import React, { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Button,
  Input,
  Form,
  Typography,
  Space,
  List,
  Popconfirm,
  message,
  Tag,
  Empty,
  Collapse,
  Tooltip,
} from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  FolderOpenOutlined,
  MinusCircleOutlined,
  FileTextOutlined,
  ArrowLeftOutlined,
  ContainerOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { listProjects, createProject, deleteProject, listContextDocs } from '../api/projects'
import type { Project, ContextDoc } from '../types'

const { Title, Text } = Typography

const ProjectManager: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [adding, setAdding] = useState(false)
  const [form] = Form.useForm()
  const [contextDocsMap, setContextDocsMap] = useState<Record<string, ContextDoc[]>>({})

  const loadProjects = useCallback(async () => {
    try {
      const list = await listProjects()
      setProjects(list)
    } catch {
      /* backend may not be running */
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const handleAdd = async () => {
    try {
      const values = await form.validateFields()
      const paths = (values.paths as string[]).filter((p: string) => p.trim())
      if (paths.length === 0) {
        void message.error(t('projectPathRequired'))
        return
      }
      const project = await createProject({
        name: values.name,
        paths,
        log_directory: (values.log_directory as string)?.trim() || undefined,
      })
      setProjects((prev) => [...prev, project])
      form.resetFields()
      setAdding(false)
      void message.success(t('projectAdded'))
    } catch (err: unknown) {
      if (err instanceof Error) {
        void message.error(err.message)
      }
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await deleteProject(id)
      setProjects((prev) => prev.filter((p) => p.id !== id))
      const { [id]: _, ...rest } = contextDocsMap
      void _
      setContextDocsMap(rest)
    } catch (err: unknown) {
      if (err instanceof Error) {
        void message.error(err.message)
      }
    }
  }

  const handleLoadContextDocs = async (projectId: string) => {
    if (contextDocsMap[projectId]) return
    try {
      const docs = await listContextDocs(projectId)
      setContextDocsMap((prev) => ({ ...prev, [projectId]: docs }))
    } catch {
      /* ignore */
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 800, margin: '0 auto' }}>
      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>
          {t('backToAnalysis')}
        </Button>
      </Space>

      <Title level={3}>{t('projectSettings')}</Title>
      <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
        {t('projectSettingsDescription')}
      </Text>

      <List
        dataSource={projects}
        locale={{ emptyText: <Empty description={t('noProjects')} /> }}
        renderItem={(project) => (
          <Card
            size="small"
            style={{ marginBottom: 12 }}
            title={
              <Space>
                <FolderOpenOutlined style={{ color: '#1677ff' }} />
                <Text strong>{project.name}</Text>
                <Tag>
                  {project.paths.length} {t('paths')}
                </Tag>
              </Space>
            }
            extra={
              <Popconfirm
                title={t('deleteConfirm')}
                onConfirm={() => void handleDelete(project.id)}
              >
                <Button size="small" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            }
          >
            <div style={{ marginBottom: 8 }}>
              {project.paths.map((p, i) => (
                <div key={i}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <FolderOpenOutlined style={{ marginRight: 4 }} />
                    {p}
                  </Text>
                </div>
              ))}
              {project.log_directory && (
                <div style={{ marginTop: 4 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    <ContainerOutlined style={{ marginRight: 4 }} />
                    {t('logDirectory')}: {project.log_directory}
                  </Text>
                </div>
              )}
            </div>
            <Collapse
              size="small"
              onChange={(keys) => {
                if (keys.length > 0) void handleLoadContextDocs(project.id)
              }}
              items={[
                {
                  key: 'context-docs',
                  label: (
                    <Space size={4}>
                      <FileTextOutlined />
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('contextDocs')}
                        {contextDocsMap[project.id] && ` (${contextDocsMap[project.id].length})`}
                      </Text>
                    </Space>
                  ),
                  children: contextDocsMap[project.id] ? (
                    contextDocsMap[project.id].length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {contextDocsMap[project.id].map((doc) => (
                          <Tooltip
                            key={doc.path}
                            title={`${doc.path} (${(doc.size / 1024).toFixed(1)}KB)`}
                          >
                            <Tag color="green">{doc.path}</Tag>
                          </Tooltip>
                        ))}
                      </div>
                    ) : (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {t('noContextDocs')}
                      </Text>
                    )
                  ) : (
                    <Text type="secondary">{t('loading')}</Text>
                  ),
                },
              ]}
            />
          </Card>
        )}
      />

      {adding ? (
        <Card size="small" style={{ marginTop: 12 }}>
          <Form form={form} layout="vertical" size="small">
            <Form.Item
              label={t('projectName')}
              name="name"
              rules={[{ required: true, message: t('projectNameRequired') }]}
            >
              <Input placeholder={t('projectNamePlaceholder')} />
            </Form.Item>

            <Form.List name="paths" initialValue={['']}>
              {(fields, { add, remove }) => (
                <>
                  <Text strong style={{ fontSize: 13 }}>
                    {t('projectPaths')}
                  </Text>
                  {fields.map((field) => (
                    <Form.Item key={field.key} style={{ marginBottom: 8 }}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Form.Item
                          {...field}
                          noStyle
                          rules={[{ required: true, message: t('projectPathRequired') }]}
                        >
                          <Input
                            placeholder={t('projectPathPlaceholder')}
                            prefix={<FolderOpenOutlined />}
                            style={{ width: '100%' }}
                          />
                        </Form.Item>
                        {fields.length > 1 && (
                          <Button
                            icon={<MinusCircleOutlined />}
                            onClick={() => remove(field.name)}
                          />
                        )}
                      </Space.Compact>
                    </Form.Item>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add('')}
                    block
                    icon={<PlusOutlined />}
                    style={{ marginBottom: 12 }}
                  >
                    {t('addPath')}
                  </Button>
                </>
              )}
            </Form.List>

            <Form.Item label={t('logDirectory')} name="log_directory" style={{ marginTop: 12 }}>
              <Input placeholder={t('logDirectoryPlaceholder')} prefix={<ContainerOutlined />} />
            </Form.Item>

            <Space>
              <Button size="small" type="primary" onClick={() => void handleAdd()}>
                {t('addProject')}
              </Button>
              <Button size="small" onClick={() => setAdding(false)}>
                {t('cancel')}
              </Button>
            </Space>
          </Form>
        </Card>
      ) : (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setAdding(true)}
          style={{ marginTop: 12 }}
        >
          {t('addProject')}
        </Button>
      )}
    </div>
  )
}

export default ProjectManager
